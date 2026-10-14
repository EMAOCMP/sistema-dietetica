import { describe, expect, it } from 'vitest';
import { findDuplicate, validateBarcode } from '../barcodeValidator';

describe('barcodeValidator', () => {
  it('acepta EAN-13 con checksum correcto', () => {
    const r = validateBarcode('5901234123457');
    expect(r.ok).toBe(true);
    expect(r.code).toBe('5901234123457');
  });

  it('rechaza vacío', () => {
    expect(validateBarcode('').ok).toBe(false);
    expect(validateBarcode('   ').ok).toBe(false);
  });

  it('rechaza checksum incorrecto', () => {
    const r = validateBarcode('5901234123458');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dígito de control no cierra');
  });

  it('normaliza UPC-A a EAN-13', () => {
    const r = validateBarcode('123456789012');
    expect(r.code).toBe('0123456789012');
  });

  it('detecta duplicado en otro producto', () => {
    const existing = [
      { id: 'a', barcode: '7791234567890', name: 'Yerba' },
      { id: 'b', barcode: '111', name: 'Azúcar' },
    ];
    const hit = findDuplicate('7791234567890', existing, null);
    expect(hit.type).toBe('other-product');
    expect(hit.product?.name).toBe('Yerba');
  });

  it('permite el mismo producto en edición', () => {
    const existing = [{ id: 'a', barcode: '7791234567890', name: 'Yerba' }];
    expect(findDuplicate('7791234567890', existing, 'a').type).toBe('same-product');
  });

  it('no reporta cuando no hay coincidencia', () => {
    const existing = [{ id: 'a', barcode: '7791234567890', name: 'Yerba' }];
    expect(findDuplicate('9999999999999', existing, null).type).toBe('none');
  });
});
