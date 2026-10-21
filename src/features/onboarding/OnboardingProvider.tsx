import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GuideId } from './guides';
import { GUIDE_SECTIONS } from './guides';

const TOUR_KEY = 'dv-tour-done-v1';
const TIP_PREFIX = 'dv-tip-';
const SECTION_PREFIX = 'dv-section-seen-';
const CHAPTER_PREFIX = 'dv-chapter-done-';

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function writeFlag(key: string, value = true) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* noop */ }
}

interface OnboardingContextValue {
  tourOpen: boolean;
  tourStep: number;
  activeGuide: GuideId;
  guideOpen: boolean;
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
  hasSeenTip: (key: string) => boolean;
  markTipSeen: (key: string) => void;
  resetProgress: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [activeGuide, setActiveGuide] = useState<GuideId>('inicio');
  const [guideOpen, setGuideOpen] = useState(false);
  const [hintSection, setHintSection] = useState<string | null>(null);

  const [tipsSeen, setTipsSeen] = useState<Record<string, boolean>>(() => {
    const seen: Record<string, boolean> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(TIP_PREFIX)) seen[k.slice(TIP_PREFIX.length)] = readFlag(k);
      }
    } catch { /* noop */ }
    return seen;
  });

  const [completedChapters, setCompletedChapters] = useState<Record<string, boolean>>(() => {
    const done: Record<string, boolean> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CHAPTER_PREFIX)) done[k.slice(CHAPTER_PREFIX.length)] = readFlag(k);
      }
    } catch { /* noop */ }
    return done;
  });

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
      writeFlag(TOUR_KEY);
    } else {
      writeFlag(CHAPTER_PREFIX + activeGuide);
      writeFlag(SECTION_PREFIX + activeGuide);
      setCompletedChapters((prev) => ({ ...prev, [activeGuide]: true }));
    }
  }, [activeGuide]);

  const nextStep = useCallback(() => setTourStep((s) => s + 1), []);
  const prevStep = useCallback(() => setTourStep((s) => Math.max(0, s - 1)), []);

  const openGuide = useCallback(() => { setGuideOpen(true); setHintSection(null); }, []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  const hasSeenSection = useCallback((id: string) => readFlag(SECTION_PREFIX + id), []);

  const markSectionSeen = useCallback((id: string) => {
    writeFlag(SECTION_PREFIX + id);
  }, []);

  const requestSectionHint = useCallback((id: string) => {
    if (!GUIDE_SECTIONS.some((s) => s.id === id)) return;
    if (tourOpen || guideOpen) return;
    if (readFlag(SECTION_PREFIX + id)) return;
    setHintSection((current) => current ?? id);
  }, [tourOpen, guideOpen]);

  const dismissHint = useCallback(() => {
    if (hintSection) writeFlag(SECTION_PREFIX + hintSection);
    setHintSection(null);
  }, [hintSection]);

  const isChapterDone = useCallback((id: string) => !!completedChapters[id], [completedChapters]);
  const markChapterDone = useCallback((id: string) => {
    writeFlag(CHAPTER_PREFIX + id);
    setCompletedChapters((prev) => ({ ...prev, [id]: true }));
  }, []);

  const hasSeenTip = useCallback((key: string) => !!tipsSeen[key], [tipsSeen]);
  const markTipSeen = useCallback((key: string) => {
    setTipsSeen((prev) => ({ ...prev, [key]: true }));
    writeFlag(TIP_PREFIX + key);
  }, []);

  const resetProgress = useCallback(() => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(TIP_PREFIX) || k.startsWith(SECTION_PREFIX) || k.startsWith(CHAPTER_PREFIX))) {
          keys.push(k);
        }
      }
      keys.forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem(TOUR_KEY);
    } catch { /* noop */ }
    setTipsSeen({});
    setCompletedChapters({});
    setHintSection(null);
  }, []);

  // El hint contextual no debe tapar el tour ni el centro de guías.
  useEffect(() => {
    if (tourOpen || guideOpen) setHintSection(null);
  }, [tourOpen, guideOpen]);

  const value = useMemo<OnboardingContextValue>(() => ({
    tourOpen, tourStep, activeGuide, guideOpen, openGuide, closeGuide,
    startTour, endTour, nextStep, prevStep,
    completedChapters, isChapterDone, markChapterDone,
    hintSection, requestSectionHint, dismissHint, hasSeenSection, markSectionSeen,
    hasSeenTip, markTipSeen, resetProgress,
  }), [
    tourOpen, tourStep, activeGuide, guideOpen, openGuide, closeGuide,
    startTour, endTour, nextStep, prevStep,
    completedChapters, isChapterDone, markChapterDone,
    hintSection, requestSectionHint, dismissHint, hasSeenSection, markSectionSeen,
    hasSeenTip, markTipSeen, resetProgress,
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
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return true; }
}
