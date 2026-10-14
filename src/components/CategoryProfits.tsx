import { useState, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';

export interface CategoryProfitItem {
  category: string;
  revenue: number;
  profit: number;
  units: number;
}

interface CategoryProfitsProps {
  items: CategoryProfitItem[];
  variant?: 'card' | 'modal';
}

type SortBy = 'profit' | 'margin' | 'revenue';

const marginTier = (m: number) =>
  m >= 40
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
    : m >= 25
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';

const barColor = (m: number) =>
  m >= 40
    ? 'linear-gradient(90deg,#10b981,#34d399)'
    : m >= 25
      ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
      : 'linear-gradient(90deg,#ef4444,#f87171)';

export function CategoryProfits({ items, variant = 'card' }: CategoryProfitsProps) {
  const [sortBy, setSortBy] = useState<SortBy>('profit');
  const isModal = variant === 'modal';

  const { ranked, totalProfit, totalRevenue, totalCost } = useMemo(() => {
    const totalProfit = items.reduce((a, c) => a + c.profit, 0);
    const totalRevenue = items.reduce((a, c) => a + c.revenue, 0);
    const withMargin = items.map((c) => ({
      ...c,
      margin: c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0,
      cost: c.revenue - c.profit,
      share: totalProfit > 0 ? (c.profit / totalProfit) * 100 : 0,
    }));
    const sorted = [...withMargin].sort((a, b) =>
      sortBy === 'margin' ? b.margin - a.margin : sortBy === 'revenue' ? b.revenue - a.revenue : b.profit - a.profit
    );
    const leader = sortBy === 'margin'
      ? Math.max(...sorted.map((c) => c.margin), 1)
      : sortBy === 'revenue'
        ? Math.max(...sorted.map((c) => c.revenue), 1)
        : Math.max(...sorted.map((c) => c.profit), 1);
    return {
      ranked: sorted.map((c) => ({
        ...c,
        barPct: Math.max(((sortBy === 'margin' ? c.margin : sortBy === 'revenue' ? c.revenue : c.profit) / leader) * 100, 3),
      })),
      totalProfit,
      totalRevenue,
      totalCost: totalRevenue - totalProfit,
    };
  }, [items, sortBy]);

  if (items.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin datos de rentabilidad.</p>;
  }

  const globalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const fmt$ = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      {/* Héroe + stats (solo modal, como Desglose de Facturación) */}
      {isModal && (
        <>
          <div className="p-4 bg-gradient-to-br from-teal-600 to-teal-800 rounded-2xl flex justify-between items-center mb-3">
            <div>
              <p className="text-[10px] font-bold text-teal-100 uppercase tracking-wider">Ganancia Total del Período</p>
              <p className="text-3xl font-extrabold text-white mt-1 tnum">+{fmt$(totalProfit)}</p>
            </div>
            <TrendingUp size={36} className="text-white opacity-80" />
          </div>
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center dark:bg-white/5 dark:border-[#333333]">
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">Facturación</p>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white mt-1 tnum">{fmt$(totalRevenue)}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center dark:bg-white/5 dark:border-[#333333]">
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">Costo</p>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white mt-1 tnum">{fmt$(totalCost)}</p>
            </div>
            <div className="p-3 bg-teal-50 rounded-2xl border border-teal-200 text-center dark:bg-teal-500/10 dark:border-teal-500/20">
              <p className="text-[10px] font-bold text-teal-700 dark:text-teal-300 uppercase">Margen</p>
              <p className="text-sm font-extrabold text-teal-700 dark:text-teal-300 mt-1 tnum">{globalMargin.toFixed(1)}%</p>
            </div>
          </div>
        </>
      )}

      {/* Toggle orden */}
      <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333] mb-3 w-max max-w-full overflow-x-auto">
        {(['profit', 'margin', 'revenue'] as SortBy[]).map((m) => (
          <button
            key={m}
            onClick={(e) => { e.stopPropagation(); setSortBy(m); }}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer whitespace-nowrap ${
              sortBy === m
                ? 'bg-white text-slate-900 shadow-sm dark:bg-teal-600 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {m === 'profit' ? 'Ganancia' : m === 'margin' ? 'Margen' : 'Facturación'}
          </button>
        ))}
      </div>

      <div className={`space-y-2.5 ${!isModal ? 'max-h-64 overflow-y-auto pr-1' : ''}`}>
        {ranked.map((cat, idx) => (
          <div
            key={idx}
            className={`${isModal ? 'p-4 rounded-2xl' : 'p-3 rounded-xl'} bg-slate-50 border border-slate-100 dark:bg-white/5 dark:border-[#333333]`}
          >
            <div className="flex items-center gap-2">
              <span className={`font-bold text-slate-900 dark:text-white truncate ${isModal ? 'text-sm' : 'text-xs'}`}>
                {cat.category}
              </span>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ml-auto shrink-0 ${marginTier(cat.margin)}`}>
                {cat.margin.toFixed(0)}%
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`font-extrabold text-teal-700 dark:text-teal-400 tnum ${isModal ? 'text-base' : 'text-sm'}`}>
                +{fmt$(cat.profit)}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold tnum">
                de {fmt$(cat.revenue)} · costo {fmt$(cat.cost)} · {Math.round(cat.units)} un · {cat.share.toFixed(1)}% de la ganancia
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden mt-2">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${cat.barPct}%`, background: barColor(cat.margin) }}
              />
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
