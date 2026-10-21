import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { useOnboarding } from './OnboardingProvider';

interface ContextualTooltipProps {
  /** Clave única en localStorage. La primera vez muestra el tooltip. */
  tipKey: string;
  title: string;
  children: ReactNode;
  /** Texto o ícono del disparador. Default: ícono de info. */
  trigger?: ReactNode;
  className?: string;
}

/**
 * Contextual Onboarding: burbuja de ayuda que aparece la primera vez que el
 * usuario toca el disparador. Persiste "visto" en localStorage por clave.
 */
export function ContextualTooltip({ tipKey, title, children, trigger, className = '' }: ContextualTooltipProps) {
  const { hasSeenTip, markTipSeen } = useOnboarding();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const show = () => {
    setOpen(true);
    markTipSeen(tipKey);
  };

  return (
    <div className={`relative inline-flex ${className}`} ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); hasSeenTip(tipKey) ? setOpen((o) => !o) : show(); }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-slate-400 hover:text-brand-500 hover:bg-brand-500/10 transition cursor-pointer"
        title={title}
        aria-label={title}
      >
        {trigger || <Info size={13} />}
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-56 sm:w-64 glass-card rounded-2xl p-3.5 shadow-2xl origin-top animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-extrabold text-slate-900 dark:text-white leading-tight">{title}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              aria-label="Cerrar"
            >
              <X size={13} />
            </button>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">{children}</div>
        </div>
      )}
    </div>
  );
}