import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import type { Product } from '../../types';

interface StockBreakdownProps {
  products: Product[];
  orders: Record<string, string>;
  onToggleOrdered: (productId: string) => void;
  onCopyOrder: (mode: 'faltan' | 'sugerido') => void;
  /** Objetivo × 2 − stock (atajo comercial del Panel). */
  suggestQty: (p: Product) => number;
  copiedOrder: boolean;
  /** Cantidad que falta para llegar al stock objetivo (objetivo − stock). */
  replenishQty: (p: Product) => number;
}

const fmt$ = (n: number) =>
  `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function StockBreakdown({
  products,
  orders,
  onToggleOrdered,
  onCopyOrder,
  copiedOrder,
  replenishQty,
  suggestQty,
}: StockBreakdownProps) {
  const [copiedMode, setCopiedMode] = useState<'faltan' | 'sugerido' | null>(null);
  const copy = (mode: 'faltan' | 'sugerido') => {
    onCopyOrder(mode);
    setCopiedMode(mode);
    setTimeout(() => setCopiedMode(null), 2500);
  };
  const rows = products
    .map((p) => ({
      p,
      faltan: replenishQty(p),
      ordered: !!orders[p.id],
      empty: Number(p.stock_quantity) <= 0,
    }))
    .sort((a, b) => Number(b.empty) - Number(a.empty) || b.faltan - a.faltan);

  const outOfStock = rows.filter((r) => r.empty).length;
  const lowStock = rows.length - outOfStock;
  const restockCost = rows.reduce((a, r) => a + r.faltan * Number(r.p.cost_price), 0);
  const pendingFaltan = rows.filter((r) => !r.ordered && r.faltan > 0).length;
  const pendingSug = rows.filter((r) => !r.ordered && suggestQty(r.p) > 0).length;
  const orderedCount = rows.filter((r) => r.ordered).length;

  const stats = [
    { label: 'Sin stock', value: String(outOfStock), sub: 'prioridad máxima' },
    { label: 'Bajo stock', value: String(lowStock), sub: 'por debajo del objetivo' },
    { label: 'Costo a completar', value: fmt$(restockCost), sub: 'llegar al objetivo' },
  ];

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="p-4 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex justify-between items-center">
        <div>
          <p className="text-[10px] font-bold text-red-100 uppercase tracking-wider">Productos bajo el objetivo</p>
          <p className="text-3xl font-extrabold text-white mt-1 tnum">{rows.length}</p>
        </div>
        <Warning size={36} weight="fill" className="text-white opacity-80" />
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center dark:bg-white/5 dark:border-[#333333]"
          >
            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">{s.label}</p>
            <p className="text-base font-extrabold text-slate-900 dark:text-white mt-1 tnum">{s.value}</p>
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => copy('faltan')}
          disabled={pendingFaltan === 0}
          title="Cantidad = objetivo − stock"
          className="flex-1 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer dark:bg-[#FF6B00] dark:hover:bg-[#E66000]"
        >
          {copiedMode === 'faltan' || (copiedOrder && copiedMode === null) ? '¡Copiado!' : `Copiar: faltan (${pendingFaltan})`}
        </button>
        <button
          onClick={() => copy('sugerido')}
          disabled={pendingSug === 0}
          title="Cantidad = objetivo × 2 − stock"
          className="flex-1 px-3 py-2.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-900 border border-slate-300 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer dark:bg-white/10 dark:text-white dark:border-[#333333]"
        >
          {copiedMode === 'sugerido' ? '¡Copiado!' : `Copiar: 2× mínimo (${pendingSug})`}
        </button>
        {orderedCount > 0 && (
          <span className="text-xs bg-emerald-100 text-emerald-800 px-3 py-2.5 rounded-xl font-bold dark:bg-emerald-500/10 dark:text-emerald-300">
            {orderedCount} marcados ✓
          </span>
        )}
      </div>

      {/* Lista */}
      <div className="rounded-2xl border border-slate-200 dark:border-[#333333] overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-100 dark:bg-white/5 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            Qué falta comprar <span className="tnum">({rows.length})</span>
          </p>
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Faltan = objetivo − stock</p>
        </div>
        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-[#333333]">
          {rows.length === 0 ? (
            <p className="text-center text-slate-500 text-xs py-6">Sin productos bajo el objetivo. 🎉</p>
          ) : (
            rows.map(({ p, faltan, ordered, empty }) => (
              <div
                key={p.id}
                className={`px-4 py-3 flex items-center gap-3 ${ordered ? 'opacity-60' : ''}`}
              >
                <span className={`w-1.5 h-9 rounded-full shrink-0 ${empty ? 'bg-red-500' : 'bg-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 tnum">
                    Stock <strong className={empty ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>{p.stock_quantity}</strong>
                    {' · '}Objetivo <strong className="text-slate-700 dark:text-slate-200">{p.min_stock}</strong> {p.unit_type}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400">Faltan</p>
                  {faltan > 0 ? (
                    <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 tnum">
                      {faltan} {p.unit_type}
                    </p>
                  ) : (
                    <p className="text-[11px] font-bold text-slate-400">En objetivo</p>
                  )}
                </div>
                <button
                  onClick={() => onToggleOrdered(p.id)}
                  title={ordered ? 'Quitar de pedidos' : 'Marcar como pedido al proveedor'}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition active:scale-95 cursor-pointer shrink-0 ${
                    ordered
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-700 dark:bg-white/10 dark:text-white'
                  }`}
                >
                  {ordered ? '✓ Pedido' : 'Marcar'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
