import { useState, useMemo } from 'react';

export interface HourSlot {
  label: string;
  hour: number;
  revenue: number;
  tickets: number;
}

interface HourlyDemandProps {
  data: Record<string, { revenue: number; tickets: number }>;
  variant?: 'card' | 'modal';
}

type SortBy = 'chrono' | 'demand';
type Metric = 'revenue' | 'tickets';

const parseHour = (label: string) => {
  const m = label.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

export function HourlyDemand({ data, variant = 'card' }: HourlyDemandProps) {
  const [sortBy, setSortBy] = useState<SortBy>('demand');
  const [metric, setMetric] = useState<Metric>('revenue');
  const isModal = variant === 'modal';

  const { slots, peak, valley, totalTickets, totalRevenue } = useMemo(() => {
    const slots: HourSlot[] = Object.entries(data).map(([label, v]) => ({
      label,
      hour: parseHour(label),
      revenue: v.revenue,
      tickets: v.tickets,
    }));
    const byValue = (s: HourSlot) => (metric === 'revenue' ? s.revenue : s.tickets);
    const sorted = [...slots].sort((a, b) =>
      sortBy === 'chrono' ? a.hour - b.hour : byValue(b) - byValue(a)
    );
    const peak = slots.length > 0 ? slots.reduce((a, b) => (byValue(b) > byValue(a) ? b : a)) : null;
    const valley = slots.length > 0 ? slots.reduce((a, b) => (byValue(b) < byValue(a) ? b : a)) : null;
    return {
      slots: sorted,
      peak,
      valley,
      totalTickets: slots.reduce((a, s) => a + s.tickets, 0),
      totalRevenue: slots.reduce((a, s) => a + s.revenue, 0),
    };
  }, [data, sortBy, metric]);

  if (slots.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin ventas por horario en este período.</p>;
  }

  const maxVal = Math.max(...slots.map((s) => (metric === 'revenue' ? s.revenue : s.tickets)), 1);
  const fmt$ = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      {/* Toggles */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333]">
          {(['demand', 'chrono'] as SortBy[]).map((m) => (
            <button
              key={m}
              onClick={(e) => { e.stopPropagation(); setSortBy(m); }}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                sortBy === m
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {m === 'demand' ? 'Por demanda' : 'Por hora'}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333]">
          {(['revenue', 'tickets'] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={(e) => { e.stopPropagation(); setMetric(m); }}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                metric === m
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {m === 'revenue' ? '$' : 'Tickets'}
            </button>
          ))}
        </div>
      </div>

      {/* Veredicto */}
      {peak && valley && (
        <div className="mb-3 p-3 rounded-xl bg-blue-50 border border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20 text-xs">
          <p className="font-bold text-blue-900 dark:text-blue-200">
            🔥 Pico: {peak.label} <span className="tnum">({metric === 'revenue' ? fmt$(peak.revenue) : `${peak.tickets} tickets`})</span>
          </p>
          <p className="font-semibold text-blue-700 dark:text-blue-300 mt-0.5">
            Valle: {valley.label} <span className="tnum">({metric === 'revenue' ? fmt$(valley.revenue) : `${valley.tickets} tickets`})</span>
            <span className="font-normal"> · {totalTickets} tickets · {fmt$(totalRevenue)} en el período</span>
          </p>
        </div>
      )}

      <div className={`space-y-2 ${!isModal ? 'max-h-64 overflow-y-auto pr-1' : ''}`}>
        {slots.map((s) => {
          const val = metric === 'revenue' ? s.revenue : s.tickets;
          const isPeak = peak !== null && s.label === peak.label;
          return (
            <div
              key={s.label}
              className={`${isModal ? 'p-3.5' : 'p-3'} rounded-xl border text-xs transition ${
                isPeak
                  ? 'bg-amber-50 border-amber-300 dark:bg-amber-500/10 dark:border-amber-500/30'
                  : 'bg-slate-50 border-slate-100 dark:bg-white/5 dark:border-[#333333]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`font-bold ${isPeak ? 'text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                  {s.label}
                </span>
                {isPeak && (
                  <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
                    Pico
                  </span>
                )}
                <span className="ml-auto text-right">
                  <span className={`font-extrabold tnum ${isPeak ? 'text-amber-700 dark:text-amber-300' : 'text-blue-600 dark:text-blue-400'}`}>
                    {metric === 'revenue' ? fmt$(s.revenue) : `${s.tickets} tickets`}
                  </span>
                  <span className="block text-[10px] font-semibold text-slate-400 tnum">
                    {metric === 'revenue' ? `${s.tickets} tickets` : fmt$(s.revenue)}
                  </span>
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max((val / maxVal) * 100, 3)}%`,
                    background: isPeak
                      ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                      : 'linear-gradient(90deg,#3b82f6,#60a5fa)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
