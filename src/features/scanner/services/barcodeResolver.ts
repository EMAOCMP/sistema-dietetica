import { supabase } from '../../../lib/supabase';
import type { BarcodeResolution } from '../types/scanner.types';
import { normalizeCode, plausibleCode } from './barcodeNormalizer';

type ProductRow = {
  id: string;
  name: string;
  stock_quantity?: number | null;
  retail_price?: number | null;
  wholesale_price?: number | null;
  cost_price?: number | null;
  category?: string | null;
  unit_type?: string | null;
  barcode?: string | null;
};

function toProductLite(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    stock_quantity: row.stock_quantity == null ? undefined : Number(row.stock_quantity),
    retail_price: row.retail_price == null ? undefined : Number(row.retail_price),
    wholesale_price: row.wholesale_price == null ? undefined : Number(row.wholesale_price),
    cost_price: row.cost_price == null ? undefined : Number(row.cost_price),
    category: row.category ?? null,
    unit_type: row.unit_type ?? undefined,
    barcode: row.barcode ?? undefined,
  };
}

/**
 * Única puerta entre el escaneo y la base.
 * Scanner Core = detectar; aquí se interpreta.
 *   normalize → validate → busca en product_barcodes (barcode_normalized)
 *   → found | not_found | invalid
 */
export async function resolveBarcode(rawCode: string): Promise<BarcodeResolution> {
  const normalized = normalizeCode(rawCode);
  if (!normalized) {
    return { status: 'invalid', barcode: rawCode, normalizedBarcode: '', reason: 'vacío' };
  }

  // Validación previa (checksum EAN/UPC; alfanumérico pasa)
  const valid = plausibleCode(normalized);
  if (!valid.ok) {
    const reason = valid.reason === 'dígito'
      ? 'dígito de control no cierra'
      : valid.reason === 'longitud'
        ? 'longitud no válida'
        : 'vacío';
    return { status: 'invalid', barcode: normalizeCode(rawCode), normalizedBarcode: normalized, reason };
  }

  let alias: { product_id: string; products: ProductRow | null } | null = null;
  try {
    const { data } = await supabase
      .from('product_barcodes')
      .select('product_id, products(id, name, stock_quantity, retail_price, wholesale_price, cost_price, category, unit_type, barcode)')
      .eq('barcode_normalized', normalized)
      .eq('active', true)
      .maybeSingle();
    alias = (data as any) ?? null;
  } catch { /* tabla puede no existir todavía */ }

  if (alias?.products) {
    console.log('[BarcodeResolver] alias-found', normalized);
    return {
      status: 'found',
      barcode: normalized,
      normalizedBarcode: normalized,
      product: toProductLite(alias.products),
      matchedVia: 'alias',
    };
  }

  // Campo primario (compat hasta migrar todo el catálogo a product_barcodes)
  try {
    const { data } = await supabase
      .from('products')
      .select('id, name, stock_quantity, retail_price, wholesale_price, cost_price, category, unit_type, barcode')
      .eq('barcode', normalized)
      .maybeSingle();
    if (data) {
      console.log('[BarcodeResolver] primary-found', normalized);
      return {
        status: 'found',
        barcode: normalized,
        normalizedBarcode: normalized,
        product: toProductLite(data as ProductRow),
        matchedVia: 'primary',
      };
    }
  } catch { /* noop */ }

  console.log('[BarcodeResolver] not-found', normalized);
  return { status: 'not_found', barcode: normalized, normalizedBarcode: normalized };
}