import { useMemo } from 'react';
import { ScanGuard } from '../services/scanGuard';

export { ScanGuard };
export { DEFAULT_WINDOW_MS } from '../services/scanGuard';

/** Hook: instancia estable del ScanGuard para el ScannerProvider. */
export function useScanGuard(windowMs?: number): ScanGuard {
  return useMemo(() => new ScanGuard(windowMs), [windowMs]);
}