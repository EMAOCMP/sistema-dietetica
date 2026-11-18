import { describe, it, expect } from 'vitest';
import { defaultMode, netSuggested, targetReplenish, type SuggestionRow } from '../replenishment';

const row = (patch: Partial<SuggestionRow> = {}): SuggestionRow => ({
  stock: 3,
  min_stock: 5,
  suggested: 0,
  replenish: 2,
  has_history: false,
  ...patch,
});

describe('targetReplenish', () => {
  it('sin historial repone el faltante contra el objetivo', () => {
    expect(targetReplenish(row())).toBe(2);
  });

  it('con historial usa la demanda si es mayor', () => {
    expect(targetReplenish(row({ has_history: true, suggested: 7 }))).toBe(7);
  });

  it('nunca sugiere menos que el faltante contra el objetivo', () => {
    expect(targetReplenish(row({ has_history: true, suggested: 0.5 }))).toBe(2);
  });

  it('no sugiere cantidades negativas', () => {
    expect(targetReplenish(row({ replenish: 0, suggested: 0 }))).toBe(0);
  });

  it('redondea a dos decimales', () => {
    expect(targetReplenish(row({ has_history: true, suggested: 1.239 }))).toBe(2);
    expect(targetReplenish(row({ has_history: true, suggested: 2.239 }))).toBe(2.24);
  });
});

describe('netSuggested', () => {
  it('descuenta lo que ya está pedido', () => {
    expect(netSuggested(row(), 1)).toBe(1);
  });

  it('nunca queda negativo', () => {
    expect(netSuggested(row(), 10)).toBe(0);
  });

  it('descuenta pendientes sobre la demanda', () => {
    expect(netSuggested(row({ has_history: true, suggested: 7 }), 2)).toBe(5);
  });
});

describe('defaultMode', () => {
  it('sin historial arranca en Faltan', () => {
    expect(defaultMode(row())).toBe('replenish');
  });

  it('con demanda mayor al faltante arranca en Sugerido', () => {
    expect(defaultMode(row({ has_history: true, suggested: 7 }))).toBe('suggested');
  });

  it('con demanda menor al faltante arranca en Faltan', () => {
    expect(defaultMode(row({ has_history: true, suggested: 0.5 }))).toBe('replenish');
  });
});