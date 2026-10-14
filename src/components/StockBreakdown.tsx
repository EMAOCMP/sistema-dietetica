import { Warning } from '@phosphor-icons/react';
import type { Product } from '../types';

interface StockBreakdownProps {
  products: Product[];
  orders: Record<string, string>;
  onToggleOrdered: (productId: string) => void;
  onCopyOrder: () => void;
  copiedOrder: boolean;
  suggestQty: (p: Product) => number;
}

export function StockBreakdown({
  products,
  orders,
  onToggleOrdered,
  onCopyOrder,
  copiedOrder,
  suggestQty,
}: StockBreakdownProps) {
  const fmt$ = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const outOfStock = products.filter((p) => Number(p.stock_quantity) <= 0);
  const lowStock = products.filter((p) => Number(p.stock_quantity) > 0);
  const restockCost = products.reduce(
    (a, p) => a + suggestQty(p) * Number(p.cost_price),
    0
  );
  const orderedCount = products.filter((p) => orders[p.id]).length;

  const stats = [
    { label: 'Sin stock', value: String(outOfStock.length), sub: 'prioridad máxima' },
    { label: 'Bajo stock', value: String(lowStock.length), sub: 'bajo el mínimo' },
    { label: 'Costo reposición', value: fmt$(restockCost), sub: 'estimado total' },
  ];

  return (
    <div className="space-y-4">
      {/* Héroe */}
      <div className="p-4 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex justify-between items-center">
        <div>
          <p className="text-[10px] font-bold text-red-100 uppercase tracking-wider">Ítems en Stock Crítico</p>
          <p className="text-3xl font-extrabold text-white mt-1 tnum">{products.length}</p>
        </div>
        <Warning size={36} weight="fill" className="text-white opacity-80" />
      </div>

      {/* Stats */}
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
          onClick={onCopyOrder}
          disabled={products.length - orderedCount === 0}
          className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer dark:bg-[#FF6B00] dark:hover:bg-[#E66000]"
        >
          {copiedOrder ? '¡Orden copiada!' : `📋 Copiar orden (${products.length - orderedCount} pendientes)`}
        </button>
        {orderedCount > 0 && (
          <span className="text-xs bg-emerald-100 text-emerald-800 px-3 py-2.5 rounded-xl font-bold dark:bg-emerald-500/10 dark:text-emerald-300">
            {orderedCount} pedidos ✓
          </span>
        )}
      </div>

      {/* Lista (como Detalle de Ventas) */}
      <div className="rounded-2xl border border-slate-200 dark:border-[#333333] overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-100 dark:bg-white/5">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            Productos críticos <span className="tnum">({products.length})</span>
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-[#333333]">
          {products.length === 0 ? (
            <p className="text-center text-slate-500 text-xs py-6">Sin productos en stock crítico. 🎉</p>
          ) : (
            products.map((p) => {
              const sug = suggestQty(p);
              const ordered = !!orders[p.id];
              const empty = Number(p.stock_quantity) <= 0;
              return (
                <div key={p.id} className={`px-4 py-2.5 flex items-center gap-3 ${ordered ? 'opacity-60' : ''}`}>
                  <span className={`w-2 h-8 rounded-full shrink-0 ${empty ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{p.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 tnum">
                      Stock <strong className={empty ? 'text-red-600 dark:text-red-400' : ''}>{p.stock_quantity}</strong>
                      {' '}· mín {p.min_stock} {p.unit_type} · sug +{sug} ({fmt$(sug * Number(p.cost_price))})
                    </p>
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
                    {ordered ? '✓ Pedido' : 'Marcar pedido'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
