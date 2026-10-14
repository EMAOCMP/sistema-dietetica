import { supabase } from './supabase';
import { normalizeCode } from '../features/scanner/services/barcodeNormalizer';

export interface ProductBarcodeResult {
  created: boolean;
  error?: string;
}

/**
 * Único punto de la app que ESCRIBE en product_barcodes (v2).
 * Las consultas del escáner pasan por barcodeResolver; acá se registra el
 * código al dar de alta/editar un producto (también para el sync offline).
 * Idempotente por barcode_normalized (el índice único parcial lo garantiza en DB).
 */
export async function upsertProductBarcode(
  productId: string,
  barcode: string,
  opts?: { is_primary?: boolean; barcode_type?: string }
): Promise<ProductBarcodeResult> {
  const code = (barcode || '').trim();
  if (!code) return { created: false };

  try {
    const normalized = normalizeCode(code);
    if (!normalized) return { created: false, error: 'Código inválido' };

    const { data: existing } = await supabase
      .from('product_barcodes')
      .select('id, product_id')
      .eq('barcode_normalized', normalized)
      .maybeSingle();

    if (existing) {
      if (existing.product_id === productId) return { created: false };
      return { created: false, error: 'Ese código ya pertenece a otro producto' };
    }

    const { error } = await supabase.from('product_barcodes').insert({
      product_id: productId,
      barcode: code,
      barcode_type: opts?.barcode_type ?? 'EAN-13',
      is_primary: opts?.is_primary ?? true,
    });
    if (error) return { created: false, error: error.message };
    return { created: true };
  } catch (e: any) {
    return { created: false, error: e?.message || 'Error registrando el código' };
  }
}

/**
 * Desactiva los códigos de un producto (al limpiar el campo barcode).
 */
export async function deactivateBarcodes(productId: string): Promise<ProductBarcodeResult> {
  try {
    const { error } = await supabase
      .from('product_barcodes')
      .update({ active: false })
      .eq('product_id', productId);
    if (error) return { created: false, error: error.message };
    return { created: false };
  } catch (e: any) {
    return { created: false, error: e?.message || 'Error actualizando códigos' };
  }
}