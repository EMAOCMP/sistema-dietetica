import { describe, expect, it } from 'vitest';
import { ScanGuard } from '../scanGuard';
import type { ScanResult } from '../types/scanner.types';

const r = (code: string, at: number): ScanResult => ({
  rawCode: code,
  normalizedCode: code,
  format: 'ean_13',
  source: 'camera',
  scannedAt: at,
});

describe('scanGuard', () => {
  it('mismo código <800ms → bloqueado', () => {
    const g = new ScanGuard(800);
    expect(g.accept(r('A', 1000))).not.toBeNull();
    expect(g.accept(r('A', 1500))).toBeNull();
  });

  it('mismo código >800ms → aceptado', () => {
    const g = new ScanGuard(800);
    expect(g.accept(r('A', 1000))).not.toBeNull();
    expect(g.accept(r('A', 2000))).not.toBeNull();
  });

  it('otro código → aceptado al instante', () => {
    const g = new ScanGuard(800);
    expect(g.accept(r('A', 1000))).not.toBeNull();
    expect(g.accept(r('B', 1100))).not.toBeNull();
  });

  it('clearLock permite reintento consciente', () => {
    const g = new ScanGuard(800);
    g.accept(r('A', 1000));
    g.clearLock();
    expect(g.accept(r('A', 1100))).not.toBeNull();
  });
});
