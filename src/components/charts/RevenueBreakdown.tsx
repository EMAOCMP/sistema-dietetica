import { useState } from 'react';
import { FileText, Trash2, X } from 'lucide-react';
import type { SaleWithItems } from '../views/DashboardView';

interface RevenueBreakdownProps {
  revenue: number;
  cashTotal: number;
  transferTotal: number;
  cardTotal: number;
  pickupCount: number;
  deliveryCount: number;
  sales: SaleWithItems[];
  onCancelSale: (sale: SaleWithItems) => void;
}

interface Filter {
  kind: 'payment' | 'dispatch';
  value: string;
  label: string;
}

export function RevenueBreakdown({
  revenue,
  cashTotal,
  transferTotal,
  cardTotal,
  pickupCount,
  deliveryCount,
  sales,
  onCancelSale,
}: RevenueBreakdownProps) {
  const [filter, setFilter] = useState<Filter | null>(null);
  const fmt$ = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const methods = [
    { code: 'cash', label: 'Efectivo', value: cashTotal, color: '#10b981', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300' },
    { code: 'transfer', label: 'Transferencia', value: transferTotal, color: '#3B82F6', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20', text: 'text-blue-800 dark:text-blue-300' },
    { code: 'card', label: 'Tarjeta', value: cardTotal, color: '#f59e0b', bg: 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20', text: 'text-amber-800 dark:text-amber-300' },
  ];
  const dispatches = [
    { code: 'pickup', label: 'Retiran en Local', count: pickupCount },
    { code: 'delivery', label: 'Envíos a Domicilio', count: deliveryCount },
  ];
  const totalPay = cashTotal + transferTotal + cardTotal || 1;
  const totalDispatch = pickupCount + deliveryCount || 1;

  const toggleFilter = (f: Filter) => {
    setFilter((prev) => (prev && prev.kind === f.kind && prev.value === f.value ? null : f));
  };

  const filtered = filter
    ? sales.filter((s) =>
        filter.kind === 'payment'
          ? (s.payment_method || 'cash') === filter.value
          : (s.dispatch_type || 'pickup') === filter.value
      )
    : [];
  const filteredTotal = filtered.reduce((a, s) => a + Number(s.total_amount), 0);

  const isActive = (kind: 'payment' | 'dispatch', value: string) =>
    filter?.kind === kind && filter?.value === value;

  return (
    <div className="space-y-4">
      {/* Héroe */}
      <div className="p-4 bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-2xl flex justify-between items-center">
        <div>
          <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-wider">Facturación Total del Período</p>
          <p className="text-3xl font-extrabold text-white mt-1 tnum">{fmt$(revenue)}</p>
        </div>
        <FileText size={36} className="text-white opacity-80" />
      </div>

      {/* Por medio de pago (click para filtrar) */}
      <div className="grid grid-cols-3 gap-3">
        {methods.map((m) => {
          const pct = (m.value / totalPay) * 100;
          const active = isActive('payment', m.code);
          return (
            <button
              key={m.code}
              onClick={() => toggleFilter({ kind: 'payment', value: m.code, label: m.label })}
              title={`Ver ventas en ${m.label}`}
              className={`p-3 rounded-2xl border text-center transition cursor-pointer ${
                active ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white' : ''
              } ${m.bg}`}
            >
              <p className={`text-[10px] font-bold uppercase ${m.text}`}>{m.label}</p>
              <p className={`text-base font-extrabold mt-1 tnum ${m.text}`}>{fmt$(m.value)}</p>
              <div className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden mt-2">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: m.color }} />
              </div>
              <p className={`text-[10px] font-bold mt-1 tnum ${m.text}`}>{pct.toFixed(0)}%</p>
            </button>
          );
        })}
      </div>

      {/* Despacho (click para filtrar) */}
      <div className="grid grid-cols-2 gap-3">
        {dispatches.map((d) => {
          const pct = (d.count / totalDispatch) * 100;
          const active = isActive('dispatch', d.code);
          return (
            <button
              key={d.code}
              onClick={() => toggleFilter({ kind: 'dispatch', value: d.code, label: d.label })}
              title={`Ver ${d.label.toLowerCase()}`}
              className={`p-3 rounded-xl border text-center transition cursor-pointer bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-[#333333] ${
                active ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white' : ''
              }`}
            >
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{d.label}: {d.count}</p>
              <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden mt-2">
                <div className="h-full rounded-full bg-slate-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-1 tnum">{pct.toFixed(0)}%</p>
            </button>
          );
        })}
      </div>

      {/* Lista filtrada (como Detalle de Ventas) */}
      {filter && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#333333] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100 dark:bg-white/5">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
              Ventas · {filter.label} <span className="tnum">({filtered.length})</span>
              <span className="ml-2 text-emerald-700 dark:text-emerald-400 tnum">{fmt$(filteredTotal)}</span>
            </p>
            <button
              onClick={() => setFilter(null)}
              className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
            >
              <X size={14} /> Limpiar
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-[#333333]">
            {filtered.length === 0 ? (
              <p className="text-center text-slate-500 text-xs py-6">Sin ventas en este segmento.</p>
            ) : (
              filtered.map((s) => (
                <div key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                      {s.customer_name}
                      <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                        {new Date(s.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {(s.sale_items?.length || 0)} ítems · {s.profiles?.full_name || 'Vendedor'}
                    </p>
                  </div>
                  <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 tnum shrink-0">
                    ${Number(s.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <button
                    onClick={() => onCancelSale(s)}
                    title="Anular venta"
                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition cursor-pointer shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
