import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../types';
import { Activity } from 'lucide-react';
import { fmtMoney } from '../../lib/format';

/**
 * Mi actividad: ventas + movimientos de stock del usuario logueado.
 * Visible para todos los roles (cada uno ve solo lo propio).
 *
 * El total y la cantidad se calculan sobre TODO el período elegido
 * (no sobre la lista recortada que se muestra).
 */

type RangeKey = 'today' | 'week' | 'month' | 'all';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week', label: '7 días' },
  { key: 'month', label: 'Mes' },
  { key: 'all', label: 'Todo' },
];

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  mercadopago: 'Mercado Pago',
  mp: 'Mercado Pago',
};

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completada',
  cancelled: 'Anulada',
  pending: 'Pendiente',
};

const MOVE_LABELS: Record<string, string> = {
  purchase: 'Compra',
  adjustment: 'Ajuste',
  sale: 'Venta',
  return: 'Devolución',
  transfer: 'Transferencia',
  initial: 'Stock inicial',
};

const REFERENCE_LABELS: Record<string, string> = {
  stock_receipt: 'Ingreso',
  sale: 'Venta',
  sale_cancel: 'Anulación',
  adjustment: 'Ajuste manual',
  transfer: 'Transferencia',
};

const label = (map: Record<string, string>, key: string | null | undefined, fallback = '—') =>
  (key && (map[key] || key)) || fallback;

/** Inicio del período en hora local (o null = sin filtro). */
function rangeStart(range: RangeKey): Date | null {
  const now = new Date();
  if (range === 'all') return null;
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'week') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - 6);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function MyActivityView({ profile }: { profile: Profile | null }) {
  const [sales, setSales] = useState<any[]>([]);
  const [moves, setMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>('month');

  const start = useMemo(() => rangeStart(range), [range]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, range]);

  const fetchAll = async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const since = start ? start.toISOString() : null;

      // Ventas del período: se traen todas (columnas livianas) para que el
      // total sea real, y se muestran solo las últimas 30.
      const allSales: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        let q = supabase
          .from('sales')
          .select('id, receipt_number, total_amount, payment_method, status, created_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (since) q = q.gte('created_at', since);
        const { data, error } = await q;
        if (error) throw error;
        allSales.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      setSales(allSales);

      let mq = supabase
        .from('inventory_movements')
        .select('id, type, quantity, previous_quantity, new_quantity, reference_type, product_id, created_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (since) mq = mq.gte('created_at', since);
      const { data: movesData, error: movesErr } = await mq;
      if (movesErr) throw movesErr;

      const pids = [...new Set((movesData || []).map((m: any) => m.product_id).filter(Boolean))];
      let prodNames: Record<string, string> = {};
      if (pids.length) {
        const { data: prods } = await supabase.from('products').select('id, name').in('id', pids);
        prodNames = Object.fromEntries((prods || []).map((p: any) => [p.id, p.name]));
      }
      setMoves((movesData || []).map((m: any) => ({
        ...m,
        product_name: prodNames[m.product_id] || '—',
      })));
    } catch {
      setSales([]);
      setMoves([]);
    } finally {
      setLoading(false);
    }
  };

  const completed = sales.filter((s) => s.status !== 'cancelled');
  const totalSold = completed.reduce((a, s) => a + Number(s.total_amount || 0), 0);
  const cancelledCount = sales.length - completed.length;
  const shownSales = sales.slice(0, 30);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <Activity className="text-emerald-600" size={22} /> Mi actividad
        </h1>
        <p className="text-xs text-slate-500 font-semibold">
          {profile?.full_name} · {profile?.role}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border-2 border-slate-200 dark:border-[#333333] overflow-hidden">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-bold transition cursor-pointer ${range === r.key
                ? 'bg-emerald-600 text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-xs font-bold text-slate-500">
          {loading ? 'Calculando…' : (
            <>
              {completed.length} {completed.length === 1 ? 'venta' : 'ventas'}
              {cancelledCount > 0 && <span className="text-red-500"> · {cancelledCount} anulada{cancelledCount === 1 ? '' : 's'}</span>}
              {' · '}
              <span className="font-extrabold text-emerald-600 tnum">{fmtMoney(totalSold)}</span>
            </>
          )}
        </p>
      </div>

      <div data-tour="activity-sales" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
            Mis ventas ({sales.length})
          </p>
          {sales.length > shownSales.length && (
            <p className="text-[10px] font-bold text-slate-400">
              mostrando las últimas {shownSales.length}
            </p>
          )}
        </div>
        {sales.length === 0 ? (
          <p className="text-sm text-slate-400 font-semibold">
            {loading ? 'Cargando…' : 'No hay ventas en este período.'}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {shownSales.map((s) => {
              const cancelled = s.status === 'cancelled';
              return (
                <div key={s.id} className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                  <div>
                    <p className={`font-bold font-mono text-xs ${cancelled ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-white'}`}>
                      {s.receipt_number || s.id.slice(0, 8)}
                    </p>
                    <p className="text-[11px] text-slate-400 tnum">
                      {new Date(s.created_at).toLocaleString('es-AR')} · {label(PAYMENT_LABELS, s.payment_method)} · {label(STATUS_LABELS, s.status)}
                    </p>
                  </div>
                  <span className={`font-extrabold tnum ${cancelled ? 'text-slate-400 line-through' : 'text-emerald-600'}`}>
                    {fmtMoney(s.total_amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div data-tour="activity-moves" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-2">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
          Mis movimientos de stock ({moves.length})
        </p>
        {moves.length === 0 ? (
          <p className="text-sm text-slate-400 font-semibold">
            {loading ? 'Cargando…' : 'Sin movimientos en este período.'}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {moves.map((m) => (
              <div key={m.id} className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white text-xs">{m.product_name}</p>
                  <p className="text-[11px] text-slate-400 tnum">
                    {label(MOVE_LABELS, m.type)}
                    {m.reference_type ? ` · ${label(REFERENCE_LABELS, m.reference_type)}` : ''}
                    {m.previous_quantity != null ? ` (${m.previous_quantity} → ${m.new_quantity})` : ''}
                    {' · '}{new Date(m.created_at).toLocaleString('es-AR')}
                  </p>
                </div>
                <span className={`font-extrabold tnum ${Number(m.quantity) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {Number(m.quantity) > 0 ? `+${m.quantity}` : m.quantity}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
