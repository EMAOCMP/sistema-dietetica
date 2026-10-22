import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GuideId } from './guides';
import { GUIDE_SECTIONS } from './guides';
import {
  EMPTY_PROGRESS,
  clearLocalProgress,
  loadLocalProgress,
  mergeProgress,
  saveLocalProgress,
  type OnboardingProgress,
} from './progressStore';
import { fetchRemoteProgress, pushRemoteProgress } from '../../lib/onboardingProgress';

interface OnboardingContextValue {
  tourOpen: boolean;
  tourStep: number;
  activeGuide: GuideId;
  guideOpen: boolean;
  /** true cuando el estado local ya se combinó con el de la nube. */
  ready: boolean;
  openGuide: () => void;
  closeGuide: () => void;
  startTour: (guideId?: GuideId) => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  completedChapters: Record<string, boolean>;
  isChapterDone: (id: string) => boolean;
  markChapterDone: (id: string) => void;
  hintSection: string | null;
  requestSectionHint: (id: string) => void;
  dismissHint: () => void;
  hasSeenSection: (id: string) => boolean;
  markSectionSeen: (id: string) => void;
  hasVisitedSection: (id: string) => boolean;
  markSectionVisited: (id: string) => void;
  hasSeenTip: (key: string) => boolean;
  markTipSeen: (key: string) => void;
  isChecklistHidden: () => boolean;
  hideChecklist: () => void;
  resetProgress: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

interface OnboardingProviderProps {
  /** Id del usuario autenticado. Si falta, el progreso queda solo en el dispositivo. */
  userId?: string | null;
  children: ReactNode;
}

function toRecord(ids: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = true;
  return out;
}

/** Agrega un id a una lista sin mutarla (devuelve la misma si ya estaba). */
function addTo(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id];
}

export function OnboardingProvider({ userId, children }: OnboardingProviderProps) {
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [activeGuide, setActiveGuide] = useState<GuideId>('inicio');
  const [guideOpen, setGuideOpen] = useState(false);
  const [hintSection, setHintSection] = useState<string | null>(null);

  // Estado canónico: una sola fuente de verdad, replicada a local + nube.
  const [progress, setProgress] = useState<OnboardingProgress>(() => loadLocalProgress());
  const progressRef = useRef(progress);
  const [hydrated, setHydrated] = useState(false);
  /** El próximo push a la nube debe sobrescribir en vez de unir. */
  const resetPendingRef = useRef(false);

  useEffect(() => { progressRef.current = progress; }, [progress]);

  // Espejo local: se escribe apenas cambia el estado (cache + cola offline).
  useEffect(() => { saveLocalProgress(progress); }, [progress]);

  /**
   * Aplica un cambio al progreso. Si el estado no cambia realmente, devuelve
   * el mismo objeto: evita re-renders y pushes innecesarios a la nube.
   */
  const mutate = useCallback((fn: (p: OnboardingProgress) => OnboardingProgress) => {
    setProgress((prev) => {
      const next = fn(prev);
      return next === prev ? prev : next;
    });
  }, []);

  /* ── Hidratación desde la nube ─────────────────────────────────────── */
  useEffect(() => {
    if (!userId) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const remote = await fetchRemoteProgress(userId);
      if (cancelled) return;
      if (remote) {
        setProgress((prev) => {
          const merged = mergeProgress(prev, remote);
          return merged === prev ? prev : merged;
        });
      }
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  /* ── Push a la nube ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!userId || !hydrated) return;
    const isReset = resetPendingRef.current;
    void pushRemoteProgress(userId, progress, isReset).then((ok) => {
      if (ok) resetPendingRef.current = false;
    });
  }, [userId, hydrated, progress]);

  // Si estaba offline, reintenta al volver la conexión.
  useEffect(() => {
    if (!userId) return;
    const onOnline = () => { void pushRemoteProgress(userId, progressRef.current); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [userId]);

  const startTour = useCallback((guideId: GuideId = 'inicio') => {
    setActiveGuide(guideId);
    setTourStep(0);
    setGuideOpen(false);
    setHintSection(null);
    setTourOpen(true);
  }, []);

  const endTour = useCallback(() => {
    setTourOpen(false);
    setTourStep(0);
    if (activeGuide === 'inicio' || activeGuide === 'completa') {
      mutate((p) => (p.tourDone ? p : { ...p, tourDone: true }));
    } else {
      mutate((p) => {
        const chapters = addTo(p.chapters, activeGuide);
        const sections = addTo(p.sections, activeGuide);
        if (chapters === p.chapters && sections === p.sections) return p;
        return { ...p, chapters, sections };
      });
    }
  }, [activeGuide, mutate]);

  const nextStep = useCallback(() => setTourStep((s) => s + 1), []);
  const prevStep = useCallback(() => setTourStep((s) => Math.max(0, s - 1)), []);

  const openGuide = useCallback(() => { setGuideOpen(true); setHintSection(null); }, []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  const hasSeenSection = useCallback((id: string) => progress.sections.includes(id), [progress.sections]);

  const markSectionSeen = useCallback((id: string) => {
    mutate((p) => (p.sections.includes(id) ? p : { ...p, sections: addTo(p.sections, id) }));
  }, [mutate]);

  const hasVisitedSection = useCallback((id: string) => progress.visited.includes(id), [progress.visited]);

  const markSectionVisited = useCallback((id: string) => {
    mutate((p) => (p.visited.includes(id) ? p : { ...p, visited: addTo(p.visited, id) }));
  }, [mutate]);

  const requestSectionHint = useCallback((id: string) => {
    if (!GUIDE_SECTIONS.some((s) => s.id === id)) return;
    if (tourOpen || guideOpen) return;
    if (progressRef.current.sections.includes(id)) return;
    setHintSection((current) => current ?? id);
  }, [tourOpen, guideOpen]);

  const dismissHint = useCallback(() => {
    const id = hintSection;
    setHintSection(null);
    if (!id) return;
    mutate((p) => (p.sections.includes(id) ? p : { ...p, sections: addTo(p.sections, id) }));
  }, [hintSection, mutate]);

  const isChapterDone = useCallback((id: string) => progress.chapters.includes(id), [progress.chapters]);

  const markChapterDone = useCallback((id: string) => {
    mutate((p) => (p.chapters.includes(id) ? p : { ...p, chapters: addTo(p.chapters, id) }));
  }, [mutate]);

  const hasSeenTip = useCallback((key: string) => progress.tips.includes(key), [progress.tips]);

  const markTipSeen = useCallback((key: string) => {
    mutate((p) => (p.tips.includes(key) ? p : { ...p, tips: addTo(p.tips, key) }));
  }, [mutate]);

  const isChecklistHidden = useCallback(() => progress.checklistHidden, [progress.checklistHidden]);

  const hideChecklist = useCallback(() => {
    mutate((p) => (p.checklistHidden ? p : { ...p, checklistHidden: true }));
  }, [mutate]);

  const resetProgress = useCallback(() => {
    clearLocalProgress();
    resetPendingRef.current = true;
    setProgress({ ...EMPTY_PROGRESS });
    setHintSection(null);
  }, []);

  // El hint contextual no debe tapar el tour ni el centro de guías.
  useEffect(() => {
    if (tourOpen || guideOpen) setHintSection(null);
  }, [tourOpen, guideOpen]);

  const completedChapters = useMemo(() => toRecord(progress.chapters), [progress.chapters]);

  const value = useMemo<OnboardingContextValue>(() => ({
    tourOpen, tourStep, activeGuide, guideOpen, ready: hydrated, openGuide, closeGuide,
    startTour, endTour, nextStep, prevStep,
    completedChapters, isChapterDone, markChapterDone,
    hintSection, requestSectionHint, dismissHint, hasSeenSection, markSectionSeen,
    hasVisitedSection, markSectionVisited,
    hasSeenTip, markTipSeen,
    isChecklistHidden, hideChecklist,
    resetProgress,
  }), [
    tourOpen, tourStep, activeGuide, guideOpen, hydrated, openGuide, closeGuide,
    startTour, endTour, nextStep, prevStep,
    completedChapters, isChapterDone, markChapterDone,
    hintSection, requestSectionHint, dismissHint, hasSeenSection, markSectionSeen,
    hasVisitedSection, markSectionVisited,
    hasSeenTip, markTipSeen,
    isChecklistHidden, hideChecklist,
    resetProgress,
  ]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding debe usarse dentro de <OnboardingProvider>');
  return ctx;
}

/** Helper: true si el tour ya se completó (o se saltó). */
export function hasCompletedTour(): boolean {
  return loadLocalProgress().tourDone;
}
