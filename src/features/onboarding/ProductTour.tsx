import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowRight, ArrowLeft, Sparkles, Compass } from 'lucide-react';
import { useOnboarding } from './OnboardingProvider';
import { guideSteps, guideTitle, type TourStep } from './guides';
import { computeTipBox } from './tipPosition';

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 8;
const TIP_WIDTH = 340;

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
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const tipRef = useRef<HTMLDivElement | null>(null);

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

  // Posicionar la tarjeta: mide su tamaño real y la deja al costado del objetivo.
  useEffect(() => {
    if (!tourOpen || !rect || isMobile) return;
    const place = () => {
      const el = tipRef.current;
      if (!el || !step) return;
      const box = computeTipBox(
        rect,
        step.placement ?? 'bottom',
        el.offsetWidth || TIP_WIDTH,
        el.offsetHeight || 200,
        window.innerWidth,
        window.innerHeight,
      );
      setTipPos((prev) => (prev && prev.left === box.left && prev.top === box.top ? prev : box));
    };
    place();
    const el = tipRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tourOpen, rect, step, isMobile]);

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

  const tipStyle: React.CSSProperties = isMobile
    ? { left: '12px', right: '12px', bottom: '12px', width: 'auto' }
    : {
        left: tipPos?.left ?? 0,
        top: tipPos?.top ?? 76,
        width: TIP_WIDTH,
        opacity: tipPos ? 1 : 0,
      };

  const spotlight = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  const pct = Math.round(((tourStep + 1) / total) * 100);
  const isGlobal = activeGuide === 'inicio' || activeGuide === 'completa';

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label={`Recorrido: ${guideTitle(activeGuide)}`}>
      <div className="absolute inset-0" onClick={() => (isLast ? endTour() : nextStep())}>
        {spotlight && (
          <div
            className="absolute rounded-2xl transition-all duration-300 pointer-events-none"
            style={{
              ...spotlight,
              boxShadow:
                '0 0 0 2px rgba(99,102,241,0.95), 0 0 0 7px rgba(99,102,241,0.22), 0 0 0 9999px rgba(2,6,23,0.74)',
            }}
          />
        )}
      </div>

      <div
        ref={tipRef}
        className="absolute rounded-2xl bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333] shadow-[0_20px_50px_-12px_rgba(2,6,23,0.45)] p-4 sm:p-5 animate-in fade-in-0 zoom-in-95 duration-200"
        style={tipStyle}
        role="document"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400 grid place-items-center shrink-0">
              {isGlobal ? <Sparkles size={15} /> : <Compass size={15} />}
            </span>
            <span className="min-w-0 block">
              <span className="block text-[10px] font-extrabold uppercase tracking-widest text-brand-600 dark:text-brand-400 truncate">
                {guideTitle(activeGuide)}
              </span>
              <span className="block text-[10px] font-semibold text-slate-400 dark:text-slate-500 tabular-nums">
                Paso {tourStep + 1} de {total}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={endTour}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5 shrink-0 -mt-0.5 -mr-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-white/10 transition"
            aria-label="Saltar recorrido"
          >
            <X size={15} />
          </button>
        </div>

        <div aria-live="polite">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mt-3 leading-snug">{step.title}</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">{step.body}</p>
        </div>

        <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-white/10 mt-4 overflow-hidden">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        <div className="flex items-center justify-between gap-2 mt-4">
          <button
            type="button"
            onClick={endTour}
            className="text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
          >
            {failed ? 'Continuar' : 'Saltar guía'}
          </button>
          <div className="flex items-center gap-2">
            {tourStep > 0 && (
              <button
                type="button"
                onClick={prevStep}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/10 rounded-lg hover:bg-slate-200 dark:hover:bg-white/15 transition cursor-pointer flex items-center gap-1"
              >
                <ArrowLeft size={12} /> Atrás
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? endTour() : nextStep())}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 transition cursor-pointer flex items-center gap-1 rounded-lg shadow-sm shadow-brand-500/30"
            >
              {isLast ? 'Listo' : 'Siguiente'} <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
