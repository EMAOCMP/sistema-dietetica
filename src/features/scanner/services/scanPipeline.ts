import { detectFormat, normalizeCode, plausibleCode } from './barcodeNormalizer';
import { resolveBarcode } from './barcodeResolver';
import { parseScaleCode } from './scaleParser';
import type {
  BarcodeResolution,
  ProductLite,
  ScanResult,
  ScannerSource,
} from '../types/scanner.types';

export interface PipelineDeps {
  /** Resolver central (default: resolveBarcode contra Supabase). */
  resolve?: (normalized: string) => Promise<BarcodeResolution>;
  /** Lookup de PLU de balanza en catálogo local (para matches 'scale'). */
  lookupPlu?: (plu: string) => ProductLite | null;
  /** Display del nombre en matches de balanza (default: nombre tal cual). */
  scaleName?: (name: string, weightKg: number) => string;
}

/**
 * Pipeline único de lectura (V3 §7):
 * normalize → detect format → validate → scale? → resolve.
 * Puro y sin side-effects (el ScanGuard vive en el emit del provider,
 * en un solo lugar). Ninguna vista implementa su propio pipeline.
 */
export async function processScan(
  rawCode: string,
  source: ScannerSource,
  deps: PipelineDeps = {}
): Promise<{ result: ScanResult; resolution: BarcodeResolution }> {
  const normalized = normalizeCode(rawCode);
  const format = detectFormat(normalized || rawCode);
  const result: ScanResult = {
    rawCode,
    normalizedCode: normalized,
    format,
    source,
    scannedAt: Date.now(),
  };

  if (!normalized) {
    return { result, resolution: { status: 'invalid', barcode: rawCode, normalizedBarcode: '', reason: 'vacío' } };
  }

  // Balanza: no aplica checksum EAN; resuelve por PLU local
  if (format === 'scale') {
    const scale = parseScaleCode(normalized);
    const found = scale && deps.lookupPlu ? deps.lookupPlu(scale.plu) : null;
    if (scale && found) {
      console.log('[Scanner] scale-found', scale.plu, scale.weightKg);
      return {
        result,
        resolution: {
          status: 'found',
          barcode: normalized,
          normalizedBarcode: normalized,
          product: deps.scaleName ? { ...found, name: deps.scaleName(found.name, scale.weightKg) } : found,
          matchedVia: 'scale',
          weightKg: scale.weightKg,
        },
      };
    }
    console.log('[BarcodeResolver] scale-not-found', normalized);
    return { result, resolution: { status: 'not_found', barcode: normalized, normalizedBarcode: normalized } };
  }

  const valid = plausibleCode(normalized);
  if (!valid.ok) {
    const reason = valid.reason === 'dígito'
      ? 'dígito de control no cierra'
      : valid.reason === 'longitud'
        ? 'longitud no válida'
        : 'vacío';
    return { result, resolution: { status: 'invalid', barcode: normalized, normalizedBarcode: normalized, reason } };
  }

  const resolve = deps.resolve ?? resolveBarcode;
  const resolution = await resolve(normalized);
  return { result, resolution };
}
