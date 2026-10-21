import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, ArrowRight, ArrowLeft, Sparkles, Compass } from 'lucide-react';
import { useOnboarding } from './OnboardingProvider';
import { guideSteps, guideTitle, type TourStep } from './guides';

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 10;
const TOOLTIP_W = 330;

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth
    && style.visibility !== 'hidden' && style.display !== 'none';
}

function findVisible(selector: string): Element | null {
  const els = document.querySelectorAll(selector);
  for (const el of Array.from(els)) {
    if (isVisible(el)) return el;
  }
  return null;
}

function readRect(selector: string): Rect | null {
  const el = findVisible(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

interface ProductTourProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
}

/**
 * Product Tour / Coach Marks: overlay oscuro con spotlight sobre el elemento,
 * tarjeta explicativa y navegación automática entre secciones. Los pasos se
 * filtran por dispositivo; si un elemento tarda en montar (vistas lazy), reintenta.
 */
export function ProductTour({ activeTab, onNavigate }: ProductTourProps) {
  const { tourOpen, tourStep, activeGuide, nextStep, prevStep, endTour } = useOnboarding();
  const [rect, setRect] = useState<Rect | null>(null);
  const [failed, setFailed] = useState(false);

  const steps = useMemo<TourStep[]>(() => {
    if (!tourOpen) return [];
    return guideSteps(activeGuide).filter((s) => !!s.view || !!findVisible(s.selector));
  }, [tourOpen, activeGuide]);

  const step = steps[tourStep];
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  // Navegar a la vista del paso actual.
  useEffect(() => {
    if (!tourOpen || !step?.view) return;
    if (activeTab !== step.view) {
      setRect(null);
      onNavigate(step.view);
    }
  }, [tourOpen, step, activeTab, onNavigate]);

  // Medir con reintentos (vistas lazy) y hacer scroll si el elemento está fuera de pantalla.
  useEffect(() => {
    if (!tourOpen || !step) return;
    let cancelled = false;
    let tries = 0;
    let scrolled = false;
    let timer: number | undefined;

    const tick = () => {
      if (cancelled) return;
      const el = findVisible(step.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        const outside = r.top < 88 || r.bottom > window.innerHeight - 96;
        if (outside && !scrolled) {
          scrolled = true;
          try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ }
          timer = window.setTimeout(tick, 340);
          return;
        }
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        setFailed(false);
        return;
      }
      tries += 1;
      if (tries > 22) {
        setFailed(true);
        nextStep();
        return;
      }
      timer = window.setTimeout(tick, 100);
    };

    timer = window.setTimeout(tick, 90);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [tourOpen, step, activeTab, nextStep]);

  const measure = useCallback(() => {
    if (step) setRect(readRect(step.selector));
  }, [step]);

  useEffect(() => {
    if (!tourOpen) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [tourOpen, measure]);

  useEffect(() => {
    if (tourOpen && steps.length > 0 && tourStep >= steps.length) endTour();
  }, [tourOpen, steps, tourStep, endTour]);

  // Teclado: Esc cierra, flechas navegan.
  useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); endTour(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nextStep(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prevStep(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourOpen, endTour, nextStep, prevStep]);

  if (!tourOpen || !step) return null;

  const total = steps.length;
  const isLast = tourStep === total - 1;

  let tipStyle: React.CSSProperties = {};
  if (isMobile) {
    tipStyle = { left: '1rem', right: '1rem', bottom: '1rem', width: 'auto' };
  } else if (rect) {
    const placement = step.placement ?? 'bottom';
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - TOOLTIP_W / 2, window.innerWidth - TOOLTIP_W - 12));
    let top = rect.top + rect.height + 16;
    if (placement === 'top') top = rect.top - 16;
    if (top + 210 > window.innerHeight) top = Math.max(12, rect.top - 210);
    tipStyle = { left, top, width: TOOLTIP_W };
  }

  const spotlight = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  const pct = Math.round(((tourStep + 1) / total) * 100);

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label={`Recorrido: ${guideTitle(activeGuide)}`}>
      <div className="absolute inset-0" onClick={() => (isLast ? endTour() : nextStep())}>
        {spotlight && (
          <div
            className="absolute rounded-2xl transition-all duration-300 pointer-events-none"
            style={{ ...spotlight, boxShadow: '0 0 0 9999px rgba(2,6,23,0.74)' }}
          />
        )}
      </div>

      <div
        className="absolute glass-card rounded-2xl p-4 sm:p-5 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200"
        style={tipStyle}
        role="document"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-brand-500/15 flex items-center justify-center shrink-0">
              {activeGuide === 'inicio' || activeGuide === 'completa'
                ? <Sparkles size={14} className="text-brand-500" />
                : <Compass size={14} className="text-brand-500" />}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-brand-500 dark:text-brand-400 truncate">
                {guideTitle(activeGuide)}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tabular-nums">
                Paso {tourStep + 1} de {total}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={endTour}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5 shrink-0"
            aria-label="Saltar recorrido"
          >
            <X size={16} />
          </button>
        </div>

        <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mt-2.5">{step.title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">{step.body}</p>

        <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-white/10 mt-3.5 overflow-hidden">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        <div className="flex items-center justify-between gap-2 mt-3">
          <button
            type="button"
            onClick={endTour}
            className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            {failed ? 'Continuar' : 'Saltar guía'}
          </button>
          <div className="flex gap-2">
            {tourStep > 0 && (
              <button
                type="button"
                onClick={prevStep}
                className="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 transition cursor-pointer flex items-center gap-1"
              >
                <ArrowLeft size={12} /> Atrás
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? endTour() : nextStep())}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-brand-500 rounded-lg hover:bg-brand-600 transition cursor-pointer flex items-center gap-1 shadow-sm shadow-brand-500/25"
            >
              {isLast ? 'Listo' : 'Siguiente'} <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
