export type GroupMode = 'day' | 'week' | 'month';

export interface ReportSale {
  id: string;
  created_at: string;
  total_amount: number | string;
  profit_amount?: number | string | null;
  user_id?: string | null;
}

export interface ReportExpense {
  spent_on: string; // YYYY-MM-DD
  amount: number | string;
  description?: string;
  category?: string;
}

export interface PeriodRow {
  key: string;
  label: string;
  sublabel: string;
  tickets: number;
  revenue: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

export interface PeriodTotals {
  tickets: number;
  revenue: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

const num = (v: number | string | null | undefined) => Number(v || 0);

const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export const fmtDayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fmtMonthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Semana ISO: lunes..domingo. Devuelve año ISO, nº de semana y el rango. */
export function isoWeekInfo(d: Date): { year: number; week: number; monday: Date; sunday: Date } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (date.getDay() + 6) % 7; // lun=0 .. dom=6
  const monday = new Date(date);
  monday.setDate(date.getDate() - dayNum);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const isoYear = thursday.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const fDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fDayNum + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000));

  return { year: isoYear, week, monday, sunday };
}

const keyOfDate = (d: Date, mode: GroupMode): string => {
  if (mode === 'day') return fmtDayKey(d);
  if (mode === 'month') return fmtMonthKey(d);
  const { year, week } = isoWeekInfo(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

const templateFor = (mode: GroupMode, year: number, month?: number): { key: string; label: string; sublabel: string }[] => {
  if (mode === 'day') {
    const m = month ?? new Date().getMonth();
    const days = new Date(year, m + 1, 0).getDate();
    const out = [];
    for (let d = 1; d <= days; d++) {
      const date = new Date(year, m, d);
      out.push({ key: fmtDayKey(date), label: `${d}/${m + 1}`, sublabel: DAY_NAMES[date.getDay()] });
    }
    return out;
  }
  if (mode === 'month') {
    return MONTH_NAMES.map((label, i) => ({ key: fmtMonthKey(new Date(year, i, 1)), label, sublabel: '' }));
  }
  // week: todas las semanas ISO que tocan el año (el 28/12 siempre cae en la última)
  const out = [];
  let cursor = new Date(year, 0, 1);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // lunes de esa semana
  const lastMonday = new Date(year, 11, 28);
  for (let guard = 0; guard < 54 && cursor <= lastMonday; guard++) {
    const info = isoWeekInfo(cursor);
    out.push({
      key: `${info.year}-W${String(info.week).padStart(2, '0')}`,
      label: `Sem ${info.week}`,
      sublabel: `${ddmm(info.monday)}–${ddmm(info.sunday)}`,
    });
    cursor = new Date(info.sunday);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

/**
 * Agrupa ventas y gastos por día / semana ISO / mes.
 * Con year (+ month en modo day) devuelve TODAS las filas del período
 * (inclusive las vacías); sin template solo filas con datos.
 */
export function aggregatePeriods(
  sales: ReportSale[],
  expenses: ReportExpense[],
  mode: GroupMode,
  template?: { year: number; month?: number }
): PeriodRow[] {
  const acc = new Map<string, PeriodRow>();
  const ensure = (key: string, label: string, sublabel: string): PeriodRow => {
    let row = acc.get(key);
    if (!row) {
      row = { key, label, sublabel, tickets: 0, revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 };
      acc.set(key, row);
    }
    return row;
  };

  if (template) {
    for (const t of templateFor(mode, template.year, template.month)) ensure(t.key, t.label, t.sublabel);
  }

  for (const s of sales) {
    const d = new Date(s.created_at);
    const key = keyOfDate(d, mode);
    let label = key;
    let sublabel = '';
    if (mode === 'day') { label = `${d.getDate()}/${d.getMonth() + 1}`; sublabel = DAY_NAMES[d.getDay()]; }
    else if (mode === 'month') { label = MONTH_NAMES[d.getMonth()]; }
    else {
      const info = isoWeekInfo(d);
      label = `Sem ${info.week}`;
      sublabel = `${ddmm(info.monday)}–${ddmm(info.sunday)}`;
    }
    const row = ensure(key, label, sublabel);
    row.tickets += 1;
    row.revenue += num(s.total_amount);
    row.grossProfit += num(s.profit_amount);
  }

  for (const e of expenses) {
    const d = new Date(e.spent_on + 'T12:00:00');
    const key = keyOfDate(d, mode);
    let label = key;
    let sublabel = '';
    if (mode === 'day') { label = `${d.getDate()}/${d.getMonth() + 1}`; sublabel = DAY_NAMES[d.getDay()]; }
    else if (mode === 'month') { label = MONTH_NAMES[d.getMonth()]; }
    else {
      const info = isoWeekInfo(d);
      label = `Sem ${info.week}`;
      sublabel = `${ddmm(info.monday)}–${ddmm(info.sunday)}`;
    }
    ensure(key, label, sublabel).expenses += num(e.amount);
  }

  const rows = [...acc.values()].map((r) => ({ ...r, netProfit: r.grossProfit - r.expenses }));
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

export function totalsOf(rows: PeriodRow[]): PeriodTotals {
  return rows.reduce(
    (acc, r) => ({
      tickets: acc.tickets + r.tickets,
      revenue: acc.revenue + r.revenue,
      grossProfit: acc.grossProfit + r.grossProfit,
      expenses: acc.expenses + r.expenses,
      netProfit: acc.netProfit + r.netProfit,
    }),
    { tickets: 0, revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 }
  );
}

/** Margen neto % sobre facturación (0 si no hay facturación). */
export const marginPct = (revenue: number, profit: number) =>
  revenue > 0 ? (profit / revenue) * 100 : 0;

/** Δ% entre período actual y anterior. null si el anterior es 0 (sin base). */
export const deltaPct = (current: number, previous: number): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

export interface SellerRow {
  userId: string | null;
  name: string;
  tickets: number;
  revenue: number;
  profit: number;
}

export function sellerBreakdown(sales: ReportSale[], nameById: Record<string, string>): SellerRow[] {
  const map = new Map<string, SellerRow>();
  for (const s of sales) {
    const id = s.user_id || '__none__';
    let row = map.get(id);
    if (!row) {
      row = {
        userId: s.user_id || null,
        name: s.user_id ? (nameById[s.user_id] || 'Sin nombre') : 'Sin vendedor',
        tickets: 0,
        revenue: 0,
        profit: 0,
      };
      map.set(id, row);
    }
    row.tickets += 1;
    row.revenue += num(s.total_amount);
    row.profit += num(s.profit_amount);
  }
  return [...map.values()].sort((a, b) => b.profit - a.profit);
}

/** Rango [inicio inclusive, fin exclusive) en horario local del período seleccionado. */
export function selectionRange(mode: GroupMode, year: number, month?: number): { start: Date; end: Date } {
  if (mode === 'day') {
    const m = month ?? new Date().getMonth();
    return { start: new Date(year, m, 1), end: new Date(year, m + 1, 1) };
  }
  if (mode === 'month') {
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
  // week: de la semana ISO 1 del año a la semana ISO 1 del año siguiente
  const w1 = isoWeekInfo(new Date(year, 0, 4)); // el 4 de enero cae siempre en la semana 1
  const w1next = isoWeekInfo(new Date(year + 1, 0, 4));
  return { start: w1.monday, end: w1next.monday };
}

/** Período inmediatamente anterior de igual duración (para el Δ%). */
export function previousSelectionRange(mode: GroupMode, year: number, month?: number): { start: Date; end: Date } {
  if (mode === 'day') {
    const m = month ?? new Date().getMonth();
    const prev = new Date(year, m - 1, 1);
    return { start: prev, end: new Date(year, m, 1) };
  }
  return selectionRange(mode, year - 1, month);
}
