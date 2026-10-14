import { useContext } from 'react';
import { ScannerContext } from '../scannerContext';
import type { ScannerProviderApi } from '../ScannerProvider';

/** Acceso al Scanner Core. Debe usarse dentro de <ScannerProvider>. */
export function useScanner(): ScannerProviderApi {
  const ctx = useContext(ScannerContext);
  if (!ctx) throw new Error('useScanner debe usarse dentro de <ScannerProvider>');
  return ctx;
}

export type { ScannerProviderApi };
