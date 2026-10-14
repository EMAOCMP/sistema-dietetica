import { normalizeCode, plausibleCode } from './barcodeNormalizer';

export interface NewBarcodeCheck {
  ok: boolean;
  code: string;
  reason?: string;
}

export interface DuplicateHit {
  type: 'none' | 'same-product' | 'other-product';
  product?: { id?: string; name: string };
}

/** Valida formato/checksum de un código para alta (sin DB). */
export function validateBarcode(raw: string): NewBarcodeCheck {
  const code = normalizeCode(raw);
  if (!code) return { ok: false, code: '', reason: 'vacío' };
  const v = plausibleCode(code);
  if (!v.ok) {
    return {
      ok: false,
      code,
      reason: v.reason === 'dígito' ? 'dígito de control no cierra' : v.reason === 'longitud' ? 'longitud no válida' : 'vacío',
    };
  }
  return { ok: true, code };
}

export interface ExistingEntry {
  id?: string;
  barcode?: string | null;
  name: string;
}

/** Duplicados contra la lista local (sin DB). */
export function findDuplicate(
  code: string,
  existing: ExistingEntry[],
  editingId?: string | null
): DuplicateHit {
  const norm = normalizeCode(code);
  if (!norm) return { type: 'none' };
  const hit = existing.find((p) => p.barcode && normalizeCode(p.barcode) === norm);
  if (!hit) return { type: 'none' };
  if (editingId && hit.id === editingId) return { type: 'same-product', product: hit };
  // Sin editingId, cualquier coincidencia es de "otro" (alta nueva)
  if (!editingId) return { type: 'other-product', product: hit };
  return { type: 'other-product', product: hit };
}
