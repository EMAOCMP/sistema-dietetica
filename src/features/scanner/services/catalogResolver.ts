import { matchLocalProduct } from '../../../lib/productLookup';
import { normalizeCode } from './barcodeNormalizer';
import { resolveBarcode } from './barcodeResolver';
import { processScan } from './scanPipeline';
import { parseScaleCode } from './scaleParser';
import type {
  BarcodeResolution,
  BarcodeResolutionHandler,
  ProductLite,
} from '../types/scanner.types';

export interface CatalogEntry {
  id: string;
  name: string;
  barcode?: string | null;
  stock_quantity?: number | null;
  retail_price?: number | null;
  wholesale_price?: number | null;
  cost_price?: number | null;
  category?: string | null;
  unit_type?: string | null;
}

function toLite(p: CatalogEntry): ProductLite {
  return {
    id: p.id,
    name: p.name,
    stock_quantity: p.stock_quantity == null ? undefined : Number(p.stock_quantity),
    retail_price: p.retail_price == null ? undefined : Number(p.retail_price),
    wholesale_price: p.wholesale_price == null ? undefined : Number(p.wholesale_price),
    cost_price: p.cost_price == null ? undefined : Number(p.cost_price),
    category: p.category ?? null,
    unit_type: p.unit_type ?? undefined,
  };
}

/**
 * Balanza → producto del catálogo por PLU (misma implementación para todos).
 * Devuelve la entrada original (referencia) + peso para que el caso de uso
 * decida (POS suma directo, sin ScaleModal).
 */
export function resolveScaleProduct<T extends CatalogEntry>(
  code: string,
  products: T[]
): { product: T; weightKg: number } | null {
  const scale = parseScaleCode(normalizeCode(code));
  if (!scale) return null;
  const byPlu = products.find((p) => p.barcode === scale.plu)
    || (matchLocalProduct(products as any[], scale.plu) as T | undefined);
  if (!byPlu) return null;
  return { product: byPlu, weightKg: scale.weightKg };
}

/**
 * Resolver único compartido (V3 Fase 2): caché local → balanza → central.
 * Reemplaza las 3 copias inline de POS/Productos/Ingreso.
 */
export function createCatalogResolver<T extends CatalogEntry>(
  products: T[],
  opts: { online?: boolean; scaleNameSuffix?: boolean } = {}
): BarcodeResolutionHandler {
  const lookupPlu = (plu: string): ProductLite | null => {
    const hit = products.find((p) => p.barcode === plu)
      || (matchLocalProduct(products as any[], plu) as T | undefined);
    return hit ? toLite(hit) : null;
  };

  return async (code: string): Promise<BarcodeResolution> => {
    const { resolution } = await processScan(code, 'manual', {
      lookupPlu,
      scaleName: opts.scaleNameSuffix
        ? (name, weightKg) => `${name} · ${weightKg.toFixed(3)} kg`
        : undefined,
      resolve: async (normalized: string): Promise<BarcodeResolution> => {
        const local = matchLocalProduct(products as any[], normalized)
          || products.find((p) => p.barcode === normalized);
        if (local) {
          console.log('[BarcodeResolver] local-found', normalized);
          return {
            status: 'found',
            barcode: normalized,
            normalizedBarcode: normalized,
            product: toLite(local as CatalogEntry),
            matchedVia: 'primary',
          };
        }
        if (opts.online === false) {
          return { status: 'not_found', barcode: normalized, normalizedBarcode: normalized };
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          return { status: 'not_found', barcode: normalized, normalizedBarcode: normalized };
        }
        return resolveBarcode(normalized);
      },
    });
    return resolution;
  };
}
