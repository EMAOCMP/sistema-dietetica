import { supabase } from './supabase';

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

/** Normaliza: trim + solo dígitos/letras básicos */
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

/** Busca producto por código: primero aliases, después campo primario. */
export async function findProductByBarcode(rawCode: string): Promise<FoundProduct | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  // 1. Aliases
  try {
    const { data: alias } = await supabase
      .from('product_barcodes')
      .select('product_id, products(id, name, stock_quantity, retail_price, wholesale_price, category, barcode)')
      .eq('barcode', code)
      .maybeSingle();
    const p: any = (alias as any)?.products;
    if (p) {
      return {
        id: p.id,
        name: p.name,
        stock_quantity: Number(p.stock_quantity),
        retail_price: Number(p.retail_price),
        wholesale_price: Number(p.wholesale_price),
        category: p.category,
        barcode: code,
        matchedVia: 'alias',
      };
    }
  } catch { /* tabla puede no existir todavía */ }

  // 2. Campo primario
  try {
    const { data } = await supabase
      .from('products')
      .select('id, name, stock_quantity, retail_price, wholesale_price, category, barcode')
      .eq('barcode', code)
      .maybeSingle();
    if (data) {
      return { ...(data as any), stock_quantity: Number((data as any).stock_quantity), retail_price: Number((data as any).retail_price), wholesale_price: Number((data as any).wholesale_price), barcode: code, matchedVia: 'primary' };
    }
  } catch { /* noop */ }
  return null;
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
