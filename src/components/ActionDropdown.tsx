import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export interface ActionItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
}

interface ActionDropdownProps {
  label?: string;
  items: ActionItem[];
  onSelect: (key: string) => void;
  menuAlign?: 'left' | 'right';
}

/**
 * Menú Acciones por fila — estilo pill Campify Dark x Premium SaaS.
 * Usa Portal para escapar stacking context de tablas/modales.
 */
export function ActionDropdown({ label, items, onSelect, menuAlign = 'right' }: ActionDropdownProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = Math.min(items.length * 48 + 12, 360);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const w = 256;
    let left = menuAlign === 'left' ? rect.left : rect.right - w;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = openUp ? rect.top - menuHeight - 6 : rect.bottom + 6;
    top = Math.max(8, Math.min(top, window.innerHeight - 8));
    setMenuPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = (e: Event) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const menu = open ? createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
      <div
        ref={menuRef}
        className="fixed z-[9999] w-64 min-w-[220px] max-h-[min(380px,52vh)] overflow-y-auto overscroll-contain bg-white dark:bg-obsidian-800/95 dark:backdrop-blur-xl rounded-2xl border border-[#e2e8f0] dark:border-white/10 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)] p-1.5 space-y-1 animate-row"
        style={{ top: menuPos.top, left: menuPos.left }}
      >
        {items.map((item, idx) => (
          <button
            key={item.key}
            type="button"
            onClick={() => { onSelect(item.key); setOpen(false); }}
            style={{ animationDelay: `${idx * 20}ms` }}
            className={`animate-row group w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-xl text-[14px] font-semibold tracking-tight cursor-pointer transition-all duration-150 active:scale-[0.97] ${
              item.danger
                ? 'text-slate-700 dark:text-zinc-300 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400'
                : 'text-slate-700 dark:text-zinc-300 hover:bg-[#eef6ff] dark:hover:bg-white/5 hover:text-[#0284c7] dark:hover:text-white hover:pl-3.5'
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${item.danger ? 'bg-red-400' : 'bg-brand-500'}`} />
            {item.icon && <span className={`shrink-0 ${item.danger ? 'text-slate-400 group-hover:text-red-500' : 'text-slate-400 group-hover:text-brand-400'}`}>{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-obsidian-800 border border-[#e2e8f0] dark:border-white/10 text-slate-600 dark:text-zinc-300 rounded-xl text-xs font-bold shadow-sm hover:border-slate-300 dark:hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer ${open ? 'border-brand-500 ring-2 ring-brand-500/20' : ''}`}
      >
        {label || 'Acciones'}
        <CaretDown size={12} weight="bold" className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
}