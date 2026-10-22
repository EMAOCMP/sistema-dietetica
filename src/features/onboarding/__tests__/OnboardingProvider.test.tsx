import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { fetchRemoteProgress, pushRemoteProgress } = vi.hoisted(() => ({
  fetchRemoteProgress: vi.fn(),
  pushRemoteProgress: vi.fn(),
}));

vi.mock('../../../lib/onboardingProgress', () => ({
  fetchRemoteProgress,
  pushRemoteProgress,
}));

function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
  return map;
}

async function setup(userId: string | null = null) {
  const mod = await import('../OnboardingProvider');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <mod.OnboardingProvider userId={userId}>{children}</mod.OnboardingProvider>
  );
  const view = renderHook(() => mod.useOnboarding(), { wrapper });
  return { ...mod, view };
}

describe('OnboardingProvider', () => {
  let raw: Map<string, string>;

  beforeEach(() => {
    raw = installMemoryStorage();
    fetchRemoteProgress.mockReset().mockResolvedValue(null);
    pushRemoteProgress.mockReset().mockResolvedValue(true);
  });

  it('marca la guía de sección como completada al terminar el tour', async () => {
    const { view } = await setup();

    act(() => { view.result.current.startTour('pos'); });
    expect(view.result.current.tourOpen).toBe(true);

    act(() => { view.result.current.endTour(); });

    expect(view.result.current.isChapterDone('pos')).toBe(true);
    expect(view.result.current.hasSeenSection('pos')).toBe(true);
    expect(view.result.current.tourOpen).toBe(false);
  });

  it('marca el tour inicial como hecho al terminarlo', async () => {
    const { view } = await setup();

    act(() => { view.result.current.startTour('inicio'); });
    act(() => { view.result.current.endTour(); });

    expect(view.result.current.isChapterDone('inicio')).toBe(false);
    expect(raw.get('dv-onboarding-progress-v1')).toContain('"tourDone":true');
  });

  it('el aviso contextual aparece una sola vez por sección', async () => {
    const { view } = await setup();

    act(() => { view.result.current.requestSectionHint('products'); });
    expect(view.result.current.hintSection).toBe('products');

    act(() => { view.result.current.dismissHint(); });
    expect(view.result.current.hintSection).toBe(null);

    act(() => { view.result.current.requestSectionHint('products'); });
    expect(view.result.current.hintSection).toBe(null);
  });

  it('reiniciar el progreso borra todo local', async () => {
    const { view } = await setup();

    act(() => { view.result.current.startTour('pos'); });
    act(() => { view.result.current.endTour(); });
    act(() => { view.result.current.markTipSeen('tip-a'); });
    act(() => { view.result.current.hideChecklist(); });

    expect(view.result.current.isChapterDone('pos')).toBe(true);

    act(() => { view.result.current.resetProgress(); });

    expect(view.result.current.isChapterDone('pos')).toBe(false);
    expect(view.result.current.hasSeenTip('tip-a')).toBe(false);
    expect(view.result.current.isChecklistHidden()).toBe(false);
  });

  it('combina el progreso remoto con el local al cargar', async () => {
    fetchRemoteProgress.mockResolvedValue({
      tourDone: true,
      chapters: ['reports'],
      sections: ['reports'],
      tips: [],
      visited: ['reports'],
      checklistHidden: false,
    });

    const { view } = await setup('user-1');

    await waitFor(() => expect(view.result.current.ready).toBe(true));

    expect(view.result.current.isChapterDone('reports')).toBe(true);
    expect(view.result.current.isChapterDone('pos')).toBe(false);
    expect(fetchRemoteProgress).toHaveBeenCalledWith('user-1');
  });

  it('sube el progreso a la nube cuando hay usuario', async () => {
    const { view } = await setup('user-1');

    await waitFor(() => expect(view.result.current.ready).toBe(true));

    act(() => { view.result.current.startTour('pos'); });
    act(() => { view.result.current.endTour(); });

    await waitFor(() => {
      const calls = pushRemoteProgress.mock.calls.filter(([, p]) => (p as any).chapters.includes('pos'));
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('no sube nada a la nube si no hay usuario', async () => {
    const { view } = await setup(null);

    act(() => { view.result.current.startTour('pos'); });
    act(() => { view.result.current.endTour(); });

    await waitFor(() => expect(view.result.current.isChapterDone('pos')).toBe(true));
    expect(pushRemoteProgress).not.toHaveBeenCalled();
  });
});
