import { describe, it, expect } from 'vitest';
import { isPlausibleCode, normalizeCode, matchLocalProduct } from '../productLookup';

describe('normalizeCode', () => {
  it('trimmea espacios', () => {
    expect(normalizeCode('  7791234  ')).toBe('7791234');
  });
  it('vacío queda vacío', () => {
    expect(normalizeCode('')).toBe('');
  });
});

describe('isPlausibleCode', () => {
  it('acepta EAN-13 válido (ejemplo Wikipedia)', () => {
    expect(isPlausibleCode('4006381333931').ok).toBe(true);
  });
  it('rechaza EAN-13 con dígito mal', () => {
    expect(isPlausibleCode('4006381333932').ok).toBe(false);
  });
  it('acepta EAN-8 válido', () => {
    // 96385074: check válido
    expect(isPlausibleCode('96385074').ok).toBe(true);
  });
  it('rechaza longitud rara numérica', () => {
    expect(isPlausibleCode('12345').ok).toBe(false);
  });
  it('pasa alfanuméricos (CODE-39/QR sin checksum)', () => {
    expect(isPlausibleCode('ABC-123').ok).toBe(true);
  });
  it('rechaza vacío', () => {
    expect(isPlausibleCode('   ').ok).toBe(false);
  });
});

describe('matchLocalProduct', () => {
  const products = [
    { id: '1', barcode: '7790001', name: 'A', aliasBarcodes: ['111', '222'] },
    { id: '2', barcode: '7790002', name: 'B' },
  ];
  it('matchea primario', () => {
    expect(matchLocalProduct(products, '7790001')?.id).toBe('1');
  });
  it('matchea alias', () => {
    expect(matchLocalProduct(products, '222')?.id).toBe('1');
  });
  it('trimmea antes de matchear', () => {
    expect(matchLocalProduct(products, ' 7790002 ')?.id).toBe('2');
  });
  it('undefined si no existe', () => {
    expect(matchLocalProduct(products, '999')).toBeUndefined();
  });
});
