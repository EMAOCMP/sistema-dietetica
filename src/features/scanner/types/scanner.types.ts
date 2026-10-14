export type BarcodeFormat =
  | 'ean_13'
  | 'ean_8'
  | 'upc_a'
  | 'upc_e'
  | 'code_128'
  | 'code_39'
  | 'qr'
  | 'scale'
  | 'unknown';

/** Scanner ≠ producto/stock/venta: el core solo emite esto. */
export interface ScanResult {
  rawCode: string;
  normalizedCode: string;
  format: BarcodeFormat;
  source: 'camera' | 'hardware' | 'image' | 'manual';
  scannedAt: number;
}

export type ScannerSource = ScanResult['source'];

/** Error tipado, independiente de la máquina de estados. */
export type ScannerError =
  | 'permission_denied'
  | 'camera_unavailable'
  | 'camera_in_use'
  | 'insecure_context'
  | 'decoder_error'
  | 'network_error';

/**
 * Máquina de estados del scanner global.
 * idle → requesting_permission → starting → scanning → detected → resolving
 * resolving → found | not_found | invalid
 */
export type ScannerStatus =
  | 'idle'
  | 'requesting_permission'
  | 'starting'
  | 'scanning'
  | 'detected'
  | 'resolving'
  | 'found'
  | 'not_found'
  | 'invalid'
  | 'error';

/** Estado global expuesto por ScannerProvider. */
export interface ScannerState {
  status: ScannerStatus;
  error: ScannerError | null;
  lastResult: ScanResult | null;
  activeSource: ScannerSource | null;
  cameraId: string;
  cameras: { id: string; label: string }[];
  torchSupported: boolean;
  torchOn: boolean;
}

/** Resolución del código: el padre decide, el scanner no. */
export interface ProductLite {
  id: string;
  name: string;
  stock_quantity?: number;
  retail_price?: number;
  wholesale_price?: number;
  cost_price?: number;
  category?: string | null;
  unit_type?: string;
  barcode?: string;
}

export type BarcodeResolution =
  | {
      status: 'found';
      barcode: string;
      normalizedBarcode: string;
      product: ProductLite;
      matchedVia: 'primary' | 'alias' | 'scale';
      /** Solo en matches de balanza: peso ya incluido en el código. */
      weightKg?: number;
    }
  | {
      status: 'not_found';
      barcode: string;
      normalizedBarcode: string;
    }
  | {
      status: 'invalid';
      barcode: string;
      normalizedBarcode: string;
      reason: string;
    };

export type BarcodeResolutionHandler = (code: string) => Promise<BarcodeResolution>;