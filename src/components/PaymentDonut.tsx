import { useState } from 'react';

export interface PaySlice {
  label: string;
  value: number;
  color: string;
}

interface PaymentDonutProps {
  data: PaySlice[];
  size?: number;
}

export function PaymentDonut({ data, size = 150 }: PaymentDonutProps) {
  const [active, setActive] = useState<number | null>(null);

  const total = data.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-slate-400 text-sm">Sin datos</div>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;
  const sw = 22;
  const GAP = data.filter((s) => s.value > 0).length > 1 ? 1.5 : 0;

  let acc = 0;
  const segs = data
    .map((s, i) => {
      const pct = (s.value / total) * 100;
      const start = acc;
      acc += pct;
      return { ...s, pct, start, i };
    })
    .filter((s) => s.pct > 0);

  const shown = active !== null ? segs.find((s) => s.i === active) : null;
  const fmt$ = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Compacto para el centro del donut (el hueco es ~100px): $126,3 mil / $1,2 M
  const fmtCompact$ = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
    if (n >= 10_000) return `$${(n / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} mil`;
    return fmt$(n);
  };

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth={sw} className="dark:stroke-white/10" />
          {segs.map((s) => (
            <circle
              key={s.i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={active === null || active === s.i ? sw : sw - 4}
              pathLength={100}
              strokeDasharray={`${Math.max(s.pct - GAP, 0.5)} ${100 - Math.max(s.pct - GAP, 0.5)}`}
              strokeDashoffset={25 - s.start}
              strokeLinecap="butt"
              opacity={active === null || active === s.i ? 1 : 0.3}
              className="transition-all duration-200 cursor-pointer"
              onMouseEnter={() => setActive(s.i)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${s.label}: ${fmt$(s.value)} (${s.pct.toFixed(1)}%)`}</title>
            </circle>
          ))}
        </svg>
        {/* Centro */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {shown ? shown.label : 'Total'}
          </span>
          <span
            title={shown ? fmt$(shown.value) : fmt$(total)}
            className="text-base font-extrabold tnum text-slate-900 dark:text-white leading-tight whitespace-nowrap"
          >
            {shown ? fmtCompact$(shown.value) : fmtCompact$(total)}
          </span>
          <span
            className="text-[11px] font-bold tnum px-1.5 py-0.5 rounded-md"
            style={{
              color: shown ? shown.color : '#64748b',
              backgroundColor: shown ? `${shown.color}1a` : 'transparent',
            }}
          >
            {shown ? `${shown.pct.toFixed(1)}%` : `${segs.length} medios`}
          </span>
        </div>
      </div>

      {/* Leyenda con montos */}
      <div className="flex-1 space-y-2.5 min-w-0">
        {segs.map((s) => (
          <button
            key={s.i}
            onMouseEnter={() => setActive(s.i)}
            onMouseLeave={() => setActive(null)}
            onClick={() => setActive(active === s.i ? null : s.i)}
            className={`w-full text-left rounded-xl px-2.5 py-2 transition cursor-pointer ${
              active === s.i ? 'bg-slate-100 dark:bg-white/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="font-semibold text-slate-600 dark:text-slate-300 truncate">{s.label}</span>
              <span className="font-extrabold tnum text-slate-900 dark:text-white ml-auto">{fmt$(s.value)}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                />
              </div>
              <span className="text-[10px] font-bold tnum text-slate-500 dark:text-slate-400 w-9 text-right">
                {s.pct.toFixed(0)}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
