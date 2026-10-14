import { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

interface DatePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  onClose: () => void;
  maxDate?: Date;
}

export function DatePicker({ startDate, endDate, onChange, onClose, maxDate }: DatePickerProps) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = startDate ? new Date(startDate + 'T00:00:00') : new Date();
    return { month: d.getMonth(), year: d.getFullYear() };
  });
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
  const [openMonth, setOpenMonth] = useState(false);
  const [openYear, setOpenYear] = useState(false);
  const [openPreset, setOpenPreset] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxD = maxDate ? new Date(maxDate) : null;
  if (maxD) maxD.setHours(0, 0, 0, 0);

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  useEffect(() => {
    if (startDate) {
      const d = new Date(startDate + 'T00:00:00');
      setViewMonth({ month: d.getMonth(), year: d.getFullYear() });
    }
  }, [startDate]);

  const daysInMonth = useMemo(() => {
    const firstDay = new Date(viewMonth.year, viewMonth.month, 1);
    const lastDay = new Date(viewMonth.year, viewMonth.month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days = [];

    for (let i = 0; i < startOffset; i++) days.push({ date: null, isPrevMonth: true });
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(viewMonth.year, viewMonth.month, d);
      date.setHours(0, 0, 0, 0);
      days.push({ date, isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const date = new Date(viewMonth.year, viewMonth.month + 1, i);
      date.setHours(0, 0, 0, 0);
      days.push({ date, isNextMonth: true });
    }
    return days;
  }, [viewMonth.month, viewMonth.year]);

  const isSelected = (date: Date) => {
    if (!startDate) return false;
    const d = new Date(startDate + 'T00:00:00');
    return d.getTime() === date.getTime();
  };

  const isEndSelected = (date: Date) => {
    if (!endDate) return false;
    const d = new Date(endDate + 'T00:00:00');
    return d.getTime() === date.getTime();
  };

  const isInRange = (date: Date) => {
    if (!startDate || !endDate) return false;
    const s = new Date(startDate + 'T00:00:00').getTime();
    const e = new Date(endDate + 'T00:00:00').getTime();
    const t = date.getTime();
    return t > s && t < e;
  };

  const isDisabled = (date: Date) => {
    if (maxD && date > maxD) return true;
    return false;
  };

  const formatISO = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const handleDayClick = (date: Date) => {
    if (isDisabled(date)) return;
    if (!startDate || (startDate && endDate)) {
      onChange(formatISO(date), '');
    } else {
      const s = new Date(startDate + 'T00:00:00');
      if (date < s) {
        onChange(formatISO(date), startDate);
      } else {
        onChange(startDate, formatISO(date));
      }
    }
  };

  const goPrevMonth = () => setViewMonth(v => ({ ...v, month: v.month === 0 ? 11 : v.month - 1, year: v.month === 0 ? v.year - 1 : v.year }));
  const goNextMonth = () => setViewMonth(v => ({ ...v, month: v.month === 11 ? 0 : v.month + 1, year: v.month === 11 ? v.year + 1 : v.year }));

  const selectWholeMonth = () => {
    const first = new Date(viewMonth.year, viewMonth.month, 1);
    const last = new Date(viewMonth.year, viewMonth.month + 1, 0);
    if (last > today) {
      onChange(formatISO(first), formatISO(today));
    } else {
      onChange(formatISO(first), formatISO(last));
    }
  };

  const selectWholeYear = () => {
    const first = new Date(viewMonth.year, 0, 1);
    const last = new Date(viewMonth.year, 11, 31);
    if (last > today) {
      onChange(formatISO(first), formatISO(today));
    } else {
      onChange(formatISO(first), formatISO(last));
    }
  };

  const presets = [
    { label: 'Hoy', start: today, end: today },
    { label: 'Ayer', start: new Date(today.getTime() - 86400000), end: new Date(today.getTime() - 86400000) },
    { label: 'Últimos 7 días', start: new Date(today.getTime() - 6 * 86400000), end: today },
    { label: 'Últimos 30 días', start: new Date(today.getTime() - 29 * 86400000), end: today },
    { label: 'Este mes', start: new Date(today.getFullYear(), today.getMonth(), 1), end: today },
    { label: 'Mes pasado', start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: new Date(today.getFullYear(), today.getMonth(), 0) },
    { label: 'Este año', start: new Date(today.getFullYear(), 0, 1), end: today },
  ];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMonth(false);
        setOpenYear(false);
        setOpenPreset(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const rangeLabel = startDate
    ? endDate
      ? `${new Date(startDate + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} → ${new Date(endDate + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`
      : `${new Date(startDate + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} → …`
    : 'Elegí un rango';

  return (
    <div className="bg-white dark:bg-[#1F1F1F] rounded-2xl shadow-xl border border-slate-200 dark:border-[#333333] p-4 w-80" role="dialog" aria-label="Seleccionar rango de fechas" ref={containerRef}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{rangeLabel}</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => { setOpenPreset(!openPreset); setOpenMonth(false); setOpenYear(false); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-sky-100 dark:hover:bg-sky-500/20 hover:text-sky-700 dark:hover:text-sky-300 transition"
            aria-haspopup="listbox"
            aria-expanded={openPreset}
          >
            <Calendar size={13} />
            Rápido
            <ChevronRight size={13} className={`text-slate-400 transition-transform ${openPreset ? 'rotate-90' : ''}`} />
          </button>
          {openPreset && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-[#1F1F1F] rounded-xl shadow-xl border border-slate-200 dark:border-[#333333] p-1 w-44 origin-top-right animate-in fade-in-0 zoom-in-95 duration-150"
                 role="listbox" aria-label="Rangos rápidos">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { onChange(formatISO(p.start), formatISO(p.end)); setOpenPreset(false); }}
                  className="w-full px-3 py-1.5 text-xs font-medium text-left rounded-lg text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-500/10 hover:text-sky-700 dark:hover:text-sky-300 transition"
                  role="option"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition" aria-label="Mes anterior">
            <ChevronLeft size={18} className="text-slate-600 dark:text-slate-300" />
          </button>
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setOpenMonth(!openMonth); setOpenYear(false); }}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition min-w-[110px] text-left"
              aria-haspopup="listbox"
              aria-expanded={openMonth}
            >
              {monthNames[viewMonth.month]}
              <ChevronRight size={14} className={`text-slate-400 transition-transform ${openMonth ? 'rotate-90' : ''}`} />
            </button>
            {openMonth && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-[#1F1F1F] rounded-xl shadow-xl border border-slate-200 dark:border-[#333333] p-1 w-44 origin-top animate-in fade-in-0 zoom-in-95 duration-150"
                   role="listbox" aria-label="Seleccionar mes">
                {monthNames.map((m, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setViewMonth(v => ({ ...v, month: i }));
                      setOpenMonth(false);
                      const first = new Date(viewMonth.year, i, 1);
                      const last = new Date(viewMonth.year, i + 1, 0);
                      const end = last > today ? today : last;
                      onChange(formatISO(first), formatISO(end));
                    }}
                    className={`w-full px-3 py-1.5 text-xs font-medium text-left rounded-lg transition ${viewMonth.month === i ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                    role="option"
                    aria-selected={viewMonth.month === i}
                  >
                    {m}
                  </button>
                ))}
                <div className="border-t border-slate-100 dark:border-[#333333] mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => { selectWholeMonth(); setOpenMonth(false); }}
                    className="w-full px-3 py-1.5 text-xs font-bold text-left rounded-lg text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition"
                  >
                    Todo el mes
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => { setOpenYear(!openYear); setOpenMonth(false); }}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition min-w-[64px] text-left"
              aria-haspopup="listbox"
              aria-expanded={openYear}
            >
              {viewMonth.year}
              <ChevronRight size={14} className={`text-slate-400 transition-transform ${openYear ? 'rotate-90' : ''}`} />
            </button>
            {openYear && (
              <div className="absolute left-[120px] top-full mt-1 z-50 bg-white dark:bg-[#1F1F1F] rounded-xl shadow-xl border border-slate-200 dark:border-[#333333] p-1 w-36 origin-top animate-in fade-in-0 zoom-in-95 duration-150 max-h-60 overflow-auto"
                   role="listbox" aria-label="Seleccionar año">
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i).map(y => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => {
                      setViewMonth(v => ({ ...v, year: y }));
                      setOpenYear(false);
                      const first = new Date(y, 0, 1);
                      const last = new Date(y, 11, 31);
                      const end = last > today ? today : last;
                      onChange(formatISO(first), formatISO(end));
                    }}
                    className={`w-full px-3 py-1.5 text-xs font-medium text-left rounded-lg transition ${viewMonth.year === y ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                    role="option"
                    aria-selected={viewMonth.year === y}
                  >
                    {y}
                  </button>
                ))}
                <div className="border-t border-slate-100 dark:border-[#333333] mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => { selectWholeYear(); setOpenYear(false); }}
                    className="w-full px-3 py-1.5 text-xs font-bold text-left rounded-lg text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition"
                  >
                    Todo el año
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={goNextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition" aria-label="Mes siguiente">
            <ChevronRight size={18} className="text-slate-600 dark:text-slate-300" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-2">
        {dayNames.map(d => <div key={d} className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 py-1">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {daysInMonth.map((day, i) => {
          if (!day.date) return <div key={i} className="aspect-square" />;
          const date = day.date;
          const selected = isSelected(date);
          const endSelected = isEndSelected(date);
          const inRange = isInRange(date);
          const disabled = isDisabled(date);
          const isToday = date.getTime() === today.getTime();
          const hovered = hoveredDate && date.getTime() === hoveredDate.getTime();

          return (
            <button
              key={i}
              type="button"
              onClick={() => handleDayClick(date)}
              onMouseEnter={() => setHoveredDate(date)}
              onMouseLeave={() => setHoveredDate(null)}
              disabled={disabled}
              className={`
                relative aspect-square rounded-xl text-sm font-medium transition-all duration-150
                ${disabled ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'cursor-pointer'}
                ${selected || endSelected ? 'bg-sky-600 text-white font-bold' : ''}
                ${inRange ? 'bg-sky-100 dark:bg-sky-900/30' : ''}
                ${isToday && !selected && !endSelected && !inRange ? 'ring-2 ring-sky-500 dark:ring-sky-400' : ''}
                ${hovered && !disabled && !selected && !endSelected && !inRange ? 'bg-slate-100 dark:bg-white/5' : ''}
                ${day.isPrevMonth || day.isNextMonth ? 'text-slate-300 dark:text-slate-600' : 'text-slate-800 dark:text-white'}
              `}
              aria-label={date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
              aria-selected={selected || endSelected}
              aria-disabled={disabled}
            >
              {date.getDate()}
              {isToday && !selected && !endSelected && !inRange && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-sky-500" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-[#333333]">
        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <Calendar size={12} />
          {startDate && !endDate ? 'Seleccioná fecha fin' : 'Seleccioná fecha inicio'}
        </div>
        <div className="flex gap-2">
          <button onClick={() => { onChange('', ''); }} className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition">Limpiar</button>
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-bold text-white bg-sky-600 rounded-xl hover:bg-sky-700 transition">Listo</button>
        </div>
      </div>
    </div>
  );
}