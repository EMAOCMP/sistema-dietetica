import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuOption {
  value: string | number;
  label: string;
}

interface SelectMenuProps {
  value: string | number;
  options: SelectMenuOption[];
  onChange: (value: string | number) => void;
  ariaLabel?: string;
  /** Ancho del panel desplegable (clase Tailwind, p.ej. 'w-40'). */
  width?: string;
  /** 'right' alinea el panel con el borde derecho del botón. */
  align?: 'left' | 'right';
  /** Botón ocupa el 100% del contenedor (para grillas con label). */
  fullWidth?: boolean;
}

/**
 * Menú desplegable propio (listbox) con el mismo estilo visual que los
 * dropdowns del DatePicker: panel flotante animado, modo oscuro y check
 * en la opción seleccionada. Reemplaza a los <select> nativos.
 */
export function SelectMenu({ value, options, onChange, ariaLabel, width = 'w-44', align = 'left', fullWidth }: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className={fullWidth ? 'relative' : 'relative inline-block'}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex items-center gap-1.5 px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-xs font-bold bg-white dark:bg-[#232323] text-slate-900 dark:text-white cursor-pointer hover:border-slate-300 dark:hover:border-[#444444] transition ${fullWidth ? 'w-full justify-between' : ''}`}
      >
        <span className="truncate">{current?.label ?? String(value)}</span>
        <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute z-50 mt-1 ${width} ${align === 'right' ? 'right-0' : 'left-0'} bg-white dark:bg-[#1F1F1F] rounded-xl shadow-xl border border-slate-200 dark:border-[#333333] p-1 max-h-60 overflow-auto animate-in fade-in-0 zoom-in-95 duration-150 ${fullWidth ? 'w-full left-0' : ''}`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium text-left rounded-lg transition ${
                o.value === value
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 font-bold'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
