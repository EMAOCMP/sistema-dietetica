import { describe, it, expect } from 'vitest';
import { fmtMoney } from '../exportCsv';

describe('fmtMoney', () => {
  it('formatea montos es-AR con 2 decimales', () => {
    expect(fmtMoney(1500)).toBe('1.500,00');
    expect(fmtMoney(1500.5)).toBe('1.500,50');
    expect(fmtMoney(0)).toBe('0,00');
  });

  it('acepta strings numéricos', () => {
    expect(fmtMoney('1234.56')).toBe('1.234,56');
  });

  it('devuelve vacío para null/undefined/no-numéricos', () => {
    expect(fmtMoney(null)).toBe('');
    expect(fmtMoney(undefined)).toBe('');
    expect(fmtMoney('abc')).toBe('');
    expect(fmtMoney(NaN)).toBe('');
  });

  it('redondea a 2 decimales', () => {
    expect(fmtMoney(99.999)).toBe('100,00');
  });
});
