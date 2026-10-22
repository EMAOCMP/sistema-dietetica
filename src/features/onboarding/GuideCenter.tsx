import { useState } from 'react';
import {
  Compass, Sparkles, Play, CheckCircle2, ChevronDown, ChevronRight, RotateCcw,
  LayoutDashboard, ShoppingCart, Package, PackagePlus, History,
  Wallet, BarChart3, Users, Settings, BookOpen, Clock,
} from 'lucide-react';
import { ModalShell } from '../../components/ui/ModalShell';
import { useOnboarding } from './OnboardingProvider';
import { GUIDE_SECTIONS, guideSteps, type GuideSection } from './guides';

const ICONS: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  products: Package,
  intake: PackagePlus,
  history: History,
  cashclose: Wallet,
  reports: BarChart3,
  users: Users,
  settings: Settings,
};

function ProgressRing({ pct }: { pct: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
        <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="4" className="stroke-slate-200 dark:stroke-white/10" />
        <circle
          cx="22" cy="22" r={radius} fill="none" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (circumference * pct) / 100}
          className="stroke-brand-500 transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] sm:text-xs font-black text-slate-900 dark:text-white tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

function SectionRow({ section, done, onStart }: { section: GuideSection; done: boolean; onStart: () => void }) {
  const Icon = ICONS[section.id] ?? BookOpen;
  const steps = guideSteps(section.id).length;
  return (
    <button
      type="button"
      onClick={onStart}
      className={`group relative flex items-start gap-3 w-full rounded-2xl border p-3 sm:p-3.5 text-left transition cursor-pointer active:scale-[0.99] ${
        done
          ? 'border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 hover:border-emerald-500/50'
          : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-brand-400/70 hover:bg-brand-50/70 dark:hover:bg-brand-500/10'
      }`}
    >
      <span className={`mt-0.5 w-9 h-9 rounded-xl grid place-items-center shrink-0 ${
        done
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
      }`}>
        <Icon size={17} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-1.5">
          <span className="text-[13px] font-bold text-slate-900 dark:text-white leading-snug">{section.title}</span>
          {done && <CheckCircle2 size={13} className="mt-0.5 text-emerald-500 shrink-0" aria-label="Completada" />}
        </span>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5 line-clamp-2">
          {section.desc}
        </span>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-white/5 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
          <Clock size={10} />
          {steps} {steps === 1 ? 'paso' : 'pasos'} · {section.minutes} min
        </span>
      </span>

      <span className="mt-0.5 shrink-0 w-7 h-7 grid place-items-center rounded-full text-slate-300 dark:text-slate-500 group-hover:bg-brand-500 group-hover:text-white transition-colors">
        <ChevronRight size={15} />
      </span>
    </button>
  );
}

/**
 * Centro de guías: índice de todas las secciones con progreso persistente.
 * Aplica divulgación progresiva: lo avanzado arranca colapsado.
 */
export function GuideCenter() {
  const { guideOpen } = useOnboarding();
  if (!guideOpen) return null;
  return <GuideCenterContent />;
}

function GuideCenterContent() {
  const { closeGuide, startTour, isChapterDone, resetProgress } = useOnboarding();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const basic = GUIDE_SECTIONS.filter((s) => s.level !== 'avanzado');
  const advanced = GUIDE_SECTIONS.filter((s) => s.level === 'avanzado');
  const doneCount = GUIDE_SECTIONS.filter((s) => isChapterDone(s.id)).length;
  const basicDone = basic.filter((s) => isChapterDone(s.id)).length;
  const advancedDone = advanced.filter((s) => isChapterDone(s.id)).length;
  const pct = Math.round((doneCount / GUIDE_SECTIONS.length) * 100);
  const totalMinutes = GUIDE_SECTIONS.reduce((acc, s) => acc + s.minutes, 0);

  return (
    <ModalShell
      onClose={closeGuide}
      icon={<span className="w-9 h-9 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center"><Compass size={18} /></span>}
      title="Centro de guías"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          {confirmReset ? (
            <div className="flex items-center gap-1.5 text-[11px] min-w-0">
              <span className="font-semibold text-slate-500 dark:text-slate-400 truncate">¿Borrar progreso?</span>
              <button
                type="button"
                onClick={() => { resetProgress(); setConfirmReset(false); setShowAdvanced(false); }}
                className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 font-bold hover:bg-red-500/20 transition cursor-pointer"
              >
                Sí
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-200 dark:hover:bg-white/15 transition cursor-pointer"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
            >
              <RotateCcw size={12} /> Reiniciar progreso
            </button>
          )}
          <button
            type="button"
            onClick={closeGuide}
            className="px-5 h-10 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer transition shrink-0"
          >
            Cerrar
          </button>
        </div>
      }
    >
      <div className="space-y-5 pb-1">
        {/* Encabezado con progreso */}
        <section className="relative overflow-hidden rounded-2xl border border-brand-500/20 bg-gradient-to-br from-brand-500/10 via-brand-500/5 to-transparent p-4 sm:p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 w-32 h-32 rounded-full bg-brand-500/10 blur-2xl" />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Sparkles size={15} className="text-brand-500 shrink-0" /> Aprendé la app paso a paso
              </p>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {GUIDE_SECTIONS.length} guías cortas · ~{totalMinutes} min en total. El progreso se guarda solo.
              </p>
              <p className="mt-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {doneCount} de {GUIDE_SECTIONS.length} completadas
              </p>
            </div>
            <ProgressRing pct={pct} />
          </div>

          <div className="relative mt-3.5 w-full h-1.5 rounded-full bg-white/70 dark:bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>

          <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
            <button
              type="button"
              onClick={() => startTour('inicio')}
              className="inline-flex items-center justify-center gap-1.5 h-11 px-4 bg-brand-500 hover:bg-brand-600 active:scale-[0.99] text-white rounded-xl text-xs font-bold shadow-lg shadow-brand-500/20 transition cursor-pointer"
            >
              <Play size={13} /> Primeros pasos
            </button>
            <button
              type="button"
              onClick={() => startTour('completa')}
              className="inline-flex items-center justify-center gap-1.5 h-11 px-4 bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold hover:border-brand-400 dark:hover:border-brand-500/60 active:scale-[0.99] transition cursor-pointer"
            >
              <Compass size={13} /> Recorrido completo
            </button>
          </div>
        </section>

        {/* Guías esenciales */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
            <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              Lo esencial
            </h3>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tabular-nums">
              {basicDone}/{basic.length}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {basic.map((s) => (
              <SectionRow key={s.id} section={s} done={isChapterDone(s.id)} onStart={() => startTour(s.id)} />
            ))}
          </div>
        </section>

        {/* Nivel avanzado colapsable */}
        <section className="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            aria-controls="guide-advanced"
            className="w-full flex items-center gap-2.5 px-3 py-3 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
          >
            <span className="w-7 h-7 rounded-lg bg-slate-200/70 dark:bg-white/10 text-slate-500 dark:text-slate-300 grid place-items-center shrink-0">
              <BookOpen size={14} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[12px] font-bold text-slate-700 dark:text-slate-200">Nivel avanzado</span>
              <span className="block text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                {advanced.length} guías · {advancedDone}/{advanced.length} completadas
              </span>
            </span>
            <ChevronDown
              size={16}
              className={`shrink-0 text-slate-400 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>
          {showAdvanced && (
            <div id="guide-advanced" className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-white dark:bg-transparent">
              {advanced.map((s) => (
                <SectionRow key={s.id} section={s} done={isChapterDone(s.id)} onStart={() => startTour(s.id)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </ModalShell>
  );
}
