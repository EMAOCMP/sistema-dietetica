import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown } from '@phosphor-icons/react';

export interface RoundedOption {
  value: string;
  label: string;
}

interface RoundedSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: RoundedOption[];
  size?: 'md' | 'sm';
  menuAlign?: 'left' | 'right';
}

/**
 * Desplegable propio estilo Campify Dark x Premium SaaS.
 * Menú renderizado via Portal en document.body para que no se corte
 * con overflow ni stacking context de modales (backdrop-filter, etc).
 */
export function RoundedSelect({ value, onChange, options, size = 'md', menuAlign = 'left' }: RoundedSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 170 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value) || options[0];
  const btnPad = size === 'sm' ? 'px-2.5 py-2 text-xs' : 'px-3 py-2.5 text-sm';
  const CAP = 380;

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const rowH = size === 'sm' ? 38 : 46;
    const need = Math.min(options.length * rowH + 16, CAP);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < need && spaceAbove > spaceBelow;
    const w = Math.max(rect.width, 170);
    // clamp horizontal para que no se salga de pantalla
    let left = menuAlign === 'right' ? rect.right - w : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    // clamp vertical
    let top = openUp ? rect.top - need - 4 : rect.bottom + 4;
    top = Math.max(8, Math.min(top, window.innerHeight - 8));
    setMenuPos({ top, left, width: w });
  }, [open, options.length, size, menuAlign]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      // si el scroll viene del menú mismo, no cerrar
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const menu = open ? createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
      <div
        ref={menuRef}
        className="fixed z-[9999] min-w-[170px] max-h-[min(380px,52vh)] overflow-y-auto overscroll-contain bg-white dark:bg-obsidian-800/95 dark:backdrop-blur-xl rounded-2xl border border-[#e2e8f0] dark:border-white/10 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)] p-1.5 space-y-1 animate-row scrollbar-thin"
        style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
      >
        {options.map((opt, idx) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{ animationDelay: `${idx * 20}ms` }}
              className={`animate-row group w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-xl text-[14px] font-semibold tracking-tight cursor-pointer transition-all duration-150 active:scale-[0.97] ${active ? 'bg-brand-500 text-white shadow-md shadow-brand-500/30' : 'text-slate-600 dark:text-zinc-300 hover:bg-[#eef6ff] dark:hover:bg-white/5 hover:text-[#0284c7] dark:hover:text-white hover:pl-4'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${active ? 'bg-white scale-100' : 'bg-slate-300 scale-75 group-hover:bg-brand-500 group-hover:scale-110'}`} />
              <span className="flex-1 truncate">{opt.label}</span>
              {active && <span className="text-white text-sm font-black leading-none">✓</span>}
            </button>
          );
        })}
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className="relative w-full">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 border-2 rounded-2xl font-bold bg-white transition cursor-pointer dark:bg-obsidian-800 dark:text-white ${btnPad} ${open ? 'border-brand-500' : 'border-[#e2e8f0] hover:border-slate-300 dark:border-white/10'}`}
      >
        <span className="truncate text-slate-800 dark:text-white">{selected?.label}</span>
        <CaretDown size={14} weight="bold" className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
}