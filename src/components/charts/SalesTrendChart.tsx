import { useState, useMemo } from 'react';

export interface DayStat {
  date: string;
  label: string;
  revenue: number;
  tickets: number;
  profit: number;
  avgTicket: number;
}

type Metric = 'revenue' | 'tickets' | 'profit';

interface SalesTrendChartProps {
  days: DayStat[];
  height?: number;
}

const METRICS: Record<Metric, { label: string; color: string; light: string; format: (n: number) => string }> = {
  revenue: {
    label: 'Ingresos',
    color: '#0ea5e9',
    light: '#0ea5e9',
    format: (n) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  },
  tickets: {
    label: 'Tickets',
    color: '#8b5cf6',
    light: '#8b5cf6',
    format: (n) => `${Math.round(n)}`,
  },
  profit: {
    label: 'Ganancia',
    color: '#10b981',
    light: '#10b981',
    format: (n) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  },
};

export function SalesTrendChart({ days, height = 260 }: SalesTrendChartProps) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 680;
  const H = height;
  const PLOT_T = 10;
  const PLOT_B = H - 26;
  const PLOT_H = PLOT_B - PLOT_T;
  const AXIS_X = W - 64;
  const PLOT_L = 8;
  const PLOT_W = AXIS_X - PLOT_L - 8;

  const cfg = METRICS[metric];

  const { values, minV, maxV, avg } = useMemo(() => {
    const values = days.map((d) => d[metric]);
    if (values.length === 0) return { values, minV: 0, maxV: 1, avg: 0 };
    let minV = Math.min(...values);
    let maxV = Math.max(...values);
    if (minV === maxV) {
      if (minV === 0) { minV = 0; maxV = 1; }
      else { minV = minV * 0.9; maxV = maxV * 1.1; }
    }
    const pad = (maxV - minV) * 0.15;
    minV = Math.max(0, minV - pad);
    maxV += pad;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { values, minV, maxV, avg };
  }, [days, metric]);

  const summary = useMemo(() => {
    if (days.length === 0) return null;
    const total = days.reduce((a, d) => a + (metric === 'tickets' ? d.tickets : metric === 'profit' ? d.profit : d.revenue), 0);
    const best = days.reduce((a, b) => {
      const va = metric === 'tickets' ? a.tickets : metric === 'profit' ? a.profit : a.revenue;
      const vb = metric === 'tickets' ? b.tickets : metric === 'profit' ? b.profit : b.revenue;
      return vb > va ? b : a;
    });
    const bestVal = metric === 'tickets' ? best.tickets : metric === 'profit' ? best.profit : best.revenue;
    const avgDay = total / days.length;
    return { total, best, bestVal, avgDay };
  }, [days, metric]);

  if (days.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-slate-400 text-sm">
        Sin datos de ventas para este período
      </div>
    );
  }

  const y = (v: number) => PLOT_B - ((v - minV) / (maxV - minV)) * PLOT_H;
  const x = (i: number) => (days.length === 1 ? PLOT_L + PLOT_W / 2 : PLOT_L + (PLOT_W * i) / (days.length - 1));

  const linePts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const areaPts = `${x(0)},${PLOT_B} ${linePts} ${x(days.length - 1)},${PLOT_B}`;
  const avgY = y(Math.min(Math.max(avg, minV), maxV));

  const gridVals = [0.08, 0.36, 0.64, 0.9].map((f) => minV + f * (maxV - minV));
  const step = Math.max(1, Math.ceil(days.length / 8));
  const showDots = days.length <= 20;
  const hover = hoverIdx !== null ? days[hoverIdx] : null;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    days.forEach((_, i) => {
      const d = Math.abs(x(i) - mx);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setHoverIdx(mx >= PLOT_L - slotPad() && mx <= AXIS_X + 8 ? best : null);
    function slotPad() { return days.length > 1 ? (PLOT_W / (days.length - 1)) / 2 + 8 : PLOT_W / 2; }
  };

  const gid = `trend-${metric}`;

  return (
    <div>
      {/* Tabs de métrica + resumen */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333] overflow-x-auto no-scrollbar max-w-full" role="group" aria-label="Métrica del gráfico">
          {(Object.keys(METRICS) as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMetric(m); setHoverIdx(null); }}
              aria-pressed={metric === m}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                metric === m
                  ? 'text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
              style={metric === m ? { backgroundColor: METRICS[m].color } : undefined}
            >
              {METRICS[m].label}
            </button>
          ))}
        </div>
        {summary && (
          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 ml-auto">
            <span>Total <strong className="tnum text-slate-800 dark:text-white">{cfg.format(summary.total)}</strong></span>
            <span>Prom/día <strong className="tnum text-slate-800 dark:text-white">{cfg.format(summary.avgDay)}</strong></span>
            <span className="hidden sm:inline">Mejor <strong className="tnum text-slate-800 dark:text-white">{summary.best.label} ({cfg.format(summary.bestVal)})</strong></span>
          </div>
        )}
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        className="overflow-visible select-none block"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label={`Tendencia de ${cfg.label.toLowerCase()} por día`}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cfg.color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PLOT_L} x2={AXIS_X} y1={y(v)} y2={y(v)} stroke="#cbd5e1" strokeOpacity="0.6" strokeWidth="0.75" strokeDasharray="3 3" className="dark:opacity-20" />
            <text x={AXIS_X + 6} y={y(v) + 3} fontSize={9} fill="#64748b" className="dark:fill-slate-500 tnum">
              {cfg.format(v)}
            </text>
          </g>
        ))}

        {/* Promedio del período */}
        <line x1={PLOT_L} x2={AXIS_X} y1={avgY} y2={avgY} stroke={cfg.color} strokeWidth="1" strokeDasharray="6 4" opacity="0.55" />
        <text x={AXIS_X - 2} y={avgY - 5} textAnchor="end" fontSize={8.5} fontWeight="bold" fill={cfg.color} opacity="0.9">
          prom {cfg.format(avg)}
        </text>

        {/* Área + línea */}
        <polygon points={areaPts} fill={`url(#${gid})`} />
        <polyline points={linePts} fill="none" stroke={cfg.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />

        {/* Puntos */}
        {(showDots || hoverIdx !== null) &&
          values.map((v, i) => {
            const isH = hoverIdx === i;
            if (!showDots && !isH) return null;
            return (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r={isH ? 4.5 : 3}
                fill={isH ? cfg.color : '#fff'}
                stroke={cfg.color}
                strokeWidth={isH ? 2 : 2}
                className="dark:fill-[#1F1F1F]"
                opacity={hoverIdx === null || isH ? 1 : 0.55}
              />
            );
          })}

        {/* Crosshair + tooltip */}
        {hover !== null && hoverIdx !== null && (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PLOT_T - 4} y2={PLOT_B} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
            <g>
              <rect
                x={Math.min(Math.max(x(hoverIdx) + 10, PLOT_L), AXIS_X - 158)}
                y={4}
                width={156}
                height={88}
                rx={10}
                fill="#0f172a"
                opacity="0.96"
              />
              <text x={Math.min(Math.max(x(hoverIdx) + 10, PLOT_L), AXIS_X - 158) + 12} y={22} fontSize={11} fontWeight="bold" fill="#fff">
                {hover.label}
              </text>
              <text x={Math.min(Math.max(x(hoverIdx) + 10, PLOT_L), AXIS_X - 158) + 12} y={38} fontSize={10} fill="#7dd3fc" className="tnum">
                Ingresos ${hover.revenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </text>
              <text x={Math.min(Math.max(x(hoverIdx) + 10, PLOT_L), AXIS_X - 158) + 12} y={52} fontSize={10} fill="#c4b5fd" className="tnum">
                Tickets {hover.tickets} · Prom ${hover.avgTicket.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </text>
              <text x={Math.min(Math.max(x(hoverIdx) + 10, PLOT_L), AXIS_X - 158) + 12} y={66} fontSize={10} fill="#6ee7b7" className="tnum">
                Ganancia ${hover.profit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </text>
              <text x={Math.min(Math.max(x(hoverIdx) + 10, PLOT_L), AXIS_X - 158) + 12} y={80} fontSize={9} fill="#94a3b8">
                {`${((hover.profit / Math.max(hover.revenue, 1)) * 100).toFixed(0)}% margen`}
              </text>
            </g>
          </g>
        )}

        {/* Eje X */}
        {days.map((d, i) =>
          i % step === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={8.5} fill="#94a3b8" className="dark:fill-slate-500">
              {d.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
