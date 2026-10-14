import type { ScanResult } from '../types/scanner.types';

/** Regla V3 §12: mismo normalizedCode + <windowMs = ignorar. */
export const DEFAULT_WINDOW_MS = 800;

/**
 * Anti-duplicados central del Scanner Core.
 * Descarta lecturas repetidas del mismo código dentro de la ventana,
 * dejando pasar códigos distintos (escaneo rápido encadenado) al instante.
 */
export class ScanGuard {
  lastCodeValue = '';
  lastScanTimeValue = 0;
  locked = false;
  private windowMs: number;

  constructor(windowMs: number = DEFAULT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** Devuelve el ScanResult si debe procesarse, o null si es duplicado. */
  accept(result: ScanResult): ScanResult | null {
    const now = result.scannedAt;
    const same = result.normalizedCode === this.lastCodeValue;
    const within = now - this.lastScanTimeValue < this.windowMs;

    if (same && within && this.locked) {
      return null;
    }

    this.lastCodeValue = result.normalizedCode;
    this.lastScanTimeValue = now;
    this.locked = true;
    return result;
  }

  /** Libera el lock sin perder el último código (para reintentos conscientes). */
  clearLock(): void {
    this.locked = false;
  }

  reset(): void {
    this.lastCodeValue = '';
    this.lastScanTimeValue = 0;
    this.locked = false;
  }
}
