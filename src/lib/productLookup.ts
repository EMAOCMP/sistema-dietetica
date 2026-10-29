import { resolveBarcode } from '../features/scanner/services/barcodeResolver';
import { normalizeCode as normalizeScannerCode } from '../features/scanner/services/barcodeNormalizer';

export interface FoundProduct {
  id: string;
  name: string;
  stock_quantity: number;
  retail_price: number;
  wholesale_price: number;
  category?: string | null;
  barcode: string;
  matchedVia: 'primary' | 'alias';
}

/**
 * Normaliza: trim + solo dígitos/letras básicos.
 * Nota: el normalizador canónico del escáner (features/scanner) es más estricto
 * (uppercase, quita separadores y convierte UPC-A de 12 a EAN-13).
 * Este se mantiene simple para no romper los match locales con alias cacheados.
 */
export function normalizeCode(raw: string): string {
  return (raw || '').trim();
}

/** Valida dígito de control EAN-8 / EAN-13 / UPC-A. Otros formatos pasan. */
export function isPlausibleCode(code: string): { ok: boolean; reason?: string } {
  const c = normalizeCode(code);
  if (!c) return { ok: false, reason: 'vacío' };
  if (!/^\d+$/.test(c)) return { ok: true }; // alfanuméricos (CODE-39/128, QR): sin checksum
  if (c.length !== 8 && c.length !== 12 && c.length !== 13) {
    return { ok: false, reason: 'longitud' };
  }
  const digits = c.split('').map(Number);
  const check = digits.pop()!;
  // EAN/UPC: peso 3,1,3,1... empezando por el dígito de datos más a la derecha
  let sum = 0;
  for (let j = 0; j < digits.length; j++) {
    const d = digits[digits.length - 1 - j];
    sum += j % 2 === 0 ? d * 3 : d;
  }
  const calc = (10 - (sum % 10)) % 10;
  if (calc !== check) return { ok: false, reason: 'dígito' };
  return { ok: true };
}

/**
 * Busca producto por código delegando en el resolver canónico del escáner
 * (que consulta `product_barcodes.barcode_normalized` + `active = true`).
 * Antes esta función duplicaba la lógica con reglas distintas y devolvía
 * aliases desactivados.
 */
export async function findProductByBarcode(rawCode: string): Promise<FoundProduct | null> {
  const code = normalizeScannerCode(rawCode);
  if (!code) return null;

  const resolution = await resolveBarcode(code);
  if (resolution.status !== 'found' || !resolution.product) return null;

  const p = resolution.product as any;
  return {
    id: p.id,
    name: p.name,
    stock_quantity: Number(p.stock_quantity ?? 0),
    retail_price: Number(p.retail_price ?? 0),
    wholesale_price: Number(p.wholesale_price ?? 0),
    category: p.category ?? null,
    barcode: p.barcode || code,
    matchedVia: resolution.matchedVia === 'alias' ? 'alias' : 'primary',
  };
}

/** Match local (caché offline): campo primario + aliases cacheados. */
export function matchLocalProduct(
  products: any[],
  rawCode: string
): any | undefined {
  const code = normalizeCode(rawCode);
  if (!code) return undefined;
  return products.find(
    (p) => p.barcode === code || (Array.isArray(p.aliasBarcodes) && p.aliasBarcodes.includes(code))
  );
}
