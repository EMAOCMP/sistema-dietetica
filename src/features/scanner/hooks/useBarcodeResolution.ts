import { useMemo } from 'react';
import { createCatalogResolver, type CatalogEntry } from '../services/catalogResolver';
import type { BarcodeResolutionHandler } from '../types/scanner.types';

export interface CatalogResolverOpts {
  /** Si true, en matches de balanza el nombre incluye "· X kg" (display POS). */
  scaleNameSuffix?: boolean;
}

/**
 * Única resolución código→producto para todas las vistas (POS, Productos, Stock Intake).
 * Delega en createCatalogResolver → processScan (pipeline único V3 §7):
 * local → balanza (PLU) → central (product_barcodes / fallback).
 */
export function useBarcodeResolution<T extends CatalogEntry>(
  products: T[],
  opts: CatalogResolverOpts = {}
): { resolve: BarcodeResolutionHandler } {
  const resolve = useMemo(
    () => createCatalogResolver(products, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, opts.scaleNameSuffix]
  );
  return { resolve };
}
