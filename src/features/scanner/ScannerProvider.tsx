import type { ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ScannerContext } from './scannerContext';
import { CameraScannerEngine, type CameraInfo, type EngineMode } from './engines/CameraScannerEngine';
import { useScanGuard } from './hooks/useScanGuard';
import { useHardwareScanner } from './hooks/useHardwareScanner';
import { detectFormat, normalizeCode } from './services/barcodeNormalizer';
import type {
  BarcodeResolution,
  ScanResult,
  ScannerError,
  ScannerState,
  ScannerStatus,
} from './types/scanner.types';

const CAMERA_KEY = 'dv-camera-id';
const ENGINE_KEY = 'dv-scan-engine';

export interface ScannerProviderApi extends ScannerState {
  isStreaming: boolean;
  streamInfo: { w: number; h: number; native: boolean } | null;
  cameraInfo: CameraInfo | null;
  zoom: number;
  setZoomLevel: (v: number) => Promise<void>;
  resolution: BarcodeResolution | null;
  startCamera: () => Promise<void>;
  stopCamera: () => Promise<void>;
  switchCamera: (next?: string) => Promise<void>;
  switchFacing: (mode: 'environment' | 'user') => Promise<void>;
  diagnoseCameras: () => Promise<{
    devices: { label: string; id: string }[];
    rear: string;
    front: string;
    hasMediaDevices: boolean;
    secure: boolean;
  } | null>;
  setDevice: (id: string) => void;
  toggleTorch: () => Promise<void>;
  scan: () => Promise<void>;
  manualScan: (code: string) => void;
  photoScan: (code: string) => void;
  hardwareScan: (code: string) => void;
  setEngineMode: (m: EngineMode) => void;
  engineMode: EngineMode;
  /** El flujo (Stock/POS) registra aquí RESOLVER: devuelve found/not_found/invalid. */
  setOnDetected: (fn: ((code: string) => Promise<BarcodeResolution>) | null) => void;
  emit: (result: ScanResult) => void;
  resetStatus: () => void;
}

function readEngine(): EngineMode {
  try {
    const v = localStorage.getItem(ENGINE_KEY);
    return v === 'zxing' ? 'zxing' : 'auto';
  } catch {
    return 'auto';
  }
}

function facingForLabel(label: string): 'environment' | 'user' | undefined {
  if (/back|rear|environment|trasera|posterior/i.test(label || '')) return 'environment';
  if (/front|user|selfie|frontal|delantera/i.test(label || '')) return 'user';
  return undefined;
}

function isInsecureContext(): boolean {
  try {
    return typeof window !== 'undefined' && window.isSecureContext === false;
  } catch {
    return false;
  }
}

function errName(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err?.name || '';
}

function errMessage(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err?.message || '';
}

function eCode(name: string): ScannerError | null {
  if (isInsecureContext()) return 'insecure_context';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'camera_unavailable';
  return 'decoder_error';
}

export function ScannerProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<CameraScannerEngine>(new CameraScannerEngine());
  const guard = useScanGuard();

  const [engineMode, setEngineModeState] = useState<EngineMode>(readEngine);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [error, setError] = useState<ScannerError | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamInfo, setStreamInfo] = useState<{ w: number; h: number; native: boolean } | null>(null);
  const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null);
  const [zoom, setZoom] = useState(1);

  const resolverRef = useRef<((code: string) => Promise<BarcodeResolution>) | null>(null);
  const lastRawRef = useRef('');
  const [resolution, setResolution] = useState<BarcodeResolution | null>(null);

  const setOnDetected = useCallback((fn: ((code: string) => Promise<BarcodeResolution>) | null) => {
    resolverRef.current = fn;
  }, []);

  const emit = useCallback((result: ScanResult) => {
    const accepted = guard.accept(result);
    if (!accepted) {
      console.log('[Scanner] rejected-duplicate', result.normalizedCode);
      return;
    }
    console.log('[Scanner] detected', accepted.source, accepted.normalizedCode);
    setLastResult(accepted);
    lastRawRef.current = accepted.normalizedCode;
    const fn = resolverRef.current;
    if (fn) {
      setStatus('resolving');
      setResolution(null);
      fn(accepted.normalizedCode)
        .then((res) => {
          setResolution(res);
          setStatus(res.status === 'found' ? 'found' : res.status === 'not_found' ? 'not_found' : 'invalid');
        })
        .catch(() => {
          setError('network_error');
          setStatus('error');
        });
    }
  }, [guard]);

  const setEngineMode = useCallback((m: EngineMode) => {
    setEngineModeState(m);
    try { localStorage.setItem(ENGINE_KEY, m); } catch {}
  }, []);

  const refreshCameras = useCallback(async () => {
    const list = await engineRef.current.listCameras();
    setCameras(list);
    return list;
  }, []);

  const handleEngineDetected = useCallback((raw: string) => {
    const code = normalizeCode(raw);
    if (!code || code === lastRawRef.current) return;
    lastRawRef.current = code;
    setStatus('detected');
    emit({
      rawCode: raw,
      normalizedCode: code,
      format: detectFormat(code),
      source: 'camera',
      scannedAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit]);

  /** Relee resolución + tipo de cámara tras arrancar (para UI y selector). */
  const scheduleStreamRefresh = useCallback(() => {
    setTimeout(() => {
      try {
        const cap = engineRef.current.capabilities;
        if ((cap as any)?.torch) setTorchSupported(true);
      } catch {}
      try {
        const video = document.querySelector('#barcode-reader video') as HTMLVideoElement | null;
        const w = video?.videoWidth || 0;
        const h = video?.videoHeight || 0;
        const native = typeof window !== 'undefined' && !!(window as any).BarcodeDetector && engineMode === 'auto';
        console.log('[Scanner] stream:', `${w}x${h}`, native ? 'native' : 'zxing');
        setStreamInfo({ w, h, native });
      } catch { /* noop */ }
      try {
        const info = engineRef.current.describeCamera();
        if (info) {
          console.log('[Scanner] camera:', info.facing, `${info.width}x${info.height}`, `foco:${info.focus || info.focusModes.join('/') || 'fijo'}`, info.zoomMax > 1 ? `zoom:${info.zoomMin}-${info.zoomMax}` : 'sin zoom');
          setCameraInfo(info);
          if (info.hasTorch) setTorchSupported(true);
          if (info.zoomMax > 1) setZoom(info.zoomMin);
        }
        void engineRef.current.applyOptimalDefaults();
      } catch { /* noop */ }
    }, 1200);
  }, [engineMode]);

  const stopCamera = useCallback(async () => {
    console.log('[Scanner] stop');
    await engineRef.current.stop();
    setIsStreaming(false);
    setStreamInfo(null);
    setStatus('idle');
    setError(null);
    setTorchOn(false);
    setTorchSupported(false);
    setCameraInfo(null);
    setZoom(1);
  }, []);

  const startCamera = useCallback(async () => {
    console.log('[Scanner] start');
    // Sin getUserMedia no hay cámara posible (HTTP inseguro, WebView in-app, navegador viejo)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.error('[Scanner] start error: mediaDevices/getUserMedia no disponible (¿HTTP?, ¿navegador in-app?, ¿muy viejo?)');
      setError(isInsecureContext() ? 'insecure_context' : 'camera_unavailable');
      setStatus('error');
      setIsStreaming(false);
      return;
    }
    setError(null);
    setStatus('requesting_permission');

    let list = cameras;
    if (!list.length) {
      list = await refreshCameras();
      list.length && setCameras(list);
    }

    // Si el usuario no seleccionó explícitamente una cámara en esta sesión,
    // ignorar localStorage si guardó la cámara frontal (user), priorizando trasera.
    const preferred = cameraId || (() => {
      try {
        const stored = localStorage.getItem(CAMERA_KEY) || '';
        if (stored && list.length) {
          const foundCam = list.find((c) => c.id === stored);
          if (foundCam && facingForLabel(foundCam.label) === 'user') {
            return '';
          }
        }
        return stored;
      } catch {
        return '';
      }
    })();

    const saved = preferred && list.some((c) => c.id === preferred) ? preferred : '';
    const rear = list.find((c) => /back|rear|trasera|environment|posterior|principal/i.test(c.label || ''));

    let targetCameraId: string | undefined = saved || (rear ? rear.id : undefined);
    let facingExact: 'environment' | 'user' | undefined = targetCameraId ? undefined : 'environment';

    if (targetCameraId) {
      setCameraId(targetCameraId);
      try { localStorage.setItem(CAMERA_KEY, targetCameraId); } catch {}
    }

    setStatus('starting');
    try {
      await engineRef.current.start('barcode-reader', {
        cameraId: targetCameraId,
        facingModeExact: facingExact,
        engine: engineMode,
        onDetected: handleEngineDetected,
      });
      setIsStreaming(true);
      setStatus('scanning');
      // Si se entró por facingMode, resolver el device real (ya con permiso hay labels)
      // para que el selector muestre la cámara correcta y el switch funcione.
      if (!targetCameraId) {
        try {
          const fresh = await engineRef.current.listCameras();
          if (fresh.length) {
            setCameras(fresh);
            const realRear = fresh.find((c) => /back|rear|trasera|environment|posterior|principal/i.test(c.label || ''));
            const real = realRear ? realRear.id : fresh[0]?.id;
            if (real) {
              setCameraId(real);
              try { localStorage.setItem(CAMERA_KEY, real); } catch {}
            }
          }
        } catch { /* selector aproximado, el stream ya es trasera */ }
      }
      scheduleStreamRefresh();
    } catch (err: any) {
      console.error('[Scanner] start error:', errName(err) || '(sin nombre)', '|', errMessage(err) || '(sin mensaje)', '| raw:', err);
      // Si falló con facingExact por OverconstrainedError, reintentar con facingMode flexible ('environment')
      if (facingExact && (err?.name === 'OverconstrainedError' || /overconstrain/i.test(err?.message || ''))) {
        try {
          await engineRef.current.start('barcode-reader', {
            facingMode: 'environment',
            engine: engineMode,
            onDetected: handleEngineDetected,
          });
          setIsStreaming(true);
          setStatus('scanning');
          scheduleStreamRefresh();
          return;
        } catch (err2: any) {
          const ec = eCode(errName(err2));
          setError(ec);
          setStatus('error');
          setIsStreaming(false);
          return;
        }
      }
      const ec = eCode(errName(err));
      setError(ec);
      setStatus(ec ? 'error' : 'error');
      setIsStreaming(false);
    }
  }, [cameraId, cameras, engineMode, refreshCameras, handleEngineDetected, scheduleStreamRefresh]);

  const switchCamera = useCallback(async (next?: string) => {
    let target = next;
    if (!target) {
      const idx = cameras.findIndex((c) => c.id === cameraId);
      target = cameras[(idx + 1) % Math.max(1, cameras.length)]?.id || cameras[0]?.id;
    }
    if (target) {
      await stopCamera();
      await new Promise((r) => setTimeout(r, 250));
      setCameraId(target);
      try { localStorage.setItem(CAMERA_KEY, target); } catch {}
      console.log('[Scanner] switch →', target.slice(0, 8) + '…');
      // restart con la cámara elegida
      setStatus('starting');
      setError(null);
      try {
        await engineRef.current.start('barcode-reader', {
          cameraId: target,
          engine: engineMode,
          onDetected: handleEngineDetected,
        });
        setIsStreaming(true);
        setStatus('scanning');
      scheduleStreamRefresh();
      // Auto-corrección por si el navegador abrió la cámara frontal por defecto:
      setTimeout(async () => {
        try {
          const info = engineRef.current.describeCamera();
          if (info?.facing === 'frontal') {
            const fresh = await engineRef.current.listCameras();
            if (fresh.length) {
              setCameras(fresh);
              const rearCam = fresh.find((c) => /back|rear|trasera|environment|posterior|principal/i.test(c.label || ''));
              const targetCam = rearCam ? rearCam.id : fresh[0]?.id;
              if (targetCam) {
                console.log('[Scanner] Auto-switching from front to rear:', targetCam);
                await engineRef.current.stop();
                setCameraId(targetCam);
                try { localStorage.setItem(CAMERA_KEY, targetCam); } catch {}
                await engineRef.current.start('barcode-reader', {
                  cameraId: targetCam,
                  engine: engineMode,
                  onDetected: handleEngineDetected,
                });
                setIsStreaming(true);
                setStatus('scanning');
                scheduleStreamRefresh();
              }
            }
          }
        } catch (e) {
          console.log('[Scanner] auto-rear check error:', e);
        }
      }, 700);
    } catch (err: any) {
        console.error('[Scanner] switch error:', errName(err) || '(sin nombre)', '|', errMessage(err) || '(sin mensaje)');
        const ec = eCode(errName(err));
        setError(ec);
        setStatus('error');
        setIsStreaming(false);
      }
    }
  }, [cameras, cameraId, engineMode, stopCamera, handleEngineDetected, scheduleStreamRefresh]);

  /**
   * Cambio directo por orientación (sin deviceId): para "Trasera/Delantera"
   * explícitos. No depende de los IDs enumerados.
   */
  const switchFacing = useCallback(async (mode: 'environment' | 'user') => {
    console.log('[Scanner] switchFacing →', mode);
    await stopCamera();
    // Android libera la cámara con retardo: si no, el nuevo start falla
    // con "camera in use" y queda en frontal.
    await new Promise((r) => setTimeout(r, 250));
    // Priorizar el deviceId real que matchee esa orientación (más confiable
    // que facingMode en Android); si no hay label, usar facingMode exact.
    const match = cameras.find((c) => facingForLabel(c.label || '') === mode);
    if (match) {
      setCameraId(match.id);
      try { localStorage.setItem(CAMERA_KEY, match.id); } catch {}
    }
    setStatus('starting');
    setError(null);
    try {
      await engineRef.current.start('barcode-reader', {
        cameraId: match?.id || undefined,
        facingModeExact: mode,
        engine: engineMode,
        onDetected: handleEngineDetected,
      });
      setIsStreaming(true);
      setStatus('scanning');
      scheduleStreamRefresh();
    } catch (err: any) {
      console.error('[Scanner] switchFacing error:', errName(err) || '(sin nombre)', '|', errMessage(err) || '(sin mensaje)');
      const ec = eCode(errName(err));
      setError(ec);
      setStatus('error');
      setIsStreaming(false);
    }
  }, [cameras, engineMode, stopCamera, handleEngineDetected, scheduleStreamRefresh]);

  const setDevice = useCallback((id: string) => {
    setCameraId(id);
    try { localStorage.setItem(CAMERA_KEY, id); } catch {}
  }, []);

  const diagnoseCameras = useCallback(async () => {
    try {
      return await engineRef.current.diagnoseCameras();
    } catch {
      return null;
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    const s = engineRef.current;
    const next = !torchOn;
    await s.applyConstraints({ advanced: [{ torch: next }] } as any);
    setTorchOn(next);
  }, [torchOn]);

  const setZoomLevel = useCallback(async (v: number) => {
    setZoom(v);
    await engineRef.current.setZoom(v);
  }, []);

  const scan = useCallback(async () => {
    // snapshot del stream (sin bloquear el looping de cámara)
    setStatus('detected');
  }, []);

  const resetStatus = useCallback(() => {
    lastRawRef.current = '';
    guard.clearLock();
    setError(null);
    setResolution(null);
    if (isStreaming) setStatus('scanning');
    else setStatus('idle');
  }, [guard, isStreaming]);

  const buildResult = (code: string, source: ScanResult['source']): ScanResult | null => {
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    lastRawRef.current = normalized;
    return {
      rawCode: code,
      normalizedCode: normalized,
      format: detectFormat(normalized),
      source,
      scannedAt: Date.now(),
    };
  };

  const manualScan = useCallback((code: string) => {
    const r = buildResult(code, 'manual');
    if (r) emit(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit]);

  const photoScan = useCallback((code: string) => {
    const r = buildResult(code, 'image');
    if (r) emit(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit]);

  const hardwareScan = useCallback((code: string) => {
    const r = buildResult(code, 'hardware');
    if (r) emit(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit]);

  useHardwareScanner(hardwareScan, true);

  useEffect(() => {
    return () => {
      void engineRef.current.stop();
    };
  }, []);

  const value = useMemo<ScannerProviderApi>(() => ({
    status,
    error,
    lastResult,
    resolution,
    activeSource: lastResult?.source ?? null,
    cameraId,
    cameras,
    torchSupported,
    torchOn,
    isStreaming,
    streamInfo,
    cameraInfo,
    zoom,
    setZoomLevel,
    engineMode,
    startCamera,
    stopCamera,
    switchCamera,
    switchFacing,
    diagnoseCameras,
    setDevice,
    toggleTorch,
    scan,
    manualScan,
    photoScan,
    hardwareScan,
    setEngineMode,
    setOnDetected,
    emit,
    resetStatus,
  }), [
    status, error, lastResult, resolution, cameraId, cameras, torchSupported, torchOn,
    isStreaming, streamInfo, cameraInfo, zoom, setZoomLevel, engineMode, startCamera, stopCamera, switchCamera, switchFacing, diagnoseCameras, setDevice,
    toggleTorch, scan, manualScan, photoScan, hardwareScan, setEngineMode, setOnDetected,
    emit, resetStatus,
  ]);

  return <ScannerContext.Provider value={value}>{children}</ScannerContext.Provider>;
}