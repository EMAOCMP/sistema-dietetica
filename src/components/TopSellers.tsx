import { useState, useMemo } from 'react';

export interface TopSellerItem {
  name: string;
  category: string;
  totalQty: number;
  totalRevenue: number;
}

interface TopSellersProps {
  items: TopSellerItem[];
  variant?: 'card' | 'modal';
}

type RankBy = 'qty' | 'revenue';

const MEDALS = [
  'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
];

export function TopSellers({ items, variant = 'card' }: TopSellersProps) {
  const [rankBy, setRankBy] = useState<RankBy>('qty');

  const ranked = useMemo(() => {
    const sorted = [...items].sort((a, b) =>
      rankBy === 'qty' ? b.totalQty - a.totalQty : b.totalRevenue - a.totalRevenue
    );
    const leader = rankBy === 'qty' ? sorted[0]?.totalQty || 1 : sorted[0]?.totalRevenue || 1;
    const totalRev = items.reduce((a, i) => a + i.totalRevenue, 0) || 1;
    return sorted.map((item) => ({
      ...item,
      value: rankBy === 'qty' ? item.totalQty : item.totalRevenue,
      share: (item.totalRevenue / totalRev) * 100,
      barPct: Math.max(((rankBy === 'qty' ? item.totalQty : item.totalRevenue) / leader) * 100, 3),
    }));
  }, [items, rankBy]);

  if (items.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin ventas en este período.</p>;
  }

  const isModal = variant === 'modal';

  return (
    <div>
      {/* Toggle Cantidad / Revenue */}
      <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333] mb-3 w-max">
        {(['qty', 'revenue'] as RankBy[]).map((m) => (
          <button
            key={m}
            onClick={(e) => { e.stopPropagation(); setRankBy(m); }}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
              rankBy === m
                ? 'bg-white text-slate-900 shadow-sm dark:bg-emerald-600 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {m === 'qty' ? 'Por cantidad' : 'Por $'}
          </button>
        ))}
      </div>

      <div className={`space-y-2.5 ${!isModal ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
        {ranked.map((item, idx) => (
          <div
            key={idx}
            className={`${isModal ? 'p-4 rounded-2xl' : 'p-3 rounded-xl'} bg-slate-50 border border-slate-100 dark:bg-white/5 dark:border-[#333333]`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`${isModal ? 'w-8 h-8 text-sm' : 'w-6 h-6 text-xs'} rounded-full font-extrabold flex items-center justify-center shrink-0 ${
                  idx < 3 ? MEDALS[idx] : 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400'
                }`}
              >
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`font-bold text-slate-900 dark:text-white truncate ${isModal ? 'text-sm' : 'text-xs'}`}>{item.name}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold truncate">
                  {item.category} · {item.share.toFixed(1)}% del total
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`font-extrabold text-emerald-600 dark:text-emerald-400 tnum ${isModal ? 'text-sm' : 'text-xs'}`}>
                  ${item.totalRevenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-slate-400 font-bold tnum">{item.totalQty} un/kg</p>
              </div>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-200/70 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${item.barPct}%`,
                  background: idx === 0
                    ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                    : 'linear-gradient(90deg,#10b981,#34d399)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
