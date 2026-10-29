import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowRight, ArrowLeft, Check, Sparkles, Compass } from 'lucide-react';
import { useOnboarding } from './OnboardingProvider';
import { guideSteps, guideTitle, type TourStep } from './guides';
import { computeTipBox, type TipPlacement } from './tipPosition';

interface Rect { top: number; left: number; width: number; height: number; radius?: string }

const PAD = 8;
const TIP_WIDTH = 340;
const CARET = 12;
/** Borde visible del halo índigo alrededor del elemento resaltado. */
const RING = '0 0 0 2px rgba(99,102,241,0.95), 0 0 0 7px rgba(99,102,241,0.22)';
const SCRIM = '0 0 0 9999px rgba(2,6,23,0.68)';

const CARET_BORDER: Record<TipPlacement, string> = {
  bottom: 'border-t border-l',
  top: 'border-b border-r',
  right: 'border-l border-b',
  left: 'border-t border-r',
};

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
  return rectOf(el);
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    radius: window.getComputedStyle(el).borderRadius || undefined,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  const [tipPos, setTipPos] = useState<{ left: number; top: number; side: TipPlacement } | null>(null);
  const [tipSize, setTipSize] = useState<{ w: number; h: number } | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640,
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const steps = useMemo<TourStep[]>(() => {
    if (!tourOpen) return [];
    return guideSteps(activeGuide).filter((s) => !!s.view || !!findVisible(s.selector));
  }, [tourOpen, activeGuide]);

  const step = steps[tourStep];
  const total = steps.length;
  const isLast = tourStep === total - 1;

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
        setRect(rectOf(el));
        return;
      }
      tries += 1;
      if (tries > 22) {
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
      const el = cardRef.current;
      if (!el || !step) return;
      const w = el.offsetWidth || TIP_WIDTH;
      const h = el.offsetHeight || 200;
      const box = computeTipBox(rect, step.placement ?? 'bottom', w, h, window.innerWidth, window.innerHeight);
      setTipSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      setTipPos((prev) =>
        prev && prev.left === box.left && prev.top === box.top && prev.side === box.side ? prev : box,
      );
    };
    place();
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tourOpen, rect, step, isMobile]);

  const measure = useCallback(() => {
    setIsMobile(window.innerWidth < 640);
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

  // Bloquear el scroll de la página mientras el recorrido está abierto.
  useEffect(() => {
    if (!tourOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [tourOpen]);

  // Foco accesible: al abrir guardamos el foco y lo devolvemos al cerrar.
  useEffect(() => {
    if (!tourOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    restoreFocusRef.current = previous;
    return () => { previous?.focus?.({ preventScroll: true }); };
  }, [tourOpen]);

  useEffect(() => {
    if (!tourOpen) return;
    cardRef.current?.focus({ preventScroll: true });
  }, [tourOpen, tourStep]);

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

  const tipStyle: React.CSSProperties = isMobile
    ? { left: '12px', right: '12px', bottom: 'calc(12px + env(safe-area-inset-bottom))', width: 'auto' }
    : {
        left: tipPos?.left ?? 0,
        top: tipPos?.top ?? 76,
        width: TIP_WIDTH,
        opacity: tipPos ? 1 : 0,
      };

  const spotlight = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;
  // Flecha que conecta la tarjeta con el elemento resaltado.
  let caret: { className: string; style: React.CSSProperties } | null = null;
  if (!isMobile && tipPos && tipSize && rect) {
    const side = tipPos.side;
    const targetCx = rect.left + rect.width / 2;
    const targetCy = rect.top + rect.height / 2;
    const edge = -CARET / 2;
    const limitH = tipSize.w - CARET - 12;
    const limitV = tipSize.h - CARET - 12;
    const style: React.CSSProperties =
      side === 'right' || side === 'left'
        ? { top: clamp(targetCy - tipPos.top - CARET / 2, 14, limitV) }
        : { left: clamp(targetCx - tipPos.left - CARET / 2, 14, limitH) };
    if (side === 'right') style.left = edge;
    if (side === 'left') style.right = edge;
    if (side === 'bottom') style.top = edge;
    if (side === 'top') style.bottom = edge;
    caret = { className: CARET_BORDER[side], style };
  }

  const isGlobal = activeGuide === 'inicio' || activeGuide === 'completa';

  return (
    <div
      className="fixed inset-0 z-[300]"
      role="dialog"
      aria-modal="true"
      aria-label={`Recorrido: ${guideTitle(activeGuide)}`}
      aria-labelledby="tour-step-title"
      aria-describedby="tour-step-body"
    >
      <div className="absolute inset-0" onClick={() => (isLast ? endTour() : nextStep())}>
        {spotlight && (
          <div
            className="absolute pointer-events-none transition-all duration-300"
            style={{ ...spotlight, borderRadius: rect?.radius ?? '16px', boxShadow: `${RING}, ${SCRIM}` }}
          />
        )}
      </div>

      <div
        ref={cardRef}
        tabIndex={-1}
        className="tour-card absolute rounded-2xl p-4 sm:p-5 outline-none"
        style={tipStyle}
      >
        {caret && <span aria-hidden="true" className={`tour-caret ${caret.className}`} style={caret.style} />}

        {isMobile && (
          <div className="sm:hidden mx-auto -mt-1 mb-2.5 h-1 w-9 rounded-full bg-slate-300 dark:bg-white/20" />
        )}

        <div key={tourStep} className="tour-step-in">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400 grid place-items-center shrink-0">
                {isGlobal ? <Sparkles size={16} /> : <Compass size={16} />}
              </span>
              <span className="min-w-0 block">
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400 truncate">
                  {guideTitle(activeGuide)}
                </span>
                <span className="block text-[11px] font-medium text-slate-400 dark:text-slate-500 tabular-nums">
                  Paso {tourStep + 1} de {total}
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={endTour}
              aria-label="Cerrar recorrido"
              className="-mr-1 -mt-1 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          <h3
            id="tour-step-title"
            className="text-[15px] font-semibold text-slate-900 dark:text-white mt-3.5 leading-snug tracking-[-0.01em]"
          >
            {step.title}
          </h3>
          <p
            id="tour-step-body"
            aria-live="polite"
            className="text-[13px] text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed"
          >
            {step.body}
          </p>
        </div>

        {/* Progreso segmentado: un tramo por paso. */}
        <div className="flex items-center gap-1 mt-4" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= tourStep ? 'bg-brand-500' : 'bg-slate-200 dark:bg-white/10'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 mt-4">
          <button
            type="button"
            onClick={endTour}
            className="px-1.5 py-1 -ml-1.5 rounded-md text-[11px] font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
          >
            {isLast ? 'Cerrar' : 'Saltar guía'}
          </button>
          <div className="flex items-center gap-2">
            {tourStep > 0 && (
              <button
                type="button"
                onClick={prevStep}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 transition cursor-pointer flex items-center gap-1"
              >
                <ArrowLeft size={12} /> Atrás
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? endTour() : nextStep())}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 transition cursor-pointer flex items-center gap-1 rounded-lg shadow-sm shadow-brand-500/25"
            >
              {isLast ? 'Finalizar' : 'Siguiente'}
              {isLast ? <Check size={13} /> : <ArrowRight size={13} />}
            </button>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 mt-3 text-[10px] text-slate-400 dark:text-slate-500">
          <kbd className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-sans">←</kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-sans">→</kbd>
          <span>navegar</span>
          <span className="mx-0.5 opacity-40">·</span>
          <kbd className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-sans">Esc</kbd>
          <span>salir</span>
        </div>
      </div>
    </div>
  );
}
