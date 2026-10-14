import { describe, expect, it } from 'vitest';
import { detectFormat, normalizeCode } from '../barcodeNormalizer';

describe('barcodeNormalizer formats', () => {
  it('detecta QR por URL', () => {
    expect(detectFormat('https://example.com/pago/123')).toBe('qr');
    expect(detectFormat('http://afip.gob.ar/qr')).toBe('qr');
    expect(detectFormat('www.tienda.com')).toBe('qr');
  });

  it('mantiene EAN/UPC/escala', () => {
    expect(detectFormat('5901234123457')).toBe('ean_13');
    expect(detectFormat('2000123012505')).toBe('scale');
    expect(detectFormat('12345678')).toBe('ean_8');
  });

  it('alfanumérico corto sigue siendo code_128', () => {
    expect(detectFormat('ABC123')).toBe('code_128');
  });

  it('normalizeCode no rompe URLs (resolver dirá not_found)', () => {
    const n = normalizeCode('https://example.com/x?y=1');
    expect(n.length).toBeGreaterThan(0);
    expect(/^[A-Z0-9]+$/.test(n)).toBe(true);
  });
});
