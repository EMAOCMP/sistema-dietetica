import { describe, expect, it } from 'vitest';
import { processScan } from '../scanPipeline';
import type { BarcodeResolution } from '../types/scanner.types';

const notFound = (normalized: string): BarcodeResolution => ({
  status: 'not_found', barcode: normalized, normalizedBarcode: normalized,
});

describe('scanPipeline', () => {
  it('vacío → invalid', async () => {
    const { resolution } = await processScan('   ', 'manual', { resolve: async (n) => notFound(n) });
    expect(resolution.status).toBe('invalid');
  });

  it('balanza con PLU local → found scale + weightKg', async () => {
    const { result, resolution } = await processScan('2000123012505', 'camera', {
      lookupPlu: (plu) => plu === '00123'
        ? { id: 'p1', name: 'Nueces' }
        : null,
      resolve: async (n) => notFound(n),
    });
    expect(result.format).toBe('scale');
    expect(resolution.status).toBe('found');
    if (resolution.status === 'found') {
      expect(resolution.matchedVia).toBe('scale');
      expect(resolution.weightKg).toBeCloseTo(1.25, 3);
      expect(resolution.product.name).toBe('Nueces');
    }
  });

  it('balanza sin PLU → not_found', async () => {
    const { resolution } = await processScan('2000999012505', 'camera', {
      lookupPlu: () => null,
      resolve: async (n) => notFound(n),
    });
    expect(resolution.status).toBe('not_found');
  });

  it('EAN delega al resolver inyectado', async () => {
    const { result, resolution } = await processScan('5901234123457', 'hardware', {
      resolve: async (normalized) => ({
        status: 'found', barcode: normalized, normalizedBarcode: normalized,
        product: { id: 'x', name: 'Yerba' }, matchedVia: 'primary',
      }),
    });
    expect(result.source).toBe('hardware');
    expect(result.normalizedCode).toBe('5901234123457');
    expect(resolution.status).toBe('found');
  });
});
