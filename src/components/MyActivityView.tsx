import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';
import { Activity, Loader2 } from 'lucide-react';

/**
 * Mi actividad: ventas + movimientos de stock del usuario logueado.
 * Visible para todos los roles (cada uno ve solo lo propio).
 */
export function MyActivityView({ profile }: { profile: Profile | null }) {
  const [sales, setSales] = useState<any[]>([]);
  const [moves, setMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const fetchAll = async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [salesRes, movesRes] = await Promise.all([
        supabase.from('sales')
          .select('id, receipt_number, total_amount, payment_method, status, created_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.from('inventory_movements')
          .select('id, type, quantity, previous_quantity, new_quantity, reference_type, product_id, created_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      setSales(salesRes.data || []);
      const pids = [...new Set((movesRes.data || []).map((m: any) => m.product_id).filter(Boolean))];
      let prodNames: Record<string, string> = {};
      if (pids.length) {
        const { data: prods } = await supabase.from('products').select('id, name').in('id', pids);
        prodNames = Object.fromEntries((prods || []).map((p: any) => [p.id, p.name]));
      }
      setMoves((movesRes.data || []).map((m: any) => ({
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

  const totalSold = sales
    .filter((s) => s.status !== 'cancelled')
    .reduce((a, s) => a + Number(s.total_amount || 0), 0);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
        <Loader2 size={18} className="animate-spin" /> Cargando tu actividad...
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <Activity className="text-emerald-600" size={22} /> Mi actividad
        </h1>
        <p className="text-xs text-slate-500 font-semibold">
          {profile?.full_name} · {profile?.role} · Total vendido (sin anuladas):{' '}
          <span className="font-extrabold text-emerald-600 tnum">
            ${totalSold.toLocaleString('es-AR')}
          </span>
        </p>
      </div>

      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-2">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
          Mis ventas ({sales.length})
        </p>
        {sales.length === 0 ? (
          <p className="text-sm text-slate-400 font-semibold">Todavía no registraste ventas.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {sales.map((s) => (
              <div key={s.id} className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white font-mono text-xs">
                    {s.receipt_number || s.id.slice(0, 8)}
                  </p>
                  <p className="text-[11px] text-slate-400 tnum">
                    {new Date(s.created_at).toLocaleString('es-AR')} · {s.payment_method} · {s.status}
                  </p>
                </div>
                <span className="font-extrabold text-emerald-600 tnum">
                  ${Number(s.total_amount).toLocaleString('es-AR')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-2">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
          Mis movimientos de stock ({moves.length})
        </p>
        {moves.length === 0 ? (
          <p className="text-sm text-slate-400 font-semibold">Sin movimientos registrados.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {moves.map((m) => (
              <div key={m.id} className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white text-xs">{m.product_name}</p>
                  <p className="text-[11px] text-slate-400 tnum">
                    {m.type}{m.reference_type ? ` · ${m.reference_type}` : ''}
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
