import { useEffect, useRef, useState } from 'react';
import {
  X,
  Camera,
  ImagePlus,
  Flashlight,
  FlashlightOff,
  Repeat,
  CheckCircle,
  Loader2,
  PackageCheck,
  PackagePlus,
  Zap,
  Keyboard,
} from 'lucide-react';
import { useScanner } from '../hooks/useScanner';
import { detectFormat, normalizeCode } from '../services/barcodeNormalizer';
import type { ProductLite, ScanResult } from '../types/scanner.types';
import { SelectMenu } from '../../../components/ui/SelectMenu';

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    try { o.start(); } catch {}
    try { o.stop(ctx.currentTime + 0.12); } catch {}
  } catch {}
  try { navigator.vibrate?.(80); } catch {}
}

export interface ScannerModalProps {
  title?: string;
  /** Uso inmediato (POS): found → onUse de una. */
  immediate?: boolean;
  onUseProduct?: (product: ProductLite, code: string) => void;
  onCreateProduct?: (code: string) => void;
  onClose: () => void;
}

/**
 * Escáner foto-primero (sin errores de cámara en vivo).
 * - HERO: sacar foto del código (scanFile, sin stream, sin permisos de video).
 * - Manual: tipeo directo.
 * - Cámara en vivo: colapsada por defecto, solo si el usuario la abre.
 * NO importa supabase: todo pasa por provider.emit → resolver del padre.
 */
export function ScannerModal({
  title = 'Escanear producto',
  immediate = false,
  onUseProduct,
  onCreateProduct,
  onClose,
}: ScannerModalProps) {
  const scanner = useScanner();
  const {
    status, error, cameraId, cameras, torchOn, torchSupported,
    isStreaming, streamInfo, cameraInfo, zoom, engineMode, resolution, lastResult,
  } = scanner;

  const [manualCode, setManualCode] = useState('');
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [readingStage, setReadingStage] = useState('');
  const [analyzingFrame, setAnalyzingFrame] = useState(false);
  const [frameMsg, setFrameMsg] = useState<string | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagReport, setDiagReport] = useState<{
    devices: { label: string; id: string }[];
    rear: string;
    front: string;
    hasMediaDevices: boolean;
    secure: boolean;
  } | null>(null);

  const runDiag = async () => {
    setDiagRunning(true);
    setDiagReport(null);
    try {
      const r = await scanner.diagnoseCameras();
      setDiagReport(r);
    } catch {
      setDiagReport(null);
    } finally {
      setDiagRunning(false);
    }
  };
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [debugVariants, setDebugVariants] = useState<{ label: string; url: string }[]>([]);
  const [selfTesting, setSelfTesting] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState<{ ok: boolean; code: string | null; detail: string } | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scanAllowedRef = useRef(true);

  // Cámara en vivo SOLO si el usuario la abre (sin auto-start)
  useEffect(() => {
    if (showLive) {
      void scanner.startCamera();
    } else {
      void scanner.stopCamera();
    }
    return () => {
      void scanner.stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLive]);

  // Limpiar preview al cerrar
  useEffect(() => {
    return () => {
      if (photoPreview) {
        try { URL.revokeObjectURL(photoPreview); } catch {}
      }
    };
  }, [photoPreview]);

  const doManualScan = (code: string) => {
    if (!scanAllowedRef.current) return;
    scanAllowedRef.current = false;
    scanner.manualScan(code);
    window.setTimeout(() => { scanAllowedRef.current = true; }, 350);
  };

  const doPhotoScan = (code: string) => {
    if (!scanAllowedRef.current) return;
    scanAllowedRef.current = false;
    scanner.photoScan(code);
    window.setTimeout(() => { scanAllowedRef.current = true; }, 350);
  };

  const found = resolution?.status === 'found' ? resolution : null;
  const notFound = resolution?.status === 'not_found' ? resolution : null;
  const invalid = resolution?.status === 'invalid' ? resolution : null;

  const handleManualSubmit = () => {
    const code = normalizeCode(manualCode);
    if (!code) return;
    setManualCode('');
    beep();
    doManualScan(code);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileMsg(null);
    setPhotoPreview(null);
    setReadingStage('');
    setLastFile(file);
    setShowDiag(false);
    setDebugVariants([]);
    setSelfTestResult(null);
    setReadingFile(true);
    // Preview para que el usuario vea qué sacó
    try {
      const url = URL.createObjectURL(file);
      setPhotoPreview(url);
    } catch {}
    try {
      const { ImageScannerEngine } = await import('../engines/ImageScannerEngine');
      const decoded = await new ImageScannerEngine('barcode-file-helper').decode(
        file,
        (stage) => setReadingStage(stage.replace('image-', ''))
      );
      if (decoded) {
        beep();
        doPhotoScan(decoded);
      } else {
        setFileMsg('No se pudo leer el código en esa foto. Probá con más luz, de frente, y que el código ocupe buena parte de la imagen.');
      }
    } catch {
      setFileMsg('No se pudo leer el código en esa foto. Probá con más luz, de frente, y que el código ocupe buena parte de la imagen.');
    } finally {
      setReadingFile(false);
      setReadingStage('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

    /**
   * Refuerzo en vivo: captura el cuadro actual del video y lo pasa por la
   * misma cascada de foto (nativo → ZXing → Quagga2 → TRY_HARDER).
   * El loop rápido sigue corriendo; esto es para códigos que no salen solos.
   */
  const analyzeFrame = async () => {
    if (analyzingFrame || !isStreaming) return;
    setFrameMsg(null);
    setAnalyzingFrame(true);
    try {
      const video = document.querySelector('#barcode-reader video') as HTMLVideoElement | null;
      if (!video || !video.videoWidth) {
        setFrameMsg('Todavía no hay imagen de cámara. Esperá un segundo y reintentá.');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setFrameMsg('No se pudo capturar el cuadro.');
        return;
      }
      ctx.drawImage(video, 0, 0);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) {
        setFrameMsg('No se pudo capturar el cuadro.');
        return;
      }
      const { ImageScannerEngine } = await import('../engines/ImageScannerEngine');
      const decoded = await new ImageScannerEngine('barcode-file-helper').decode(
        new File([blob], 'frame.jpg', { type: 'image/jpeg' }),
        (stage) => setFrameMsg(`Analizando: ${stage.replace('image-', '')}...`)
      );
      if (decoded) {
        beep();
        setFrameMsg(null);
        const normalized = normalizeCode(decoded);
        if (normalized) {
          const result: ScanResult = {
            rawCode: decoded,
            normalizedCode: normalized,
            format: detectFormat(normalized),
            source: 'camera',
            scannedAt: Date.now(),
          };
          scanner.emit(result);
        }
      } else {
        setFrameMsg('Ese cuadro no se pudo leer. Acercá el código y probá de nuevo.');
      }
    } catch {
      setFrameMsg('Ese cuadro no se pudo leer. Acercá el código y probá de nuevo.');
    } finally {
      setAnalyzingFrame(false);
    }
  };

  const clearPhoto = () => {    if (photoPreview) {
      try { URL.revokeObjectURL(photoPreview); } catch {}
    }
    setPhotoPreview(null);
    setFileMsg(null);
    setLastFile(null);
    setShowDiag(false);
    setDebugVariants([]);
    setSelfTestResult(null);
  };

  const loadDebugVariants = async () => {
    if (!lastFile) return;
    try {
      const { ImageScannerEngine } = await import('../engines/ImageScannerEngine');
      const vars = await new ImageScannerEngine('barcode-file-helper').collectDebugVariants(lastFile);
      setDebugVariants(vars);
    } catch {
      setDebugVariants([]);
    }
  };

  const runSelfTest = async () => {
    setSelfTesting(true);
    setSelfTestResult(null);
    try {
      const { ImageScannerEngine } = await import('../engines/ImageScannerEngine');
      const res = await new ImageScannerEngine('barcode-file-helper').selfTest();
      setSelfTestResult(res);
    } catch {
      setSelfTestResult({ ok: false, code: null, detail: 'error' });
    } finally {
      setSelfTesting(false);
    }
  };

  const errorText = !error ? null
    : error === 'insecure_context'
      ? 'La cámara necesita HTTPS. Estás en HTTP: usá la foto o entrá por https (dev:https o túnel).'
      : error === 'permission_denied'
      ? 'Permiso de cámara denegado. Habilitá el video para este sitio en el navegador.'
      : error === 'camera_unavailable'
        ? 'No se encontró cámara disponible. Usá la foto o la entrada manual.'
        : 'No se pudo iniciar la cámara en vivo. Usá la foto o la entrada manual.';

  const isVideoBusy = status === 'starting' || status === 'resolving';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 z-50">
      <div className="bg-white dark:bg-[#1F1F1F] rounded-none sm:rounded-3xl w-full sm:max-w-2xl p-4 sm:p-6 space-y-4 shadow-2xl relative h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
          <div className="flex items-center space-x-2">
            <Camera className="text-emerald-600" size={22} />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer p-1" aria-label="Cerrar">
            <X size={22} />
          </button>
        </div>

        {/* HERO: foto (método principal, sin errores de stream) */}
        <div className="hidden"><div id="barcode-file-helper"></div></div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={readingFile}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-base font-extrabold flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer disabled:opacity-60 shadow-lg shadow-emerald-600/25"
        >
          {readingFile
            ? <><Loader2 size={22} className="animate-spin" /> Leyendo foto{readingStage ? ` · ${readingStage}` : '...'}</>
            : <><ImagePlus size={24} /> SACAR FOTO DEL CÓDIGO</>}
        </button>
        <p className="text-center text-[11px] font-semibold text-slate-500 -mt-2">
          Apuntá de frente, con buena luz, que el código ocupe buena parte de la foto.
        </p>

        {/* Preview de la foto */}
        {photoPreview && (
          <div className="rounded-2xl border-2 border-slate-200 dark:border-[#333333] overflow-hidden relative">
            <img src={photoPreview} alt="Foto del código" className="w-full max-h-56 object-contain bg-slate-950" />
            <button
              onClick={clearPhoto}
              className="absolute top-2 right-2 px-3 py-1.5 bg-black/60 hover:bg-black/80 text-white rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Sacar otra
            </button>
          </div>
        )}
        {fileMsg && (
          <p className="text-center text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-3 py-2">{fileMsg}</p>
        )}

        {/* Diagnóstico: qué ve el lector + autotest (solo tras fallo con foto) */}
        {fileMsg && lastFile && (
          <div className="rounded-2xl border-2 border-slate-200 dark:border-[#333333] p-3 space-y-2">
            <button
              onClick={() => { setShowDiag((v) => !v); if (!debugVariants.length) void loadDebugVariants(); }}
              className="w-full text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition cursor-pointer"
            >
              {showDiag ? 'Ocultar diagnóstico ▲' : 'Ver diagnóstico: qué ve el lector ▼'}
            </button>
            {showDiag && (
              <div className="space-y-2">
                {debugVariants.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center">Generando variantes...</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {debugVariants.map((v) => (
                      <div key={v.label} className="rounded-xl overflow-hidden border border-slate-200 dark:border-[#444]">
                        <img src={v.url} alt={v.label} className="w-full h-20 object-contain bg-white" />
                        <p className="text-[10px] font-mono text-center text-slate-500 bg-slate-50 dark:bg-white/5 py-0.5">{v.label}</p>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={runSelfTest}
                  disabled={selfTesting}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 rounded-xl text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                >
                  {selfTesting ? 'Probando lector...' : 'Probar lector con código perfecto'}
                </button>
                {selfTestResult && (
                  <p className={`text-center text-[11px] font-bold rounded-xl px-3 py-1.5 ${selfTestResult.ok ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30' : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'}`}>
                    {selfTestResult.ok
                      ? `Lector OK (leyó ${selfTestResult.code}). El problema es la foto, no el lector.`
                      : `Lector con fallas (${selfTestResult.detail}). Avisame con este mensaje.`}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Manual */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleManualSubmit(); }}
          className="flex gap-2"
        >
          <div className="relative flex-1 min-w-0">
            <Keyboard size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="o escribí el código manualmente..."
              inputMode="text"
              autoComplete="off"
              className="w-full pl-9 pr-3.5 py-2.5 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white bg-white dark:bg-[#232323]"
            />
          </div>
          <button
            type="submit"
            disabled={!normalizeCode(manualCode)}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer disabled:opacity-40 shrink-0"
          >
            Buscar
          </button>
        </form>

        {/* Paneles de resolución */}
        {(found || notFound || invalid) && (
          <div aria-live="polite" className={`rounded-2xl border-2 p-4 space-y-2 ${found ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30' : notFound ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30' : 'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/30'}`}>
            {found && (
              <>
                <div className="flex items-center gap-2">
                  <PackageCheck size={20} className="text-emerald-600 shrink-0" />
                  <p className="font-extrabold text-slate-900 dark:text-white text-sm leading-tight">{found.product.name}</p>
                </div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                  Stock {found.product.stock_quantity ?? '?'}
                  {found.product.retail_price !== undefined && <> · ${Number(found.product.retail_price).toLocaleString('es-AR')}</>}
                  {found.product.category ? ` · ${found.product.category}` : ''}
                </p>
                <p className="text-[11px] font-mono text-slate-500">{found.barcode}</p>
              </>
            )}
            {notFound && (
              <>
                <div className="flex items-center gap-2">
                  <PackagePlus size={20} className="text-amber-600 shrink-0" />
                  <p className="font-extrabold text-slate-900 dark:text-white text-sm">Producto no registrado</p>
                </div>
                <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200">{notFound.barcode}</p>
              </>
            )}
            {invalid && (
              <>
                <div className="flex items-center gap-2">
                  <PackagePlus size={20} className="text-red-600 shrink-0" />
                  <p className="font-extrabold text-slate-900 dark:text-white text-sm">Código inválido</p>
                </div>
                <p className="text-xs font-semibold text-red-700 dark:text-red-300">{invalid.reason}</p>
              </>
            )}

            <div className="flex gap-2 pt-1">
              {found && onUseProduct && (
                <button
                  onClick={() => onUseProduct(found.product, found.barcode)}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  {immediate ? 'Agregar al carrito' : 'Usar este código'}
                </button>
              )}
              {notFound && onCreateProduct && (
                <button
                  onClick={() => onCreateProduct(notFound.barcode)}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  Crear producto
                </button>
              )}
              <button
                onClick={() => { scanner.resetStatus(); clearPhoto(); }}
                className="flex-1 py-2.5 bg-white hover:bg-slate-100 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-white border border-slate-200 dark:border-[#333333] rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
              >
                Escanear de nuevo
              </button>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
          <div className="flex-1 h-px bg-slate-200 dark:bg-[#333333]" />
          <span>Avanzado</span>
          <div className="flex-1 h-px bg-slate-200 dark:bg-[#333333]" />
        </div>

        {/* Cámara en vivo: colapsada por defecto */}
        <button
          onClick={() => setShowLive((v) => !v)}
          className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          <Camera size={16} /> {showLive ? 'Ocultar cámara en vivo ▲' : 'Cámara en vivo (teléfono) ▼'}
        </button>

        {showLive && (
          <div className="space-y-3 rounded-2xl border-2 border-slate-200 dark:border-[#333333] p-3">
{cameras.length > 1 && (
          <div className="flex items-center gap-2">
            <Camera size={14} className="text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <SelectMenu
                value={cameraId}
                options={cameras.map((c, i) => ({ value: c.id, label: (c.label || `Cámara ${i + 1}`).slice(0, 40) }))}
                onChange={(v) => { scanner.setDevice(String(v)); void scanner.switchCamera(String(v)); }}
                ariaLabel="Elegir cámara"
                width="w-64"
                fullWidth
              />
            </div>
            <button
              onClick={() => void scanner.switchFacing('environment')}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold border-2 transition cursor-pointer bg-white dark:bg-[#232323] border-slate-200 dark:border-[#333333] text-slate-600 dark:text-slate-300 shrink-0"
              title="Forzar cámara trasera"
            >
              Trasera
            </button>
            <button
              onClick={() => void scanner.switchFacing('user')}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold border-2 transition cursor-pointer bg-white dark:bg-[#232323] border-slate-200 dark:border-[#333333] text-slate-600 dark:text-slate-300 shrink-0"
              title="Forzar cámara frontal"
            >
              Frontal
            </button>
          </div>
        )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setContinuous((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition cursor-pointer ${continuous ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white dark:bg-[#232323] border-slate-200 dark:border-[#333333] text-slate-600 dark:text-slate-300'}`}
                title="Escaneo continuo"
              >
                <Repeat size={14} /> {continuous ? 'Continuo ✓' : 'Continuo'}
              </button>
              {torchSupported && (
                <button
                  onClick={() => void scanner.toggleTorch()}
                  className={`p-2 rounded-xl border-2 transition cursor-pointer ${torchOn ? 'bg-amber-400 border-amber-400 text-white' : 'bg-white dark:bg-[#232323] border-slate-200 dark:border-[#333333] text-slate-500'}`}
                  title="Linterna"
                >
                  {torchOn ? <Flashlight size={16} /> : <FlashlightOff size={16} />}
                </button>
              )}
              <button
                onClick={() => scanner.setEngineMode(engineMode === 'auto' ? 'zxing' : 'auto')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition cursor-pointer bg-white dark:bg-[#232323] border-slate-200 dark:border-[#333333] text-slate-600 dark:text-slate-300"
                title="Motor de lectura"
              >
                <Zap size={14} /> {engineMode === 'auto' ? 'Auto' : 'ZXing'}
              </button>
            </div>

            {isStreaming && !error && (status === 'scanning' || isVideoBusy) && (
              <div aria-live="polite" className="flex items-center justify-center gap-2 text-[11px] font-bold text-slate-500">
                {status === 'starting' ? (
                  <><Loader2 size={13} className="animate-spin text-slate-400" /> Iniciando cámara...</>
                ) : status === 'resolving' ? (
                  <><Loader2 size={13} className="animate-spin text-sky-600" /> Buscando producto...</>
                ) : (
                  <><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Apuntá el código dentro del marco</>
                )}
              </div>
            )}
            {isStreaming && streamInfo && (
              <p className="text-center text-[10px] font-mono text-slate-400">
                {streamInfo.w}×{streamInfo.h} · {streamInfo.native ? 'nativo' : 'zxing'}
                {cameraInfo && (
                  <> · {cameraInfo.facing}{cameraInfo.focusModes.length ? '' : ' · foco fijo'}</>
                )}
              </p>
            )}
            {isStreaming && cameraInfo && cameraInfo.zoomMax > 1 && (
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-bold text-slate-400">Zoom</span>
                <input
                  type="range"
                  min={cameraInfo.zoomMin}
                  max={cameraInfo.zoomMax}
                  step={0.1}
                  value={Math.min(Math.max(zoom, cameraInfo.zoomMin), cameraInfo.zoomMax)}
                  onChange={(e) => void scanner.setZoomLevel(Number(e.target.value))}
                  className="flex-1 accent-emerald-600 cursor-pointer"
                  title="Acercar el código"
                />
                <span className="text-[10px] font-mono font-bold text-slate-500 w-8 text-right">{zoom.toFixed(1)}x</span>
              </div>
            )}
            {isStreaming && cameraInfo && !cameraInfo.focusModes.length && (
              <p className="text-center text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                Cámara de foco fijo: mantené el código a 20-30 cm, quieto y con buena luz.
              </p>
            )}
            <div className="rounded-xl border border-slate-200 dark:border-[#333333] p-2 space-y-1.5">
              <button
                type="button"
                onClick={() => void runDiag()}
                disabled={diagRunning}
                className="w-full text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition cursor-pointer disabled:opacity-50"
              >
                {diagRunning ? 'Diagnosticando cámaras...' : '🔍 Diagnosticar cámaras (si la trasera no cambia)'}
              </button>
              {diagReport && (
                <div className="text-[10px] font-mono leading-relaxed bg-slate-50 dark:bg-white/5 rounded-lg p-2 space-y-0.5 break-all">
                  <p className="text-slate-500">secure: {diagReport.secure ? 'sí' : 'NO'} · api: {diagReport.hasMediaDevices ? 'sí' : 'NO'}</p>
                  {diagReport.devices.map((d, i) => (
                    <p key={i} className="text-slate-600 dark:text-slate-300">• {d.label}</p>
                  ))}
                  <p className={diagReport.rear.startsWith('OK') ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                    trasera: {diagReport.rear}
                  </p>
                  <p className={diagReport.front.startsWith('OK') ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                    frontal: {diagReport.front}
                  </p>
                </div>
              )}
            </div>

            {error && (
              <p className="text-center text-[11px] font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2">
                {errorText}{' '}
                <button
                  onClick={() => { scanner.resetStatus(); void scanner.startCamera(); }}
                  className="underline font-extrabold cursor-pointer"
                >
                  Reintentar
                </button>
              </p>
            )}

            <div className="overflow-hidden rounded-2xl border-2 bg-slate-950 relative h-80">
              <div id="barcode-reader" className="absolute inset-0"></div>
              {!isStreaming && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 py-10 text-slate-500 bg-slate-950">
                  <Loader2 size={28} className="animate-spin text-emerald-600" />
                  <p className="text-xs font-bold">Activando cámara...</p>
                </div>
              )}
              {isStreaming && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-[80%] h-[60%] border-2 border-emerald-400/70 rounded-xl" />
                </div>
              )}
              {continuous && status === 'scanning' && lastResult && (
                <div className="absolute bottom-2 left-2 right-2 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-lg">
                  <CheckCircle size={14} /> {lastResult.normalizedCode}
                </div>
              )}
            </div>
            {isStreaming && !error && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => void analyzeFrame()}
                  disabled={analyzingFrame}
                  title="Congela el cuadro actual y lo analiza con todos los motores"
                  className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer"
                >
                  {analyzingFrame
                    ? <><Loader2 size={15} className="animate-spin" /> Analizando cuadro...</>
                    : <><Camera size={15} /> Si no lo lee solo: analizar cuadro</>}
                </button>
                {frameMsg && (
                  <p className="text-center text-[11px] font-semibold text-slate-500">{frameMsg}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
