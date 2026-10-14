import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';
import { Shield, Download, Loader2, Plus, Trash2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { SelectMenu } from './SelectMenu';
import {
  aggregatePeriods,
  totalsOf,
  marginPct,
  deltaPct,
  sellerBreakdown,
  selectionRange,
  previousSelectionRange,
  type GroupMode,
  type PeriodRow,
  type ReportSale,
  type ReportExpense,
} from '../lib/reportAggregation';
import { downloadCsv, stampName } from '../lib/exportCsv';
import { downloadReportsPdf } from '../lib/reportPdf';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const money0 = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const EXPENSE_CATS = ['alquiler', 'servicios', 'insumos', 'sueldos', 'publicidad', 'otro'];

function DeltaBadge({ delta, suffix = '%' }: { delta: number | null; suffix?: string }) {
  if (delta === null) {
    return <p className="text-[10px] text-slate-400 font-bold mt-0.5">sin dato anterior</p>;
  }
  const up = delta >= 0;
  return (
    <p className={`text-[10px] font-bold mt-0.5 ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}{suffix === ' pp' ? ' p.p.' : '%'} vs. anterior
    </p>
  );
}

function Kpi({ label, value, delta, suffix }: { label: string; value: string; delta: number | null; suffix?: string }) {
  return (
    <div className="bg-white dark:bg-[#1F1F1F] rounded-2xl border border-slate-200 dark:border-[#333333] p-3.5">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-extrabold text-slate-900 dark:text-white tnum mt-0.5">{value}</p>
      <DeltaBadge delta={delta} suffix={suffix} />
    </div>
  );
}

/**
 * Reportes de ganancias: diario (por mes), semanal (por año ISO) y
 * mensual (por año), con Δ vs. período anterior, ganancia por vendedor,
 * gastos → ganancia neta, y exportación CSV/PDF.
 * Acceso: admin y supervisor.
 */
export function ReportsView({ profile, showToast }: {
  profile: Profile | null;
  showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) showToast(msg, kind);
  };

  const now = new Date();
  const [mode, setMode] = useState<GroupMode>('day');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [salesAll, setSalesAll] = useState<ReportSale[]>([]);
  const [expenses, setExpenses] = useState<ReportExpense[]>([]);
  const [expensesAvailable, setExpensesAvailable] = useState(true);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  const [expDate, setExpDate] = useState(localDay(now));
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCat, setExpCat] = useState('otro');
  const [savingExp, setSavingExp] = useState(false);

  const canManage = ['admin', 'supervisor', 'vendedor'].includes(profile?.role || '');
  const isAdmin = ['admin', 'supervisor', 'vendedor'].includes(profile?.role || '');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cur = selectionRange(mode, year, month);
      const prev = previousSelectionRange(mode, year, month);
      const startIso = new Date(Math.min(prev.start.getTime(), cur.start.getTime())).toISOString();
      const endIso = cur.end.toISOString();

      // Ventas paginadas (PostgREST limita a ~1000 filas por request)
      const rows: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error: err } = await supabase
          .from('sales')
          .select('id, created_at, total_amount, profit_amount, user_id, status')
          .gte('created_at', startIso)
          .lt('created_at', endIso)
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1);
        if (err) throw err;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      setSalesAll(rows.filter((s: any) => s.status !== 'cancelled'));

      // Gastos (tabla nueva; puede no existir todavía → degradar en gris)
      try {
        const startDay = localDay(new Date(Math.min(prev.start.getTime(), cur.start.getTime())));
        const endDay = localDay(new Date(cur.end.getTime() - 86400000));
        const { data: exp, error: expErr } = await supabase
          .from('expenses')
          .select('spent_on, amount, description, category')
          .gte('spent_on', startDay)
          .lte('spent_on', endDay)
          .order('spent_on', { ascending: true });
        if (expErr) throw expErr;
        setExpenses((exp || []) as ReportExpense[]);
        setExpensesAvailable(true);
      } catch {
        setExpenses([]);
        setExpensesAvailable(false);
      }

      const { data: prof } = await supabase.from('profiles').select('id, full_name');
      const names: Record<string, string> = {};
      (prof || []).forEach((p: any) => { names[p.id] = p.full_name || 'Usuario'; });
      setProfileNames(names);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, year, month]);

  useEffect(() => { load(); }, [load]);

  // ---- Derivados (período actual vs. anterior) ----
  const curRange = selectionRange(mode, year, month);
  const curStartT = curRange.start.getTime();
  const curStartDay = localDay(curRange.start);
  const curEndExclusiveDay = localDay(curRange.end);

  const curSales = salesAll.filter((s) => new Date(s.created_at).getTime() >= curStartT);
  const prevSales = salesAll.filter((s) => new Date(s.created_at).getTime() < curStartT);
  const curExp = expenses.filter((e) => e.spent_on >= curStartDay && e.spent_on < curEndExclusiveDay);
  const prevExp = expenses.filter((e) => e.spent_on < curStartDay);

  const rows: PeriodRow[] = aggregatePeriods(curSales, curExp, mode, { year, month: mode === 'day' ? month : undefined });
  const totals = totalsOf(rows);
  const prevTotals = totalsOf(aggregatePeriods(prevSales, prevExp, mode));
  const displayRows = rows.filter((r) => r.tickets > 0 || r.expenses > 0);
  const sellers = sellerBreakdown(curSales, profileNames);

  const periodoTexto = mode === 'day'
    ? `${MESES[month]} ${year}`
    : mode === 'week'
      ? `Semanas de ${year}`
      : `Año ${year}`;

  const costOf = (r: { revenue: number; grossProfit: number }) => r.revenue - r.grossProfit;

  // ---- Acciones ----
  const handleAddExpense = async () => {
    const amount = parseFloat(expAmount.replace(',', '.'));
    if (!expDesc.trim() || !(amount > 0)) {
      notify('Descripción y monto mayor a cero son obligatorios.', 'warning');
      return;
    }
    setSavingExp(true);
    try {
      const { error: insErr } = await supabase.from('expenses').insert({
        spent_on: expDate,
        description: expDesc.trim(),
        amount,
        category: expCat,
        payment_method: 'cash',
        user_id: profile?.id || null,
      });
      if (insErr) throw insErr;
      notify('Gasto registrado.', 'success');
      setExpDesc('');
      setExpAmount('');
      load();
    } catch (e: any) {
      notify(`Error guardando gasto: ${e?.message || e}`, 'error');
    } finally {
      setSavingExp(false);
    }
  };

  const handleDeleteExpense = async (spentOn: string, description: string, amount: number) => {
    if (!confirm(`¿Eliminar el gasto "${description}" (${money0(amount)})?`)) return;
    const { error: delErr } = await supabase
      .from('expenses')
      .delete()
      .eq('spent_on', spentOn)
      .eq('description', description)
      .eq('amount', amount)
      .limit(1);    if (delErr) {
      notify(`Error: ${delErr.message}`, 'error');
      return;
    }
    notify('Gasto eliminado.', 'info');
    load();
  };

  const handleExportCsv = () => {
    const headers = ['Período', 'Tickets', 'Facturación', 'Costo', 'Ganancia bruta', 'Gastos', 'Ganancia neta', 'Margen neto %'];
    const body: (string | number)[][] = displayRows.map((r) => [
      r.sublabel ? `${r.label} (${r.sublabel})` : r.label,
      r.tickets,
      Math.round(r.revenue),
      Math.round(costOf(r)),
      Math.round(r.grossProfit),
      Math.round(r.expenses),
      Math.round(r.netProfit),
      marginPct(r.revenue, r.netProfit).toFixed(1),
    ]);
    body.push([
      'TOTAL', totals.tickets, Math.round(totals.revenue), Math.round(costOf(totals)),
      Math.round(totals.grossProfit), Math.round(totals.expenses), Math.round(totals.netProfit),
      marginPct(totals.revenue, totals.netProfit).toFixed(1),
    ]);
    downloadCsv(stampName(`reporte-${mode}`), headers, body);
    notify('CSV descargado.', 'success');
  };

  const handleExportPdf = () => {
    downloadReportsPdf({
      periodo: periodoTexto,
      rows: displayRows.map((r) => ({
        label: r.label,
        sublabel: r.sublabel,
        tickets: r.tickets,
        revenue: r.revenue,
        cost: costOf(r),
        grossProfit: r.grossProfit,
        expenses: r.expenses,
        netProfit: r.netProfit,
        marginPct: marginPct(r.revenue, r.netProfit),
      })),
      totals,
      sellers: sellers.map((s) => ({ name: s.name, tickets: s.tickets, revenue: s.revenue, profit: s.profit })),
    });
    notify('PDF descargado.', 'success');
  };

  const yearOptions = [];
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y--) yearOptions.push(y);

  // Navegación rápida al período anterior/siguiente (sin pasar del mes/año actual)
  const isAtCurrentPeriod = mode === 'day'
    ? year === now.getFullYear() && month === now.getMonth()
    : year === now.getFullYear();

  const goPeriod = (dir: -1 | 1) => {
    if (mode === 'day') {
      const target = new Date(year, month + dir, 1);
      const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      if (target > nowMonth) return;
      setYear(target.getFullYear());
      setMonth(target.getMonth());
    } else {
      const y = year + dir;
      if (y > now.getFullYear()) return;
      setYear(y);
    }
  };

  if (!canManage) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Shield size={48} className="mx-auto text-amber-500 mb-2" />
        <p className="text-lg font-semibold">Acceso Restringido</p>
        <p className="text-sm">Solo administradores y supervisores pueden ver reportes.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Reporte de Ganancias</h1>
          <p className="text-xs text-slate-500 font-semibold">
            {periodoTexto} · ganancia bruta, gastos y ganancia neta por período
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExportCsv}
            className="px-3.5 py-2 bg-white border-2 border-slate-200 dark:border-[#333333] dark:bg-[#1F1F1F] text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-[#232323] transition cursor-pointer flex items-center gap-1.5">
            <Download size={14} /> CSV
          </button>
          <button onClick={handleExportPdf}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5">
            <FileText size={14} /> PDF
          </button>
        </div>
      </div>

      {/* Controles */}
      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border-2 border-slate-200 dark:border-[#333333] overflow-hidden">
          {([['day', 'Diario'], ['week', 'Semanal'], ['month', 'Mensual']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3.5 py-2 text-xs font-bold transition cursor-pointer ${mode === m ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => goPeriod(-1)} aria-label="Período anterior"
            className="p-2 rounded-xl border-2 border-slate-200 dark:border-[#333333] text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer">
            <ChevronLeft size={14} />
          </button>
          <SelectMenu
            value={year}
            options={yearOptions.map((y) => ({ value: y, label: String(y) }))}
            onChange={(v) => setYear(Number(v))}
            ariaLabel="Año"
            width="w-28"
          />
          {mode === 'day' && (
            <SelectMenu
              value={month}
              options={MESES.map((m, i) => ({ value: i, label: m }))}
              onChange={(v) => setMonth(Number(v))}
              ariaLabel="Mes"
              width="w-40"
            />
          )}
          <button onClick={() => goPeriod(1)} aria-label="Período siguiente" disabled={isAtCurrentPeriod}
            className="p-2 rounded-xl border-2 border-slate-200 dark:border-[#333333] text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronRight size={14} />
          </button>
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl p-3 text-sm font-semibold text-red-600 dark:text-red-400">
          Error cargando reporte: {error}
        </div>
      )}

      {/* KPIs con Δ vs. período anterior */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
        <Kpi label="Tickets" value={String(totals.tickets)} delta={deltaPct(totals.tickets, prevTotals.tickets)} />
        <Kpi label="Facturación" value={money0(totals.revenue)} delta={deltaPct(totals.revenue, prevTotals.revenue)} />
        <Kpi label="Ganancia bruta" value={money0(totals.grossProfit)} delta={deltaPct(totals.grossProfit, prevTotals.grossProfit)} />
        <Kpi label="Gastos" value={money0(totals.expenses)} delta={deltaPct(totals.expenses, prevTotals.expenses)} />
        <Kpi label="Ganancia neta" value={money0(totals.netProfit)} delta={deltaPct(totals.netProfit, prevTotals.netProfit)} />
        <Kpi
          label="Margen neto"
          value={`${marginPct(totals.revenue, totals.netProfit).toFixed(1)}%`}
          delta={marginPct(totals.revenue, totals.netProfit) - marginPct(prevTotals.revenue, prevTotals.netProfit)}
          suffix=" pp"
        />
      </div>

      {/* Tabla por período */}
      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
            {mode === 'day' ? 'Detalle diario' : mode === 'week' ? 'Detalle semanal' : 'Detalle mensual'}
          </p>
        </div>
        {loading && displayRows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : displayRows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">Sin ventas ni gastos en este período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-white/5">
                  <th className="text-left px-4 py-2">Período</th>
                  <th className="text-right px-2 py-2">Tickets</th>
                  <th className="text-right px-2 py-2">Facturación</th>
                  <th className="text-right px-2 py-2">Costo</th>
                  <th className="text-right px-2 py-2">G. bruta</th>
                  <th className="text-right px-2 py-2">Gastos</th>
                  <th className="text-right px-2 py-2">G. neta</th>
                  <th className="text-right px-4 py-2">Margen</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => (
                  <tr key={r.key} className="border-b border-slate-50 dark:border-white/5 last:border-0 hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-4 py-2 font-bold text-slate-800 dark:text-white">
                      {r.label}
                      {r.sublabel && <span className="ml-1.5 text-[10px] font-semibold text-slate-400">{r.sublabel}</span>}
                    </td>
                    <td className="px-2 py-2 text-right tnum text-slate-500 dark:text-slate-400">{r.tickets}</td>
                    <td className="px-2 py-2 text-right tnum font-semibold text-slate-700 dark:text-slate-200">{money0(r.revenue)}</td>
                    <td className="px-2 py-2 text-right tnum text-slate-400">{money0(costOf(r))}</td>
                    <td className="px-2 py-2 text-right tnum font-semibold text-slate-700 dark:text-slate-200">{money0(r.grossProfit)}</td>
                    <td className="px-2 py-2 text-right tnum text-slate-400">{r.expenses > 0 ? money0(r.expenses) : '—'}</td>
                    <td className={`px-2 py-2 text-right tnum font-extrabold ${r.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                      {money0(r.netProfit)}
                    </td>
                    <td className="px-4 py-2 text-right tnum text-xs font-bold text-slate-500 dark:text-slate-400">
                      {marginPct(r.revenue, r.netProfit).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-white/5 font-extrabold text-slate-900 dark:text-white border-t-2 border-slate-200 dark:border-white/10">
                  <td className="px-4 py-2.5">TOTAL</td>
                  <td className="px-2 py-2.5 text-right tnum">{totals.tickets}</td>
                  <td className="px-2 py-2.5 text-right tnum">{money0(totals.revenue)}</td>
                  <td className="px-2 py-2.5 text-right tnum">{money0(costOf(totals))}</td>
                  <td className="px-2 py-2.5 text-right tnum">{money0(totals.grossProfit)}</td>
                  <td className="px-2 py-2.5 text-right tnum">{money0(totals.expenses)}</td>
                  <td className={`px-2 py-2.5 text-right tnum ${totals.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{money0(totals.netProfit)}</td>
                  <td className="px-4 py-2.5 text-right tnum">{marginPct(totals.revenue, totals.netProfit).toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Ganancia por vendedor */}
      {sellers.length > 0 && (
        <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Ganancia por vendedor · {periodoTexto}</p>
          <div className="space-y-1.5">
            {sellers.map((s) => (
              <div key={s.userId || '__none__'} className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white">{s.name}</p>
                  <p className="text-[11px] text-slate-400 font-semibold tnum">{s.tickets} tickets · {money0(s.revenue)} facturados</p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold tnum text-emerald-600 dark:text-emerald-400">{money0(s.profit)}</p>
                  <p className="text-[10px] text-slate-400 font-bold tnum">{marginPct(s.revenue, s.profit).toFixed(1)}% margen</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gastos */}
      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Gastos del negocio</p>
        {!expensesAvailable ? (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
            La tabla <code>expenses</code> todavía no existe. Ejecutá <code>supabase/reportes_mejoras.sql</code> en el
            SQL Editor de Supabase para registrar gastos y ver la ganancia neta.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <label className="text-[11px] font-bold text-slate-500">Fecha
                <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)}
                  className="mt-0.5 w-full px-2.5 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </label>
              <label className="text-[11px] font-bold text-slate-500 sm:col-span-2">Descripción
                <input value={expDesc} onChange={(e) => setExpDesc(e.target.value)}
                  placeholder="Ej: Alquiler local, gas, luz…"
                  className="mt-0.5 w-full px-2.5 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-xs font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </label>
              <label className="text-[11px] font-bold text-slate-500">Monto
                <input value={expAmount} onChange={(e) => setExpAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                  inputMode="decimal" placeholder="0"
                  className="mt-0.5 w-full px-2.5 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </label>
              <div className="text-[11px] font-bold text-slate-500">Categoría
                <div className="mt-0.5">
                  <SelectMenu
                    value={expCat}
                    options={EXPENSE_CATS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))}
                    onChange={(v) => setExpCat(String(v))}
                    ariaLabel="Categoría del gasto"
                    fullWidth
                  />
                </div>
              </div>
            </div>
            <button onClick={handleAddExpense} disabled={savingExp}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
              {savingExp ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Registrar gasto
            </button>

            {expenses.filter((e) => e.spent_on >= curStartDay && e.spent_on < curEndExclusiveDay).length > 0 && (
              <div className="space-y-1.5 pt-1">
                {expenses
                  .filter((e) => e.spent_on >= curStartDay && e.spent_on < curEndExclusiveDay)
                  .map((e, i) => (
                    <div key={`${e.spent_on}-${i}`} className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-white">{e.description}</p>
                        <p className="text-[11px] text-slate-400 font-semibold tnum">
                          {e.spent_on}
                          {e.category && <span className="ml-1.5 uppercase font-bold text-slate-400/80">· {e.category}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-extrabold tnum text-slate-700 dark:text-slate-200">{money0(Number(e.amount))}</p>
                        {isAdmin && (
                          <button onClick={() => handleDeleteExpense(e.spent_on, e.description || '', Number(e.amount))} title="Eliminar"
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition cursor-pointer">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
