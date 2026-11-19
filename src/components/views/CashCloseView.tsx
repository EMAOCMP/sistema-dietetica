import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../types';
import { Calculator, Loader2, Plus, Printer, Save, Shield, Trash2, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { canCloseCash } from '../../lib/permissions';
import { fmtMoney } from '../../lib/format';
import { moneyOrZero, parseMoney } from '../../lib/moneyInput';
import { SelectMenu } from '../ui/SelectMenu';
import type { SelectMenuOption } from '../ui/SelectMenu';

interface CloseRow {
  id: string;
  business_date: string;
  sales_count: number;
  total_amount: number;
  cash_expected: number;
  cash_counted: number;
  difference: number;
  opening_float?: number;
  cash_in?: number;
  cash_out?: number;
  cash_expenses?: number;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface CashMovement {
  id: string;
  business_date: string;
  type: 'opening' | 'in' | 'out';
  amount: number;
  note: string | null;
  created_at: string;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MOVEMENT_LABELS: Record<CashMovement['type'], string> = {
  opening: 'Fondo inicial',
  in: 'Ingreso de efectivo',
  out: 'Retiro / pago en efectivo',
};

/** Opciones del selector "Tipo": con ícono y explicación de qué hace cada una. */
const MOVEMENT_OPTIONS: SelectMenuOption[] = [
  {
    value: 'opening',
    label: 'Fondo inicial',
    hint: 'La plata que ya está en el cajón al abrir',
    icon: <Wallet size={14} />,
  },
  {
    value: 'in',
    label: 'Ingreso de efectivo',
    hint: 'Entra plata: cambio, cobro aparte',
    icon: <ArrowDownLeft size={14} />,
  },
  {
    value: 'out',
    label: 'Retiro / pago',
    hint: 'Sale plata: retiro, flete, proveedor',
    icon: <ArrowUpRight size={14} />,
  },
];

/**
 * Cierre de caja (admin/supervisor): esperado del día vs contado real.
 *
 * Esperado = fondo inicial + ventas en efectivo + ingresos
 *            − retiros − gastos pagados en efectivo.
 */
export function CashCloseView({ profile, showToast }: {
  profile: Profile | null;
  showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) showToast(msg, kind);
  };
  const canClose = canCloseCash(profile?.role);

  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ count: 0, total: 0, cash: 0, transfer: 0, card: 0, mp: 0 });
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<CloseRow[]>([]);
  const [existing, setExisting] = useState<CloseRow | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [cashExpenses, setCashExpenses] = useState(0);
  // Último movimiento del día (venta, gasto o efectivo): sirve para saber si
  // el cierre guardado quedó viejo porque entró algo después de guardarlo.
  const [lastActivityAt, setLastActivityAt] = useState(0);

  const [movType, setMovType] = useState<CashMovement['type']>('opening');
  const [movAmount, setMovAmount] = useState('');
  const [movNote, setMovNote] = useState('');
  const [savingMov, setSavingMov] = useState(false);

  useEffect(() => {
    fetchDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const dayRange = (iso: string) => {
    const start = new Date(iso + 'T00:00:00');
    const end = new Date(iso + 'T23:59:59.999');
    return { start: start.toISOString(), end: end.toISOString() };
  };

  const fetchDay = async () => {
    setLoading(true);
    try {
      const { start, end } = dayRange(date);
      const { data: sales, error } = await supabase
        .from('sales')
        .select('total_amount, payment_method, status, created_at')
        .gte('created_at', start)
        .lte('created_at', end)
        .neq('status', 'cancelled');
      if (error) throw error;
      const list = sales || [];
      const sum = (m: string) => list.filter((s: any) => (s.payment_method || 'cash') === m)
        .reduce((a: number, s: any) => a + Number(s.total_amount || 0), 0);
      setStats({
        count: list.length,
        total: list.reduce((a: number, s: any) => a + Number(s.total_amount || 0), 0),
        cash: sum('cash'),
        transfer: sum('transfer'),
        card: sum('card'),
        mp: sum('mercadopago'),
      });

      const msAt = (v?: string | null) => (v ? new Date(v).getTime() : 0);
      let lastAt = list.reduce((max: number, s: any) => Math.max(max, msAt(s.created_at)), 0);

      const { data: prev } = await supabase
        .from('cash_closes')
        .select('*')
        .eq('business_date', date)
        .maybeSingle();
      setExisting((prev as CloseRow) || null);
      if (prev) {
        setCounted(String((prev as CloseRow).cash_counted));
        setNotes((prev as any).notes || '');
      } else {
        setCounted('');
        setNotes('');
      }

      const { data: movs } = await supabase
        .from('cash_movements')
        .select('id, business_date, type, amount, note, created_at')
        .eq('business_date', date)
        .order('created_at', { ascending: true });
      setMovements((movs || []) as CashMovement[]);
      lastAt = (movs || []).reduce(
        (max: number, m: any) => Math.max(max, msAt(m.created_at)),
        lastAt,
      );

      // Gastos pagados en efectivo del día (salen del cajón).
      try {
        const { data: exp } = await supabase
          .from('expenses')
          .select('amount, payment_method, created_at')
          .eq('spent_on', date)
          .eq('payment_method', 'cash');
        setCashExpenses((exp || []).reduce((a: number, e: any) => a + Number(e.amount || 0), 0));
        lastAt = (exp || []).reduce(
          (max: number, e: any) => Math.max(max, msAt(e.created_at)),
          lastAt,
        );
      } catch {
        setCashExpenses(0);
      }
      setLastActivityAt(lastAt);

      const { data: hist } = await supabase
        .from('cash_closes')
        .select('*')
        .order('business_date', { ascending: false })
        .limit(14);
      setHistory((hist || []) as CloseRow[]);
    } catch (e: any) {
      notify(`Error: ${e?.message || e}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const sumMov = (type: CashMovement['type']) =>
    movements.filter((m) => m.type === type).reduce((a, m) => a + Number(m.amount || 0), 0);

  const opening = sumMov('opening');
  const cashIn = sumMov('in');
  const cashOut = sumMov('out');
  const expected = opening + stats.cash + cashIn - cashOut - cashExpenses;
  const openingRow = movements.find((m) => m.type === 'opening') || null;

  const countedNum = moneyOrZero(counted);
  const diff = countedNum - expected;
  const hasCount = counted.trim() !== '';
  const countValid = !hasCount || Number.isFinite(parseMoney(counted));
  const expectedChanged = !!existing && Math.abs(Number(existing.cash_expected) - expected) > 0.009;
  const closeSavedAt = existing
    ? new Date(existing.updated_at || existing.created_at).getTime()
    : 0;
  // 1 s de margen: guardar y recargar no siempre caen en el mismo milisegundo.
  const closeStale = !!existing && lastActivityAt > closeSavedAt + 1000;
  const closeSavedLabel = closeSavedAt
    ? new Date(closeSavedAt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    : '';

  // Vista previa: cómo queda el esperado con el movimiento que se está cargando.
  const movAmountNum = moneyOrZero(movAmount);
  const movPreview = movAmountNum > 0
    ? (movType === 'opening' && openingRow
      ? expected - Number(openingRow.amount) + movAmountNum
      : movType === 'out'
        ? expected - movAmountNum
        : expected + movAmountNum)
    : null;

  const handleAddMovement = async () => {
    if (!canClose) return;
    const amount = moneyOrZero(movAmount);
    if (!(amount > 0)) {
      notify('El monto tiene que ser mayor a cero.', 'warning');
      return;
    }
    if (movType === 'out') {
      // No puede salir del cajón más de lo que debería haber.
      const available = opening + stats.cash + cashIn - cashOut - cashExpenses;
      if (amount > available + 0.009) {
        const ok = confirm(
          `El retiro (${fmtMoney(amount)}) supera el efectivo esperado del día (${fmtMoney(available)}).\n\n` +
          'Solo puede salir del cajón lo que hay. Si igual lo registrás, el cierre va a dar faltante.\n\n¿Registrarlo igual?',
        );
        if (!ok) return;
      }
    }
    if (movType === 'opening' && openingRow && !confirm(`Ya hay un fondo inicial de ${fmtMoney(openingRow.amount)} para el ${date}. ¿Reemplazarlo?`)) return;
    setSavingMov(true);
    try {
      if (movType === 'opening' && openingRow) {
        const { error } = await supabase
          .from('cash_movements')
          .update({ amount, note: movNote.trim() || null })
          .eq('id', openingRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cash_movements').insert({
          business_date: date,
          type: movType,
          amount,
          note: movNote.trim() || null,
          user_id: profile?.id || null,
        });
        if (error) throw error;
      }
      notify('Movimiento de efectivo guardado.', 'success');
      setMovAmount('');
      setMovNote('');
      // Después de fijar el fondo, lo habitual es un retiro o un gasto.
      if (movType === 'opening') setMovType('out');
      fetchDay();
    } catch (e: any) {
      notify(`Error: ${e?.message || e}`, 'error');
    } finally {
      setSavingMov(false);
    }
  };

  const handleDeleteMovement = async (m: CashMovement) => {
    if (!confirm(`¿Eliminar "${MOVEMENT_LABELS[m.type]}" de ${fmtMoney(m.amount)}?`)) return;
    const { error } = await supabase.from('cash_movements').delete().eq('id', m.id);
    if (error) {
      notify(`Error: ${error.message}`, 'error');
      return;
    }
    notify('Movimiento eliminado.', 'info');
    fetchDay();
  };

  const handleSave = async () => {
    if (!canClose) return;
    if (!hasCount) {
      notify('Escribí el efectivo contado para guardar el cierre.', 'warning');
      return;
    }
    if (!countValid) {
      notify('El efectivo contado no es un importe válido.', 'error');
      return;
    }
    if (existing && !confirm(`Ya hay un cierre guardado para el ${date}. ¿Querés reemplazarlo?`)) return;
    setSaving(true);
    try {
      const { start, end } = dayRange(date);
      const payload: any = {
        business_date: date,
        period_start: start,
        period_end: end,
        sales_count: stats.count,
        total_amount: stats.total,
        cash_expected: expected,
        transfer_total: stats.transfer,
        card_total: stats.card,
        mp_total: stats.mp,
        opening_float: opening,
        cash_in: cashIn,
        cash_out: cashOut,
        cash_expenses: cashExpenses,
        cash_counted: countedNum,
        difference: diff,
        notes: notes || null,
        user_id: profile?.id || null,
        // Marca de la última vez que se guardó: si después entra algo, se avisa.
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('cash_closes')
        .upsert(payload, { onConflict: 'business_date' });
      if (error) throw error;
      notify(`Cierre del ${date} guardado. Diferencia: $${diff.toLocaleString('es-AR')}`, diff === 0 ? 'success' : 'warning');
      fetchDay();
    } catch (e: any) {
      notify(`Error al guardar: ${e?.message || e}${e?.code ? ` (${e.code})` : ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!canClose) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Shield size={48} className="mx-auto text-amber-500 mb-2" />
        <p className="text-lg font-semibold">Acceso Restringido</p>
        <p className="text-sm">Solo administradores y supervisores hacen el cierre de caja.</p>
      </div>
    );
  }

  const money = (n: number) => fmtMoney(n);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Calculator className="text-emerald-600" size={22} /> Cierre de caja
          </h1>
          <p className="text-xs text-slate-500 font-semibold">Esperado del día vs contado real del cajón.</p>
        </div>
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
        />
      </div>

      {loading ? (
        <p className="text-center text-slate-500 dark:text-slate-400 py-8 flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin" /> Calculando...
        </p>
      ) : (
        <>
          <div data-tour="cashclose-summary" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Ventas', value: String(stats.count), mono: true },
              { label: 'Total', value: money(stats.total), mono: true },
              { label: 'Efectivo esperado', value: money(expected), mono: true, hi: true },
              { label: 'Transf. + Tarjeta + MP', value: money(stats.transfer + stats.card + stats.mp), mono: true },
            ].map((k) => (
              <div key={k.label} className={`rounded-2xl border-2 p-3 ${k.hi ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/40' : 'border-slate-200 dark:border-[#333333] bg-white dark:bg-[#1F1F1F]'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{k.label}</p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>

          <div data-tour="cashclose-movements" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-3">
            <div>
              <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Efectivo del día</p>
              <p className="text-[11px] font-semibold text-slate-500 tabular-nums mt-1">
                Fondo {money(opening)} + Ventas {money(stats.cash)} + Ingresos {money(cashIn)}
                {' '}− Retiros {money(cashOut)} − Gastos {money(cashExpenses)} ={' '}
                <span className="font-extrabold text-slate-800 dark:text-white">{money(expected)}</span>
              </p>
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-1">
                Los gastos en efectivo de Reportes se descuentan solos: no los cargues también como retiro.
              </p>
            </div>

            <div className="grid sm:grid-cols-12 gap-2 items-end">
              <div className="text-[11px] font-bold text-slate-500 sm:col-span-4">
                <span className="block">Tipo</span>
                <div className="mt-0.5">
                  <SelectMenu
                    value={movType}
                    options={MOVEMENT_OPTIONS}
                    onChange={(v) => setMovType(v as CashMovement['type'])}
                    ariaLabel="Tipo de movimiento de efectivo"
                    width="w-72"
                    fullWidth
                  />
                </div>
              </div>
              <label className="text-[11px] font-bold text-slate-500 sm:col-span-3">Monto
                <input
                  type="text" inputMode="decimal" autoComplete="off"
                  value={movAmount}
                  onChange={(e) => setMovAmount(e.target.value)}
                  placeholder="0"
                  className="mt-0.5 w-full px-2.5 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </label>
              <label className="text-[11px] font-bold text-slate-500 sm:col-span-3">Nota
                <input
                  value={movNote}
                  onChange={(e) => setMovNote(e.target.value)}
                  placeholder="Opcional"
                  className="mt-0.5 w-full px-2.5 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-xs font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </label>
              <button
                onClick={handleAddMovement}
                disabled={savingMov}
                className="sm:col-span-2 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-extrabold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {savingMov ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {movType === 'opening' ? 'Fijar' : movType === 'in' ? 'Ingresar' : 'Retirar'}
              </button>
            </div>

            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              {MOVEMENT_OPTIONS.find((o) => o.value === movType)?.hint}.
              {movPreview !== null && (
                <span className={`font-extrabold ${movPreview < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                  {' '}Con este movimiento el esperado queda en {money(movPreview)}
                  {movPreview < 0 ? ' — negativo, revisá el monto' : ''}.
                </span>
              )}
            </p>

            {movType === 'opening' && openingRow && (
              <p className="text-[11px] font-semibold text-amber-600">
                Ya hay un fondo de {money(openingRow.amount)}: al agregar, se reemplaza.
              </p>
            )}

            {movements.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Sin movimientos de efectivo en este día.</p>
            ) : (
              <div className="space-y-1.5">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white text-xs">
                        {MOVEMENT_LABELS[m.type]}
                        {m.note ? <span className="font-semibold text-slate-500 dark:text-slate-400"> · {m.note}</span> : null}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-extrabold tabular-nums ${m.type === 'out' ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {m.type === 'out' ? '−' : '+'}{money(m.amount)}
                      </span>
                      <button
                        onClick={() => handleDeleteMovement(m)}
                        title="Eliminar movimiento"
                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-red-600 rounded-lg transition cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {cashExpenses > 0 && (
              <p className="text-[11px] font-semibold text-slate-500">
                Incluye {money(cashExpenses)} de gastos pagados en efectivo (Reporte de Ganancias).
              </p>
            )}
          </div>

          <div data-tour="cashclose-count" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-[11px] font-bold text-slate-500">
                <span className="flex items-center justify-between gap-2">
                  <span>Contado real en cajón ($)</span>
                  <button
                    type="button"
                    onClick={() => setCounted(String(expected))}
                    className="text-[10px] font-extrabold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 underline cursor-pointer"
                  >
                    Usar esperado
                  </button>
                </span>
                <input
                  type="text" inputMode="decimal" autoComplete="off"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder="0"
                  className={`mt-0.5 w-full px-3 py-2.5 border-2 rounded-xl text-lg font-mono font-extrabold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500 ${countValid ? 'border-slate-200 dark:border-[#333333]' : 'border-rose-400'}`}
                />
              </label>
              <label className="text-[11px] font-bold text-slate-500">Notas
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: faltante rendido, etc."
                  className="mt-0.5 w-full px-3 py-2.5 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </label>
            </div>

            {closeStale ? (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-3 py-2">
                <p className="text-[11px] font-extrabold text-amber-700 dark:text-amber-300">
                  El cierre quedó desactualizado
                </p>
                <p className="text-[11px] font-semibold text-amber-700/90 dark:text-amber-200/80">
                  Se guardó el {closeSavedLabel} y después entraron ventas, gastos o movimientos de efectivo.
                  Guardá de nuevo para que el comprobante coincida.
                </p>
              </div>
            ) : expectedChanged ? (
              <p className="text-[11px] font-semibold text-amber-600">
                El esperado cambió desde el último cierre (era {money(Number(existing!.cash_expected))}).
                Guardá de nuevo para actualizarlo.
              </p>
            ) : existing ? (
              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                Cierre guardado el {closeSavedLabel}. Sin movimientos posteriores.
              </p>
            ) : null}

            <div className={`rounded-2xl p-3 text-center font-extrabold tabular-nums ${hasCount && countValid && diff === 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : hasCount && diff !== 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`}>
              Diferencia: {!hasCount ? '—' : !countValid ? 'importe inválido' : money(diff)} {hasCount && countValid && (diff === 0 ? '✓ Cuadra' : diff > 0 ? '(sobrante)' : '(faltante)')}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {existing ? 'Actualizar cierre' : 'Guardar cierre'}
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 transition cursor-pointer"
                title="Imprimir"
              >
                <Printer size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      <div data-tour="cashclose-history" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-1.5">
        <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Últimos cierres</p>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Todavía no hay cierres.</p>
        ) : history.map((h) => (
          <div key={h.id} className="flex justify-between items-center py-2 border-b last:border-0 border-slate-100 dark:border-[#2a2a2a] text-sm">
            <div>
              <p className="font-extrabold text-slate-800 dark:text-white font-mono">{h.business_date} · {h.sales_count} ventas</p>
              <p className="text-[11px] text-slate-500 font-semibold tabular-nums">
                Esperado {money(h.cash_expected)} · Contado {money(h.cash_counted)}
              </p>
            </div>
            <span className={`text-xs font-extrabold tabular-nums px-2.5 py-1 rounded-full ${Number(h.difference) === 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>
              {money(h.difference)}
            </span>
          </div>
        ))}
      </div>

      {/* Comprobante de impresión (solo visible al imprimir) */}
      <div id="cashclose-print-area">
        <div className="text-center border-b-2 border-black pb-2 mb-3">
          <img src="/logo-512.jpg" alt="Vishal Dietética" style={{ height: 56, margin: '0 auto 4px', objectFit: 'contain' }} />
          <p className="text-lg font-extrabold">DIETÉTICA VISHAL</p>
          <p className="text-sm font-bold">Cierre de caja · {date.split('-').reverse().join('/')}</p>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {[
              ['Ventas del día', String(stats.count)],
              ['Total facturado', money(stats.total)],
              ['Ventas en efectivo', money(stats.cash)],
              ['Fondo inicial', money(opening)],
              ['Ingresos de efectivo', money(cashIn)],
              ['Retiros / pagos', money(cashOut)],
              ['Gastos en efectivo', money(cashExpenses)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '4px 0', borderBottom: '1px solid #ddd' }}>{k}</td>
                <td style={{ padding: '4px 0', borderBottom: '1px solid #ddd', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: '8px 0', fontWeight: 800 }}>Efectivo esperado</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{money(expected)}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', fontWeight: 800 }}>Contado real en cajón</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{hasCount && countValid ? money(countedNum) : '—'}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', fontWeight: 800, borderTop: '2px solid #000' }}>Diferencia</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 800, borderTop: '2px solid #000', fontVariantNumeric: 'tabular-nums' }}>
                {hasCount && countValid ? `${money(diff)}${diff === 0 ? ' (cuadra)' : diff > 0 ? ' (sobrante)' : ' (faltante)'}` : '—'}
              </td>
            </tr>
          </tbody>
        </table>

        {notes.trim() && (
          <p style={{ marginTop: 12, fontSize: 12 }}>
            <span style={{ fontWeight: 800 }}>Notas: </span>{notes}
          </p>
        )}

        <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <div>
            <div style={{ borderTop: '1px solid #000', width: 180, paddingTop: 4 }}>Firma</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontWeight: 700 }}>{profile?.full_name || '—'}</p>
            <p>Impreso el {new Date().toLocaleString('es-AR')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
