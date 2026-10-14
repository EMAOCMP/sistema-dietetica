import { normalizeCode } from '../services/barcodeNormalizer';

export interface HardwareEngineCallbacks {
  onDetected: (raw: string) => void;
}

/**
 * HardwareScannerEngine (V3): lector USB/Bluetooth como teclado (código + ENTER).
 * Clase sin React; el hook `useHardwareScanner` delega en ella.
 */
export class HardwareScannerEngine {
  private buffer = '';
  private lastKeyAt = 0;
  private listening = false;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private cb: HardwareEngineCallbacks;

  constructor(cb: HardwareEngineCallbacks) {
    this.cb = cb;
  }

  setCallbacks(cb: HardwareEngineCallbacks): void {
    this.cb = cb;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );
      if (isTyping) return;

      const now = Date.now();
      if (this.buffer && now - this.lastKeyAt > 400) {
        this.buffer = '';
      }
      this.lastKeyAt = now;

      if (e.key === 'Enter') {
        const code = normalizeCode(this.buffer);
        this.buffer = '';
        if (code) {
          e.preventDefault();
          console.log('[Scanner] detected (hardware)', code);
          this.cb.onDetected(code);
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.buffer += e.key;
      } else if (e.key === 'Backspace') {
        this.buffer = this.buffer.slice(0, -1);
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  }

  stop(): void {
    this.listening = false;
    this.buffer = '';
    if (this.onKeyDown) {
      window.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }
  }

  isListening(): boolean {
    return this.listening;
  }
}
