/**
 * ImageScannerEngine (V3): decodifica foto/archivo (sin stream, sin permisos).
 * Estrategia en cascada (rápido → robusto):
 *   1. BarcodeDetector nativo (mejor con blur/rotación), si disponible.
 *   2. ZXing (scanFile) sobre el archivo original.
 *   3. TRY_HARDER con timeout (2s c/u): gris, foco, otsu, recortes.
 */
export class ImageScannerEngine {
  private helperId: string;

  constructor(helperId = 'barcode-file-helper') {
    this.helperId = helperId;
  }

  async decode(file: File, onProgress?: (stage: string) => void): Promise<string> {
    const stage = (s: string) => {
      console.log('[Scanner]', s);
      try { onProgress?.(s); } catch { /* noop */ }
    };
    // Silenciar el spam interno de ZXing (warnings por cada intento fallido)
    const origWarn = console.warn;
    const muffledWarn = (...args: any[]) => {
      try {
        const first = String(args?.[0] ?? '');
        if (first.includes('MultiFormatReader') || first.includes('NotFoundException')) return;
      } catch { /* noop */ }
      origWarn(...args);
    };

    stage('image-start');
    console.warn = muffledWarn as any;
    try {
      // 1. Nativo
      try {
        const bitmap = await createImageBitmap(file);
        try {
          const native = await this.detectNative(bitmap);
          if (native) {
            console.log('[Scanner] detected (image-native)');
            return native;
          }
        } finally {
          try { bitmap.close(); } catch { /* noop */ }
        }
      } catch { /* sigue */ }
      stage('image-native-no');

      // 2. ZXing rápido sobre el archivo original
      try {
        const raw = await this.scanFile(file);
        if (raw) {
          console.log('[Scanner] detected (image)');
          return raw;
        }
      } catch { /* sigue a Quagga */ }
      stage('image-zxing-orig-no');

      // 3. Quagga2 (localiza la banda primero; bueno con curvas/logos/blur)
      const qplan: { label: string; file: File }[] = [{ label: 'quagga-orig', file }];
      for (const deg of [0, 90] as const) {
        const g = await this.buildOne(file, 'gray', deg, false);
        if (g) qplan.push({ label: `quagga-gray${deg}`, file: g });
      }
      for (const q of qplan) {
        stage(`image-quagga ${q.label}`);
        try {
          const raw = await this.withTimeout(this.decodeQuagga(q.file), 2500, q.label);
          if (raw) {
            console.log('[Scanner] detected (image-quagga)', q.label);
            return raw;
          }
        } catch { /* probar siguiente */ }
      }
      stage('image-quagga-no');

      // 4. ZXing TRY_HARDER con timeout por intento (1.2s)
      const plan: { label: string; mode: 'gray' | 'sharp' | 'upgray' | 'adapt' | 'otsu'; deg: 0 | 90; crop: boolean }[] = [
        { label: 'gray0', mode: 'gray', deg: 0, crop: false },
        { label: 'gray90', mode: 'gray', deg: 90, crop: false },
        { label: 'sharp0', mode: 'sharp', deg: 0, crop: false },
        { label: 'sharp90', mode: 'sharp', deg: 90, crop: false },
        { label: 'upgray0', mode: 'upgray', deg: 0, crop: false },
        { label: 'upgray90', mode: 'upgray', deg: 90, crop: false },
        { label: 'adapt0', mode: 'adapt', deg: 0, crop: false },
        { label: 'adapt90', mode: 'adapt', deg: 90, crop: false },
        { label: 'otsu0', mode: 'otsu', deg: 0, crop: false },
        { label: 'gray0-crop', mode: 'gray', deg: 0, crop: true },
        { label: 'gray90-crop', mode: 'gray', deg: 90, crop: true },
      ];
      console.log('[Scanner] image-tryharder plan:', plan.map((p) => p.label).join(','));
      let ran = 0;
      for (const step of plan) {
        stage(`image-tryharder ${step.label}`);
        try {
          const v = await this.buildOne(file, step.mode, step.deg, step.crop);
          if (!v) continue;
          ran++;
          const raw = await this.withTimeout(this.decodeTryHarder(v), 1200, step.label);
          if (raw) {
            console.log('[Scanner] detected (image-tryharder)', step.label);
            return raw;
          }
        } catch { /* probar siguiente */ }
      }
      console.log('[Scanner] image-summary: tryharder ran', ran, 'sin lectura');
      throw new Error('unreadable');
    } finally {
      console.warn = origWarn;
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const to = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`timeout ${label}`)), ms);
    });
    return Promise.race([p.finally(() => { if (t) clearTimeout(t); }), to]) as Promise<T>;
  }

  /** Quagga2: localiza la banda del código primero (curvas, logos, blur). */
  private async decodeQuagga(file: File): Promise<string | null> {
    const Quagga = (await import('@ericblade/quagga2')).default;
    const url = URL.createObjectURL(file);
    try {
      const result: any = await new Promise((resolve) => {
        try {
          Quagga.decodeSingle(
            {
              src: url,
              numOfWorkers: 0,
              inputStream: { size: 1280 },
              locator: { patchSize: 'medium', halfSample: true },
              decoder: { readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'code_128_reader'] },
              locate: true,
            } as any,
            (res: any) => resolve(res || null)
          );
        } catch {
          resolve(null);
        }
      });
      const code = result?.codeResult?.code;
      return typeof code === 'string' && code ? code : null;
    } finally {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    }
  }

  /** ZXing con TRY_HARDER: más esfuerzo, prueba rotaciones internamente. */
  private async decodeTryHarder(file: File): Promise<string | null> {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.QR_CODE,
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      const text = result?.getText?.();
      return typeof text === 'string' && text ? text : null;
    } finally {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
      try { (reader as any).reset?.(); } catch { /* noop */ }
    }
  }

  /** Autotest: genera un EAN-13 perfecto (dibujado a mano) y lo pasa por decode(). ✅ = pipeline sano. */
  async selfTest(onProgress?: (stage: string) => void): Promise<{ ok: boolean; code: string | null; detail: string }> {
    try {
      const canvas = this.renderEan13('7791120037559', 3);
      if (!canvas) return { ok: false, code: null, detail: 'no-canvas' };
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) return { ok: false, code: null, detail: 'no-blob' };
      const file = new File([blob], 'selftest.png', { type: 'image/png' });
      const code = await this.decode(file, onProgress);
      return { ok: code === '7791120037559', code, detail: code === '7791120037559' ? 'perfect' : 'mismatch' };
    } catch (e: any) {
      return { ok: false, code: null, detail: e?.message || 'error' };
    }
  }

  /** Dibuja un EAN-13 válido (tablas L/G/R + paridad del primer dígito). */
  private renderEan13(code13: string, modulePx = 3): HTMLCanvasElement | null {
    try {
      if (!/^\d{13}$/.test(code13)) return null;
      const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
      const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
      const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
      const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
      const first = Number(code13[0]);
      const left = code13.slice(1, 7).split('');
      const right = code13.slice(7, 13).split('');
      const par = PARITY[first];
      let bits = '101';
      left.forEach((ch, i) => {
        const d = Number(ch);
        bits += par[i] === 'G' ? G[d] : L[d];
      });
      bits += '01010';
      right.forEach((ch) => { bits += R[Number(ch)]; });
      bits += '101';
      const quiet = 10;
      const W = (bits.length + quiet * 2) * modulePx;
      const barH = 90;
      const textH = 22;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = barH + textH + 8;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let i = 0; i < bits.length; i++) {
        if (bits[i] === '1') ctx.fillRect((quiet + i) * modulePx, 0, modulePx, barH);
      }
      ctx.font = `bold ${textH - 6}px monospace`;
      ctx.textBaseline = 'top';
      ctx.fillText(code13[0], 2, barH + 4);
      ctx.fillText(code13.slice(1, 7), (quiet + 3) * modulePx + 2, barH + 4);
      ctx.fillText(code13.slice(7, 13), (quiet + 3 + 42 + 5) * modulePx + 2, barH + 4);
      return canvas;
    } catch {
      return null;
    }
  }

  /** Variantes como dataURL para mostrar "lo que ve el lector" (debug visual). */
  async collectDebugVariants(file: File): Promise<{ label: string; url: string }[]> {
    const out: { label: string; url: string }[] = [];
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const MAX = 1280;
        const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const jobs: { label: string; mode: 'gray' | 'sharp' | 'adapt' | 'otsu'; deg: 0 | 90; crop: boolean }[] = [
          { label: 'gris 0°', mode: 'gray', deg: 0, crop: false },
          { label: 'gris 90°', mode: 'gray', deg: 90, crop: false },
          { label: 'foco 0°', mode: 'sharp', deg: 0, crop: false },
          { label: 'adapt 0°', mode: 'adapt', deg: 0, crop: false },
          { label: 'otsu 0°', mode: 'otsu', deg: 0, crop: false },
          { label: 'recorte', mode: 'gray', deg: 0, crop: true },
        ];
        for (const j of jobs) {
          try {
            let canvas = this.renderRotation(bitmap, w, h, j.deg);
            if (!canvas) continue;
            if (j.crop) {
              const cw = canvas.width;
              const ch = canvas.height;
              const y0 = Math.floor(ch * 0.2);
              const y1 = Math.ceil(ch * 0.8);
              if (y1 - y0 >= 40) {
                const cut = document.createElement('canvas');
                cut.width = cw;
                cut.height = y1 - y0;
                const cctx = cut.getContext('2d');
                if (cctx) {
                  cctx.drawImage(canvas, 0, y0, cw, y1 - y0, 0, 0, cw, y1 - y0);
                  canvas = cut;
                }
              }
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            if (j.mode === 'gray') this.autocontrast(ctx, canvas.width, canvas.height);
            else if (j.mode === 'sharp') this.sharpen(ctx, canvas.width, canvas.height);
            else if (j.mode === 'adapt') this.binarizeAdaptive(ctx, canvas.width, canvas.height);
            else this.binarizeOtsu(ctx, canvas.width, canvas.height);
            out.push({ label: j.label, url: canvas.toDataURL('image/jpeg', 0.85) });
          } catch { /* saltear */ }
        }
      } finally {
        try { bitmap.close(); } catch { /* noop */ }
      }
    } catch { /* noop */ }
    return out;
  }

  private async detectNative(bitmap: ImageBitmap): Promise<string | null> {
    const BD = (window as any).BarcodeDetector;
    if (!BD) return null;
    try {
      const detector = new BD({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
      });
      const res = await detector.detect(bitmap);
      const v = res?.[0]?.rawValue;
      return typeof v === 'string' && v ? v : null;
    } catch {
      return null;
    }
  }

  private async scanFile(blob: Blob): Promise<string | null> {
    const { Html5Qrcode } = await import('html5-qrcode');
    const helper = new Html5Qrcode(this.helperId);
    try {
      const f = blob instanceof File ? blob : new File([blob], 'scan.jpg', { type: 'image/jpeg' });
      // showImage=false: el helper vive en un div oculto; no depender del render visible
      const decoded = await helper.scanFile(f, false);
      return decoded || null;
    } finally {
      try { helper.clear(); } catch { /* noop */ }
    }
  }

  private async buildOne(
    file: File,
    mode: 'gray' | 'sharp' | 'upgray' | 'adapt' | 'otsu',
    deg: 0 | 90 | 180 | 270,
    crop = false
  ): Promise<File | null> {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const MAX = mode === 'upgray' ? 1600 : 1280;
        const base = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
        // upgray: x2 para dar más píxeles por módulo (capped a MAX)
        const up = mode === 'upgray' ? Math.min(2, MAX / Math.max(bitmap.width * base, bitmap.height * base)) : 1;
        const scale = base * up;
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        let canvas = this.renderRotation(bitmap, w, h, deg);
        if (!canvas) return null;
        // Recorte banda central (20%→80% vertical): esquiva logos/textos de bordes.
        // Seguro para EAN (cualquier banda horizontal con barras completas lee).
        if (crop) {
          const cw = canvas.width;
          const ch = canvas.height;
          const y0 = Math.floor(ch * 0.2);
          const y1 = Math.ceil(ch * 0.8);
          if (y1 - y0 >= 40) {
            const cut = document.createElement('canvas');
            cut.width = cw;
            cut.height = y1 - y0;
            const cctx = cut.getContext('2d');
            if (cctx) {
              cctx.drawImage(canvas, 0, y0, cw, y1 - y0, 0, 0, cw, y1 - y0);
              canvas = cut;
            }
          }
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        if (mode === 'gray' || mode === 'upgray') this.autocontrast(ctx, canvas.width, canvas.height);
        else if (mode === 'sharp') this.sharpen(ctx, canvas.width, canvas.height);
        else if (mode === 'adapt') this.binarizeAdaptive(ctx, canvas.width, canvas.height);
        else this.binarizeOtsu(ctx, canvas.width, canvas.height);
        const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
        if (!blob) return null;
        return new File([blob], `scan-${mode}-${deg}${crop ? '-crop' : ''}.jpg`, { type: 'image/jpeg' });
      } finally {
        try { bitmap.close(); } catch { /* noop */ }
      }
    } catch {
      return null;
    }
  }

  private renderRotation(bitmap: ImageBitmap, w: number, h: number, deg: 0 | 90 | 180 | 270): HTMLCanvasElement | null {
    try {
      const canvas = document.createElement('canvas');
      const rot = deg === 90 || deg === 270;
      canvas.width = rot ? h : w;
      canvas.height = rot ? w : h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
      return canvas;
    } catch {
      return null;
    }
  }

  private autocontrast(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    try {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const n = (d.length / 4) | 0;
      const gray = new Uint8ClampedArray(n);
      let min = 255;
      let max = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        gray[j] = g;
        if (g < min) min = g;
        if (g > max) max = g;
      }
      if (max - min < 8) return;
      const range = max - min;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const g = ((gray[j] - min) / range) * 255;
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
    } catch { /* noop */ }
  }

  /** Máscara de enfoque contra blur: gris → blur caja r=2 → unsharp → estirar. */
  private sharpen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    try {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const n = (d.length / 4) | 0;
      const gray = new Float32Array(n);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      }
      // Blur separable r=2 (dos pasadas caja r=1)
      const tmp = new Float32Array(n);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const xm = x > 0 ? x - 1 : x;
          const xp = x < w - 1 ? x + 1 : x;
          tmp[y * w + x] = (gray[y * w + xm] + gray[y * w + x] * 2 + gray[y * w + xp]) / 4;
        }
      }
      const blur = new Float32Array(n);
      for (let y = 0; y < h; y++) {
        const ym = y > 0 ? y - 1 : y;
        const yp = y < h - 1 ? y + 1 : y;
        for (let x = 0; x < w; x++) {
          blur[y * w + x] = (tmp[ym * w + x] + tmp[y * w + x] * 2 + tmp[yp * w + x]) / 4;
        }
      }
      let min = 255;
      let max = 0;
      const out = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const v = gray[j] + 1.4 * (gray[j] - blur[j]);
        out[j] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const range = max - min || 1;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const g = Math.max(0, Math.min(255, ((out[j] - min) / range) * 255));
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
    } catch { /* noop */ }
  }

  /** Umbral Otsu: deja barras negras puras sobre fondo blanco (ideal bajo contraste). */
  private binarizeOtsu(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    try {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const hist = new Array(256).fill(0);
      const n = (d.length / 4) | 0;
      for (let i = 0; i < d.length; i += 4) {
        const g = ((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0;
        hist[g]++;
      }
      let sum = 0;
      for (let t = 0; t < 256; t++) sum += t * hist[t];
      let sumB = 0;
      let wB = 0;
      let maxVar = -1;
      let threshold = 128;
      for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = n - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) {
          maxVar = between;
          threshold = t;
        }
      }
      for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        const v = g > threshold ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
    } catch { /* noop */ }
  }

  /**
   * Umbral adaptativo (Bradley): umbral por zona vía imagen integral.
   * Robusto con glare/degradados donde Otsu global falla. Tinta oscura → negro.
   */
  private binarizeAdaptive(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    try {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const n = w * h;
      const gray = new Float32Array(n);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      }
      // Imagen integral
      const int = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let rowSum = 0;
        for (let x = 0; x < w; x++) {
          rowSum += gray[y * w + x];
          int[(y + 1) * (w + 1) + (x + 1)] = int[y * (w + 1) + (x + 1)] + rowSum;
        }
      }
      const s = Math.max(15, Math.floor(Math.min(w, h) / 8));
      const half = (s / 2) | 0;
      const t = 0.92;
      for (let y = 0; y < h; y++) {
        const y1 = Math.max(0, y - half);
        const y2 = Math.min(h - 1, y + half);
        for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - half);
          const x2 = Math.min(w - 1, x + half);
          const count = (x2 - x1 + 1) * (y2 - y1 + 1);
          const area = int[(y2 + 1) * (w + 1) + (x2 + 1)]
            - int[y1 * (w + 1) + (x2 + 1)]
            - int[(y2 + 1) * (w + 1) + x1]
            + int[y1 * (w + 1) + x1];
          const mean = area / count;
          const v = gray[y * w + x] < mean * t ? 0 : 255;
          const i = (y * w + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
      ctx.putImageData(img, 0, 0);
    } catch { /* noop */ }
  }
}
