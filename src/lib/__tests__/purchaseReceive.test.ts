import { describe, it, expect } from 'vitest';
import {
  hasShortage,
  lineShortage,
  lineShortageCost,
  shortageSummary,
  type ReceivedLine,
} from '../purchaseReceive';

const line = (patch: Partial<ReceivedLine> = {}): ReceivedLine => ({
  product_id: 'p1',
  product_name: 'Yogur griego',
  quantity: 5,
  unit_cost: 1100,
  received_quantity: 5,
  ...patch,
});

describe('lineShortage', () => {
  it('calcula lo que faltó', () => {
    expect(lineShortage(line({ received_quantity: 3 }))).toBe(2);
  });

  it('es 0 cuando llegó todo', () => {
    expect(lineShortage(line())).toBe(0);
  });

  it('no es negativo si llegó de más', () => {
    expect(lineShortage(line({ received_quantity: 7 }))).toBe(0);
  });

  it('admite fracciones en productos por kg', () => {
    expect(lineShortage(line({ quantity: 2.5, received_quantity: 2 }))).toBe(0.5);
  });

  it('no inventa faltante sin dato de recibido', () => {
    expect(lineShortage(line({ received_quantity: null }))).toBe(0);
    expect(lineShortage(line({ received_quantity: undefined }))).toBe(0);
  });

  it('no rompe con cantidad inválida', () => {
    expect(lineShortage(line({ quantity: Number.NaN }))).toBe(0);
    expect(lineShortage(line({ quantity: 0 }))).toBe(0);
  });
});

describe('lineShortageCost', () => {
  it('multiplica el faltante por el costo unitario', () => {
    expect(lineShortageCost(line({ received_quantity: 3 }))).toBe(2200);
  });

  it('es 0 si no faltó nada', () => {
    expect(lineShortageCost(line())).toBe(0);
  });

  it('es 0 si la línea no tiene costo', () => {
    expect(lineShortageCost(line({ received_quantity: 3, unit_cost: null }))).toBe(0);
  });

  it('redondea a centavos', () => {
    expect(lineShortageCost(line({ received_quantity: 0, unit_cost: 0.335 }))).toBe(1.68);
  });
});

describe('shortageSummary', () => {
  it('suma unidades, costo y líneas', () => {
    const summary = shortageSummary([
      line({ received_quantity: 3 }),
      line({ product_id: 'p2', quantity: 2, received_quantity: 0, unit_cost: 850 }),
      line({ product_id: 'p3' }),
    ]);
    expect(summary).toEqual({ quantity: 4, cost: 3900, lines: 2 });
  });

  it('devuelve todo en 0 sin líneas', () => {
    expect(shortageSummary()).toEqual({ quantity: 0, cost: 0, lines: 0 });
    expect(shortageSummary([])).toEqual({ quantity: 0, cost: 0, lines: 0 });
  });

  it('devuelve 0 cuando la entrega fue completa', () => {
    expect(shortageSummary([line(), line({ product_id: 'p2' })])).toEqual({
      quantity: 0,
      cost: 0,
      lines: 0,
    });
  });
});

describe('hasShortage', () => {
  it('detecta faltante', () => {
    expect(hasShortage([line({ received_quantity: 4 })])).toBe(true);
  });

  it('no marca faltante en entregas completas', () => {
    expect(hasShortage([line()])).toBe(false);
    expect(hasShortage()).toBe(false);
  });
});
