import type { BarcodeFormat } from '../types/scanner.types';
import { isScaleCode } from './scaleParser';

/**
 * Normalización de código, misma regla que `normalize_barcode()` en Postgres:
 *  trim → limpiar caracteres no válidos → uppercase para alfanuméricos
 *  UPC-A (12 dígitos) → '0' + código (equivale a EAN-13)
 *  EAN-8 / EAN-13 quedan tal cual
 */
export function normalizeCode(raw: string): string {
  if (!raw) return '';
  const t = raw.trim();
  if (/^\d{12}$/.test(t)) return '0' + t;
  return t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Inferencia razonable del formato según la forma del código normalizado. */
export function detectFormat(code: string): BarcodeFormat {
  const c = code.trim();
  if (isScaleCode(c)) return 'scale';
  if (!/^\d+$/.test(c)) {
    // URLs y payloads típicos de QR (facturas, pagos, links)
    if (/^(https?:\/\/|www\.)/i.test(c) || c.includes('://')) return 'qr';
    return c.startsWith('QR') ? 'qr' : 'code_128';
  }
  switch (c.length) {
    case 8:
      return 'ean_8';
    case 12:
      return 'upc_a';
    case 13:
      return 'ean_13';
    default:
      return 'unknown';
  }
}

function checkDigit(digits: number[]): number {
  // desde el más a la derecha: peso 3,1,3,1...
  let sum = 0;
  for (let j = 0; j < digits.length; j++) {
    const d = digits[digits.length - 1 - j];
    sum += j % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Valida dígito de control EAN-8 / EAN-13 / UPC-A. Alfanumérico pasa. */
export function plausibleCode(code: string): { ok: boolean; reason?: 'vacío' | 'longitud' | 'dígito' } {
  const c = normalizeCode(code);
  if (!c) return { ok: false, reason: 'vacío' };
  if (!/^\d+$/.test(c)) return { ok: true };
  if (c.length !== 8 && c.length !== 12 && c.length !== 13) {
    return { ok: false, reason: 'longitud' };
  }
  const digits = c.split('').map(Number);
  const check = digits.pop()!;
  if (checkDigit(digits) !== check) return { ok: false, reason: 'dígito' };
  return { ok: true };
}