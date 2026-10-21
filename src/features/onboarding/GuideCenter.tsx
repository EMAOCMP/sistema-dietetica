import { useState } from 'react';
import {
  Compass, Sparkles, Play, CheckCircle2, ChevronDown, RotateCcw,
  LayoutDashboard, ShoppingCart, Package, PackagePlus, History,
  Wallet, BarChart3, Users, Settings, BookOpen,
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

function SectionRow({ section, done, onStart }: { section: GuideSection; done: boolean; onStart: () => void }) {
  const Icon = ICONS[section.id] ?? BookOpen;
  const steps = guideSteps(section.id).length;
  return (
    <button
      type="button"
      onClick={onStart}
      className="group w-full flex items-center gap-3 p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-brand-400 dark:hover:border-brand-500/60 hover:bg-brand-50/60 dark:hover:bg-brand-500/10 transition text-left cursor-pointer"
    >
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-brand-500/10 text-brand-600 dark:text-brand-400'}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-bold text-slate-900 dark:text-white truncate">{section.title}</span>
          {done && <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />}
        </span>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">{section.desc}</span>
        <span className="block text-[10px] font-semibold text-slate-400 dark:text-slate-500 mt-1">
          {steps} {steps === 1 ? 'paso' : 'pasos'} · ~{section.minutes} min
        </span>
      </span>
      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 dark:text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity">
        <Play size={11} /> Ver
      </span>
    </button>
  );
}

/**
 * Centro de guías: índice de todas las secciones con progreso persistente.
 * Aplica divulgación progresiva: lo avanzado arranca colapsado.
 */
export function GuideCenter() {
  const { guideOpen, closeGuide, startTour, isChapterDone, resetProgress } = useOnboarding();
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!guideOpen) return null;

  const basic = GUIDE_SECTIONS.filter((s) => s.level !== 'avanzado');
  const advanced = GUIDE_SECTIONS.filter((s) => s.level === 'avanzado');
  const doneCount = GUIDE_SECTIONS.filter((s) => isChapterDone(s.id)).length;
  const pct = Math.round((doneCount / GUIDE_SECTIONS.length) * 100);

  return (
    <ModalShell
      onClose={closeGuide}
      icon={<span className="w-9 h-9 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center"><Compass size={18} /></span>}
      title="Centro de guías"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <button
            type="button"
            onClick={() => { resetProgress(); setShowAdvanced(false); }}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <RotateCcw size={12} /> Reiniciar progreso
          </button>
          <button
            type="button"
            onClick={closeGuide}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer transition"
          >
            Cerrar
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-brand-500/25 bg-gradient-to-br from-brand-500/10 to-transparent p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Sparkles size={15} className="text-brand-500" /> Aprendé la app en minutos
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Elegí una sección o hacé el recorrido completo. El progreso se guarda solo.
              </p>
            </div>
            <span className="text-lg font-black text-brand-600 dark:text-brand-400 tabular-nums shrink-0">{pct}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/60 dark:bg-white/10 overflow-hidden mt-3">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              onClick={() => startTour('inicio')}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-[11px] font-bold transition cursor-pointer"
            >
              <Play size={12} /> Primeros pasos
            </button>
            <button
              type="button"
              onClick={() => startTour('completa')}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-xl text-[11px] font-bold transition cursor-pointer hover:border-brand-400"
            >
              <Compass size={12} /> Recorrido completo
            </button>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
            Lo esencial
          </p>
          <div className="space-y-2">
            {basic.map((s) => (
              <SectionRow key={s.id} section={s} done={isChapterDone(s.id)} onStart={() => startTour(s.id)} />
            ))}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="w-full flex items-center justify-between gap-2 px-1 py-2 cursor-pointer"
          >
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              Nivel avanzado · {advanced.length} guías
            </span>
            <ChevronDown size={15} className={`text-slate-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          {showAdvanced && (
            <div className="space-y-2 mt-1">
              {advanced.map((s) => (
                <SectionRow key={s.id} section={s} done={isChapterDone(s.id)} onStart={() => startTour(s.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
