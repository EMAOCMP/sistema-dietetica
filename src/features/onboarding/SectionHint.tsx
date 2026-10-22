import { useEffect } from 'react';
import { Compass, X, Play } from 'lucide-react';
import { useOnboarding } from './OnboardingProvider';
import { GUIDE_SECTIONS, guideSteps } from './guides';

/**
 * Onboarding contextual: cuando el usuario entra por primera vez a una sección,
 * aparece una tarjeta discreta (no bloqueante) con la opción de ver su guía.
 * Se muestra una sola vez por sección (persistido en localStorage).
 */
export function SectionHint() {
  const { hintSection, dismissHint, markSectionSeen, startTour } = useOnboarding();
  const section = hintSection ? GUIDE_SECTIONS.find((s) => s.id === hintSection) : null;

  useEffect(() => {
    if (!hintSection) return;
    const t = window.setTimeout(() => dismissHint(), 18000);
    return () => window.clearTimeout(t);
  }, [hintSection, dismissHint]);

  if (!section) return null;

  const steps = guideSteps(section.id).length;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-3 right-3 sm:right-auto sm:left-6 bottom-[calc(88px_+_env(safe-area-inset-bottom))] lg:bottom-6 z-[90] sm:max-w-sm animate-row"
    >
      <div className="rounded-2xl bg-white dark:bg-[#1F1F1F] border border-brand-500/30 p-3.5 shadow-[0_20px_50px_-12px_rgba(2,6,23,0.4)]">
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
            <Compass size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-extrabold text-slate-900 dark:text-white">
              Primera vez en {section.title}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
              {section.desc}
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              <button
                type="button"
                onClick={() => { markSectionSeen(section.id); startTour(section.id); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
              >
                <Play size={11} /> Ver guía ({steps} pasos)
              </button>
              <button
                type="button"
                onClick={dismissHint}
                className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
              >
                Ahora no
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissHint}
            aria-label="Cerrar sugerencia"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5 shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
