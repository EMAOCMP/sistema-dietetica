import { createContext } from 'react';
import type { ScannerProviderApi } from './ScannerProvider';

/** Contexto del scanner. Vive en archivo propio (sin componentes) para Fast Refresh. */
export const ScannerContext = createContext<ScannerProviderApi | null>(null);
