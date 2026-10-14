import { describe, it, expect } from 'vitest';
import {
  isoWeekInfo,
  aggregatePeriods,
  totalsOf,
  marginPct,
  deltaPct,
  sellerBreakdown,
  selectionRange,
  previousSelectionRange,
} from '../reportAggregation';

describe('isoWeekInfo', () => {
  it('1 de enero 2026 (jueves) pertenece a la semana 1 de 2026', () => {
    const info = isoWeekInfo(new Date(2026, 0, 1));
    expect(info.year).toBe(2026);
    expect(info.week).toBe(1);
    expect(info.monday.getDay()).toBe(1); // lunes
    expect(info.sunday.getDay()).toBe(0); // domingo
  });
  it('31 de diciembre 2025 (miércoles) pertenece a la semana 1 de 2026', () => {
    const info = isoWeekInfo(new Date(2025, 11, 31));
    expect(info.year).toBe(2026);
    expect(info.week).toBe(1);
  });
  it('domingo 11/10/2026 cae en la semana que empezó lunes 5/10', () => {
    const info = isoWeekInfo(new Date(2026, 9, 11));
    expect(info.monday).toEqual(new Date(2026, 9, 5));
    expect(info.week).toBeGreaterThan(0);
    expect(info.week).toBeLessThanOrEqual(53);
  });
});

describe('aggregatePeriods (day)', () => {
  const sales = [
    { id: 'a', created_at: '2026-10-12T10:00:00-03:00', total_amount: 1000, profit_amount: 300, user_id: 'u1' },
    { id: 'b', created_at: '2026-10-12T18:00:00-03:00', total_amount: 500, profit_amount: 150, user_id: 'u2' },
    { id: 'c', created_at: '2026-10-13T09:00:00-03:00', total_amount: 200, profit_amount: 50, user_id: 'u1' },
  ];
  const expenses = [{ spent_on: '2026-10-12', amount: 200 }];

  it('agrupa por día con template del mes completo', () => {
    const rows = aggregatePeriods(sales, expenses, 'day', { year: 2026, month: 9 });
    expect(rows.length).toBe(31); // octubre
    const d12 = rows.find((r) => r.key === '2026-10-12')!;
    expect(d12.tickets).toBe(2);
    expect(d12.revenue).toBe(1500);
    expect(d12.grossProfit).toBe(450);
    expect(d12.expenses).toBe(200);
    expect(d12.netProfit).toBe(250);
    const d13 = rows.find((r) => r.key === '2026-10-13')!;
    expect(d13.tickets).toBe(1);
    expect(d13.expenses).toBe(0);
    const d20 = rows.find((r) => r.key === '2026-10-20')!;
    expect(d20.tickets).toBe(0);
    expect(d20.revenue).toBe(0);
  });

  it('totalsOf suma todo', () => {
    const rows = aggregatePeriods(sales, expenses, 'day', { year: 2026, month: 9 });
    const t = totalsOf(rows);
    expect(t.tickets).toBe(3);
    expect(t.revenue).toBe(1700);
    expect(t.grossProfit).toBe(500);
    expect(t.expenses).toBe(200);
    expect(t.netProfit).toBe(300);
  });
});

describe('aggregatePeriods (week / month)', () => {
  const sales = [
    { id: 'a', created_at: '2026-01-05T10:00:00', total_amount: 100, profit_amount: 40 }, // semana 2
    { id: 'b', created_at: '2026-03-10T10:00:00', total_amount: 300, profit_amount: 90 },  // marzo
  ];
  it('semanas ISO del año', () => {
    const rows = aggregatePeriods(sales, [], 'week', { year: 2026 });
    const withSales = rows.filter((r) => r.tickets > 0);
    expect(withSales.length).toBe(2); // 5/1 → W02 · 10/3 → W11
    expect(withSales.find((r) => r.key === '2026-W02')?.revenue).toBe(100);
    expect(withSales.find((r) => r.key === '2026-W11')?.revenue).toBe(300);
    expect(rows.length).toBeGreaterThanOrEqual(52);
    expect(rows.length).toBeLessThanOrEqual(53);
  });
  it('meses del año', () => {
    const rows = aggregatePeriods(sales, [], 'month', { year: 2026 });
    expect(rows.length).toBe(12);
    expect(rows[2].label).toBe('Marzo');
    expect(rows[2].revenue).toBe(300);
  });
});

describe('deltaPct / marginPct', () => {
  it('deltaPct con base', () => {
    expect(deltaPct(150, 100)).toBeCloseTo(50);
    expect(deltaPct(50, 100)).toBeCloseTo(-50);
  });
  it('deltaPct sin base devuelve null', () => {
    expect(deltaPct(100, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBeNull();
  });
  it('marginPct', () => {
    expect(marginPct(200, 50)).toBeCloseTo(25);
    expect(marginPct(0, 50)).toBe(0);
  });
});

describe('sellerBreakdown', () => {
  it('agrupa por vendedor ordenado por ganancia', () => {
    const rows = sellerBreakdown(
      [
        { id: 'a', created_at: 'x', total_amount: 100, profit_amount: 30, user_id: 'u1' },
        { id: 'b', created_at: 'x', total_amount: 200, profit_amount: 80, user_id: 'u2' },
        { id: 'c', created_at: 'x', total_amount: 50, profit_amount: 10, user_id: 'u1' },
        { id: 'd', created_at: 'x', total_amount: 10, profit_amount: 2, user_id: null },
      ],
      { u1: 'Ana', u2: 'Ben' }
    );
    expect(rows[0].name).toBe('Ben');
    expect(rows[0].profit).toBe(80);
    expect(rows[1].tickets).toBe(2);
    expect(rows[1].name).toBe('Ana');
    expect(rows[rows.length - 1].name).toBe('Sin vendedor');
  });
});

describe('selectionRange / previousSelectionRange', () => {
  it('día: mes seleccionado y mes anterior', () => {
    const cur = selectionRange('day', 2026, 9);
    expect(cur.start).toEqual(new Date(2026, 9, 1));
    expect(cur.end).toEqual(new Date(2026, 10, 1));
    const prev = previousSelectionRange('day', 2026, 9);
    expect(prev.start).toEqual(new Date(2026, 8, 1));
    expect(prev.end).toEqual(new Date(2026, 9, 1));
  });
  it('mes: año completo y año anterior', () => {
    const cur = selectionRange('month', 2026);
    expect(cur.start).toEqual(new Date(2026, 0, 1));
    expect(cur.end).toEqual(new Date(2027, 0, 1));
    const prev = previousSelectionRange('month', 2026);
    expect(prev.start).toEqual(new Date(2025, 0, 1));
    expect(prev.end).toEqual(new Date(2026, 0, 1));
  });
  it('semana: arranca en el lunes de la semana ISO 1', () => {
    const cur = selectionRange('week', 2026);
    expect(cur.start.getDay()).toBe(1);
    expect(cur.start.getFullYear()).toBe(2025); // lunes 30/12/2025 (semana 1 de 2026)
    expect(cur.end > cur.start).toBe(true);
  });
});
