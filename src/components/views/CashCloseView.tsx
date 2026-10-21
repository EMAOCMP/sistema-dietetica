import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../types';
import { Calculator, Loader2, Printer, Save, Shield } from 'lucide-react';

interface CloseRow {
  id: string;
  business_date: string;
  sales_count: number;
  total_amount: number;
  cash_expected: number;
  cash_counted: number;
  difference: number;
  created_at: string;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Cierre de caja (admin/supervisor): esperado del día vs contado real.
 */
export function CashCloseView({ profile, showToast }: {
  profile: Profile | null;
  showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) showToast(msg, kind);
  };
  const canClose = ['admin', 'supervisor', 'vendedor'].includes(profile?.role || '');

  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ count: 0, total: 0, cash: 0, transfer: 0, card: 0 });
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<CloseRow[]>([]);
  const [existing, setExisting] = useState<CloseRow | null>(null);

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
        .select('total_amount, payment_method, status')
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
      });
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

  const countedNum = parseFloat(counted) || 0;
  const diff = countedNum - stats.cash;

  const handleSave = async () => {
    if (!canClose) return;
    setSaving(true);
    try {
      const { start, end } = dayRange(date);
      const payload: any = {
        business_date: date,
        period_start: start,
        period_end: end,
        sales_count: stats.count,
        total_amount: stats.total,
        cash_expected: stats.cash,
        transfer_total: stats.transfer,
        card_total: stats.card,
        cash_counted: countedNum,
        difference: diff,
        notes: notes || null,
        user_id: profile?.id || null,
      };
      const { error } = await supabase
        .from('cash_closes')
        .upsert(payload, { onConflict: 'business_date' });
      if (error) throw error;
      notify(`Cierre del ${date} guardado. Diferencia: $${diff.toLocaleString('es-AR')}`, diff === 0 ? 'success' : 'warning');
      fetchDay();
    } catch (e: any) {
      notify(`Error al guardar: ${e?.message || e}`, 'error');
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

  const money = (n: number) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Calculator className="text-emerald-600" size={22} /> Cierre de caja
          </h1>
          <div className="text-center pb-4 mb-4 border-b border-slate-100 dark:border-white/5">
            <img src="/logo-512.jpg" alt="Vishal Dietética" className="h-12 mx-auto mb-1 object-contain" />
            <p className="font-extrabold text-slate-900 dark:text-white">DIETÉTICA VISHAL</p>
          </div>
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
        <p className="text-center text-slate-400 py-8 flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin" /> Calculando...
        </p>
      ) : (
        <>
          <div data-tour="cashclose-summary" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Ventas', value: String(stats.count), mono: true },
              { label: 'Total', value: money(stats.total), mono: true },
              { label: 'Efectivo esperado', value: money(stats.cash), mono: true, hi: true },
              { label: 'Transf. + Tarjeta', value: money(stats.transfer + stats.card), mono: true },
            ].map((k) => (
              <div key={k.label} className={`rounded-2xl border-2 p-3 ${k.hi ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/40' : 'border-slate-200 dark:border-[#333333] bg-white dark:bg-[#1F1F1F]'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{k.label}</p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>

          <div data-tour="cashclose-count" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-[11px] font-bold text-slate-500">Contado real en cajón ($)
                <input
                  type="number" min="0" step="any" inputMode="decimal"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder="0"
                  className="mt-0.5 w-full px-3 py-2.5 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-lg font-mono font-extrabold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            <div className={`rounded-2xl p-3 text-center font-extrabold tabular-nums ${diff === 0 && counted !== '' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : diff !== 0 && counted !== '' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'}`}>
              Diferencia: {counted === '' ? '—' : money(diff)} {counted !== '' && (diff === 0 ? '✓ Cuadra' : diff > 0 ? '(sobrante)' : '(faltante)')}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving || counted === ''}
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
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Últimos cierres</p>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400 font-semibold">Todavía no hay cierres.</p>
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
    </div>
  );
}
