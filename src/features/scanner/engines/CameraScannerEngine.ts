import { Html5Qrcode } from 'html5-qrcode';

export type EngineMode = 'auto' | 'zxing';

export interface EngineCallbacks {
  onDetected: (raw: string) => void;
  onError: (name: string, message: string) => void;
}

/**
 * CameraScannerEngine: núcleo de lectura de cámara.
 * Desacoplado de la UI y de Supabase. BarcodeDetector nativo primero,
 * ZXing como fallback (auto); 'zxing' fuerza el decoder JS.
 */
export interface CameraInfo {
  label: string;
  width: number;
  height: number;
  facing: 'trasera' | 'frontal' | 'externa' | 'desconocida';
  focusModes: string[];
  focus: string;
  zoomMin: number;
  zoomMax: number;
  hasTorch: boolean;
}

export class CameraScannerEngine {
  scanner: Html5Qrcode | null = null;
  private running = false;
  private stopped = false;
  private containerId = 'barcode-reader';

  async listCameras(): Promise<{ id: string; label: string }[]> {
    try {
      const list = await Html5Qrcode.getCameras();
      return (list || []).map((c) => ({ id: c.id, label: c.label || 'Cámara' }));
    } catch {
      return [];
    }
  }

async start(
    containerId: string,
    opts: {
      cameraId?: string;
      facingMode?: 'environment' | 'user';
      facingModeExact?: 'environment' | 'user';
      engine: EngineMode;
      formats?: number[];
      onDetected: (raw: string) => void;
      onError?: (name: string, message: string) => void;
    }
  ): Promise<void> {
    await this.stop();
    this.stopped = false;
    this.containerId = containerId;
    this.scanner = new Html5Qrcode(containerId);
    this.running = true;

    const el = document.getElementById(containerId);
    console.log('[Scanner] container dims:', el?.offsetWidth, 'x', el?.offsetHeight);

    const formats = opts.formats ?? [];
    // qrbox = región REAL de lectura. Debe coincidir con el marco verde del modal
    // (w-[80%] h-[60%] del contenedor). Piso de 50px: la lib rechaza menores.
    // Resolución: ideal alto (blando) para negociar lo máximo; si falla,
    // reintento sin constraints (default del driver).
    //
    // IMPORTANTE (bug del switch Trasera/Frontal): html5-qrcode usa
    // config.videoConstraints EXCLUSIVAMENTE cuando está válido e ignora por
    // completo cameraIdOrConfig (deviceId/facingMode del source). Por eso el
    // criterio de cámara va DENTRO de videoConstraints.
    const videoConstraints: any = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };
    if (opts.cameraId) {
      videoConstraints.deviceId = { exact: opts.cameraId };
    } else if (opts.facingModeExact) {
      videoConstraints.facingMode = { exact: opts.facingModeExact };
    } else {
      videoConstraints.facingMode = opts.facingMode ?? 'environment';
    }

    const config: any = {
      fps: 15,
      aspectRatio: 1.333334,
      qrbox: (w: number, h: number) => ({
        width: Math.max(50, Math.floor((w || 320) * 0.8)),
        height: Math.max(50, Math.floor((h || 240) * 0.6)),
      }),
      videoConstraints,
      formatsToSupport: formats.length ? formats : undefined,
      experimentalFeatures: { useBarCodeDetectorIfSupported: opts.engine === 'auto' },
    };

    // Source de respaldo (solo se usa si videoConstraints se descarta por inválido)
    const source = { facingMode: opts.facingModeExact ?? opts.facingMode ?? 'environment' } as any;
    console.log(
      '[Scanner] engine source:',
      opts.cameraId ? `deviceId:${opts.cameraId.slice(0, 8)}…`
        : `facingMode:${videoConstraints.facingMode?.exact || videoConstraints.facingMode}`
    );

    try {
      await this.scanner.start(source, config, (decodedText) => {
        if (this.stopped) return;
        opts.onDetected(decodedText);
      }, () => {});
    } catch (err: any) {
      if (this.stopped) throw err;
      // Retry relajando el criterio exact si la cámara no lo soporta.
      if (err?.name === 'OverconstrainedError' || /overconstrain/i.test(err?.message || '')) {
        const fallback: any = { ...config };
        if (opts.cameraId) {
          // deviceId exact falló → mismo modelo de cámara pero por facing
          delete fallback.videoConstraints.deviceId;
          fallback.videoConstraints.facingMode = opts.facingModeExact ?? 'environment';
        } else {
          // facing exact falló → facing ideal (sin exigir)
          fallback.videoConstraints.facingMode = opts.facingModeExact ?? opts.facingMode ?? 'environment';
        }
        delete fallback.videoConstraints.width;
        delete fallback.videoConstraints.height;
        try {
          await this.scanner.start(source, fallback, (decodedText) => {
            if (this.stopped) return;
            opts.onDetected(decodedText);
          }, () => {});
          return;
        } catch (err2: any) {
          opts.onError?.(err2?.name || 'UnknownError', err2?.message || '');
          throw err2;
        }
      }
      opts.onError?.(err?.name || 'UnknownError', err?.message || '');
      throw err;
    }
    return; // porque la reconfiguración retorna antes
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (!this.scanner) return;
    try {
      const p = this.scanner.stop();
      if (p && typeof (p as any).catch === 'function') {
        await (p as Promise<void>).catch(() => {});
      }
    } catch {}
    try { this.scanner.clear(); } catch {}
    this.scanner = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async applyConstraints(constraints: MediaTrackConstraints): Promise<void> {
    const s: any = this.scanner;
    if (!s) return;
    try { await s.applyVideoConstraints(constraints as any); } catch {}
  }

  get capabilities(): MediaTrackCapabilities | null {
    try {
      return this.scanner?.getRunningTrackCapabilities?.() ?? null;
    } catch {
      return null;
    }
  }

  /** Track de video real (para capabilities/settings directos). */
  getVideoTrack(): MediaStreamTrack | null {
    try {
      const video = document.getElementById(this.containerId)?.querySelector('video') as HTMLVideoElement | null;
      const stream = video?.srcObject as MediaStream | null;
      const tracks = stream?.getVideoTracks?.() || [];
      return tracks[0] || null;
    } catch {
      return null;
    }
  }

  /** Describe la cámara real: tipo, resolución, foco, zoom. */
  describeCamera(): CameraInfo | null {
    try {
      const track = this.getVideoTrack();
      if (!track) return null;
      const cap: any = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
      const set: any = typeof track.getSettings === 'function' ? track.getSettings() : {};
      const facingRaw = String(set.facingMode || cap.facingMode || '');
      const facing = /environment/i.test(facingRaw) ? 'trasera'
        : /user/i.test(facingRaw) ? 'frontal'
        : /external/i.test(facingRaw) ? 'externa' : 'desconocida';
      const focusModes: string[] = Array.isArray(cap.focusMode) ? cap.focusMode : [];
      const zoom = cap.zoom || {};
      return {
        label: track.label || '',
        width: Number(set.width || 0),
        height: Number(set.height || 0),
        facing,
        focusModes,
        focus: String(set.focusMode || ''),
        zoomMin: Number(zoom.min ?? 1),
        zoomMax: Number(zoom.max ?? 1),
        hasTorch: !!cap.torch,
      };
    } catch {
      return null;
    }
  }

  /** Auto-configura la cámara para códigos: foco/exposición continuos si existen. */
  async applyOptimalDefaults(): Promise<void> {
    try {
      const track = this.getVideoTrack();
      const cap: any = (track as any)?.getCapabilities?.();
      if (!track || !cap) return;
      const advanced: any[] = [];
      if (Array.isArray(cap.focusMode) && cap.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      if (Array.isArray(cap.exposureMode) && cap.exposureMode.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' });
      }
      if (advanced.length && typeof (track as any).applyConstraints === 'function') {
        await (track as any).applyConstraints({ advanced });
        console.log('[Scanner] optimal defaults aplicados (foco/exposición continuos)');
      }
    } catch { /* noop */ }
  }

  /** Zoom óptico/digital (si la cámara lo soporta). */
  async setZoom(value: number): Promise<void> {
    try {
      const track = this.getVideoTrack();
      if (!track || typeof (track as any).applyConstraints !== 'function') return;
      await (track as any).applyConstraints({ advanced: [{ zoom: value }] });
    } catch { /* noop */ }
  }

  /**
   * Diagnóstico con getUserMedia CRUDO (sin html5-qrcode): enumera devices
   * e intenta abrir trasera/frontal exactas. Dice en pantalla qué puede el navegador.
   */
  async diagnoseCameras(): Promise<{
    devices: { label: string; id: string }[];
    rear: string;
    front: string;
    hasMediaDevices: boolean;
    secure: boolean;
  }> {
    const hasMediaDevices = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    const secure = typeof window !== 'undefined' && window.isSecureContext !== false;
    let devices: { label: string; id: string }[] = [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ label: d.label || `cámara ${i}`, id: d.deviceId || '' }));
    } catch { /* noop */ }
    const rear = await this.tryRawOpen({ facingMode: { exact: 'environment' } });
    const front = await this.tryRawOpen({ facingMode: { exact: 'user' } });
    return { devices, rear, front, hasMediaDevices, secure };
  }

  private async tryRawOpen(videoConstraints: any): Promise<string> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'FAIL sin-getUserMedia';
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      const track = stream.getVideoTracks()[0];
      const s: any = track?.getSettings?.() || {};
      const msg = `OK ${s.width || '?'}x${s.height || '?'} (${track?.label || 'sin label'})`;
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      return msg;
    } catch (e: any) {
      return `FAIL ${e?.name || '?'}${e?.message ? `: ${e.message}` : ''}`;
    }
  }
}