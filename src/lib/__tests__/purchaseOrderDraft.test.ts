import { describe, it, expect } from 'vitest';
import {
  buildUpdatePayload,
  costVariance,
  draftLineTotal,
  draftTotal,
  validateDraftLines,
} from '../purchaseOrderDraft';

interface DraftLineFixture {
  product_id: string;
  product_name: string;
  quantity: number;
  qty_replenish: number;
  qty_suggested: number;
  unit_cost: number | null;
}

const line = (patch: Partial<DraftLineFixture> = {}): DraftLineFixture => ({
  product_id: 'p1',
  product_name: 'Yogur griego',
  quantity: 5,
  qty_replenish: 2,
  qty_suggested: 3,
  unit_cost: 1200,
  ...patch,
});

describe('draftLineTotal', () => {
  it('multiplica cantidad por costo unitario', () => {
    expect(draftLineTotal({ quantity: 5, unit_cost: 1200 })).toBe(6000);
  });

  it('admite fracciones en productos por kg', () => {
    expect(draftLineTotal({ quantity: 2.5, unit_cost: 8500 })).toBe(21250);
  });

  it('trata el costo nulo como cero', () => {
    expect(draftLineTotal({ quantity: 3, unit_cost: null })).toBe(0);
  });

  it('redondea a centavos', () => {
    expect(draftLineTotal({ quantity: 3, unit_cost: 0.333 })).toBe(1);
  });

  it('no rompe con valores no numéricos', () => {
    expect(draftLineTotal({ quantity: Number.NaN, unit_cost: 100 })).toBe(0);
  });
});

describe('draftTotal', () => {
  it('suma los subtotales de todas las líneas', () => {
    expect(
      draftTotal([
        { quantity: 5, unit_cost: 1200 },
        { quantity: 2.5, unit_cost: 8500 },
      ]),
    ).toBe(27250);
  });

  it('devuelve 0 sin líneas', () => {
    expect(draftTotal([])).toBe(0);
  });
});

describe('validateDraftLines', () => {
  it('exige al menos un producto', () => {
    expect(validateDraftLines([])).toMatch(/al menos un producto/i);
  });

  it('acepta una línea válida', () => {
    expect(validateDraftLines([line()])).toBeNull();
  });

  it('rechaza cantidad cero o negativa', () => {
    expect(validateDraftLines([line({ quantity: 0 })])).toMatch(/cantidad inválida/i);
    expect(validateDraftLines([line({ quantity: -2 })])).toMatch(/cantidad inválida/i);
  });

  it('exige cantidad entera para productos por unidad', () => {
    expect(validateDraftLines([line({ quantity: 1.5 })])).toMatch(/debe ser entera/i);
  });

  it('permite fracciones para productos por kg', () => {
    expect(validateDraftLines([line({ quantity: 1.5 })], () => 'kg')).toBeNull();
  });

  it('rechaza costo negativo', () => {
    expect(validateDraftLines([line({ unit_cost: -1 })])).toMatch(/costo inválido/i);
  });

  it('permite costo nulo (producto sin costo cargado)', () => {
    expect(validateDraftLines([line({ unit_cost: null })])).toBeNull();
  });

  it('rechaza productos repetidos', () => {
    expect(validateDraftLines([line(), line()])).toMatch(/repetido/i);
  });
});

describe('buildUpdatePayload', () => {
  it('conserva el costo nulo y los valores de reposición', () => {
    const payload = buildUpdatePayload([
      line({ quantity: 4, unit_cost: 1500.5 }),
      line({ product_id: 'p2', unit_cost: null }),
    ]);
    expect(payload).toEqual([
      {
        product_id: 'p1',
        quantity: 4,
        qty_replenish: 2,
        qty_suggested: 3,
        unit_cost: 1500.5,
      },
      {
        product_id: 'p2',
        quantity: 5,
        qty_replenish: 2,
        qty_suggested: 3,
        unit_cost: null,
      },
    ]);
  });

  it('convierte valores de texto que llegan de un input', () => {
    const payload = buildUpdatePayload([
      {
        ...line(),
        quantity: '4' as unknown as number,
        unit_cost: '1500.5' as unknown as number,
      },
    ]);
    expect(payload[0].quantity).toBe(4);
    expect(payload[0].unit_cost).toBe(1500.5);
  });
});

describe('costVariance', () => {
  it('marca cuánto salió más caro el ingreso real', () => {
    expect(costVariance(5000, 5500)).toBe(500);
  });

  it('devuelve negativo cuando salió más barato', () => {
    expect(costVariance(5000, 4800)).toBe(-200);
  });

  it('devuelve 0 cuando coinciden', () => {
    expect(costVariance(5000, 5000)).toBe(0);
  });

  it('no hay comparación sin total real', () => {
    expect(costVariance(5000, null)).toBeNull();
    expect(costVariance(5000, undefined)).toBeNull();
  });

  it('redondea a centavos', () => {
    expect(costVariance(1000, 1000.335)).toBe(0.34);
  });

  it('ignora valores no numéricos del real', () => {
    expect(costVariance(1000, Number.NaN)).toBeNull();
  });
});
