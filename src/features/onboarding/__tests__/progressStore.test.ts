import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Cada test arranca con el módulo limpio (sin estado en memoria acumulado). */
async function loadStore() {
  vi.resetModules();
  return import('../progressStore');
}

describe('progressStore', () => {
  let raw: Map<string, string>;

  beforeEach(() => {
    raw = installMemoryStorage();
  });

  it('devuelve el estado vacío cuando no hay nada guardado', async () => {
    const { loadLocalProgress, EMPTY_PROGRESS } = await loadStore();
    expect(loadLocalProgress()).toEqual(EMPTY_PROGRESS);
  });

  it('guarda y relee el estado', async () => {
    const { loadLocalProgress, saveLocalProgress } = await loadStore();
    const state = {
      tourDone: true,
      chapters: ['pos', 'products'],
      sections: ['pos'],
      tips: ['tip-a'],
      visited: ['history'],
      checklistHidden: false,
    };
    saveLocalProgress(state);
    expect(loadLocalProgress()).toEqual(state);
  });

  it('migra las claves legacy al formato nuevo', async () => {
    raw.set('dv-tour-done-v1', '1');
    raw.set('dv-chapter-done-pos', '1');
    raw.set('dv-chapter-done-products', '1');
    raw.set('dv-section-seen-products', '1');
    raw.set('dv-tip-mp-warning', '1');
    raw.set('dv-visited-history', '1');
    raw.set('dv-onboarding-hidden', '1');

    const { loadLocalProgress } = await loadStore();
    const p = loadLocalProgress();

    expect(p.tourDone).toBe(true);
    expect(p.chapters.sort()).toEqual(['pos', 'products']);
    expect(p.sections).toEqual(['products']);
    expect(p.tips).toEqual(['mp-warning']);
    expect(p.visited).toEqual(['history']);
    expect(p.checklistHidden).toBe(true);

    // El estado queda persistido en la clave nueva.
    expect(raw.get('dv-onboarding-progress-v1')).toBeTruthy();
  });

  it('mergeProgress une arrays y hace OR de los booleanos', async () => {
    const { mergeProgress } = await loadStore();
    const merged = mergeProgress(
      { tourDone: false, chapters: ['pos'], sections: [], tips: ['a'], visited: ['history'], checklistHidden: false },
      { tourDone: true, chapters: ['pos', 'products'], sections: ['pos'], tips: ['a', 'b'], visited: [], checklistHidden: true },
    );

    expect(merged.tourDone).toBe(true);
    expect(merged.chapters.sort()).toEqual(['pos', 'products']);
    expect(merged.sections).toEqual(['pos']);
    expect(merged.tips.sort()).toEqual(['a', 'b']);
    expect(merged.visited).toEqual(['history']);
    expect(merged.checklistHidden).toBe(true);
  });

  it('clearLocalProgress borra el estado nuevo y las claves legacy', async () => {
    raw.set('dv-onboarding-progress-v1', '{}');
    raw.set('dv-tour-done-v1', '1');
    raw.set('dv-chapter-done-pos', '1');
    raw.set('dv-visited-history', '1');

    const { clearLocalProgress, loadLocalProgress, EMPTY_PROGRESS } = await loadStore();
    clearLocalProgress();

    expect(raw.has('dv-onboarding-progress-v1')).toBe(false);
    expect(raw.has('dv-tour-done-v1')).toBe(false);
    expect(raw.has('dv-chapter-done-pos')).toBe(false);
    expect(raw.has('dv-visited-history')).toBe(false);
    expect(loadLocalProgress()).toEqual(EMPTY_PROGRESS);
  });

  it('funciona aunque localStorage esté bloqueado (modo privado)', async () => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
        removeItem: () => { throw new Error('blocked'); },
        clear: () => { throw new Error('blocked'); },
        key: () => { throw new Error('blocked'); },
        length: 0,
      },
      configurable: true,
      writable: true,
    });

    const { loadLocalProgress, saveLocalProgress } = await loadStore();
    saveLocalProgress({
      tourDone: true,
      chapters: ['pos'],
      sections: [],
      tips: [],
      visited: [],
      checklistHidden: false,
    });

    const p = loadLocalProgress();
    expect(p.tourDone).toBe(true);
    expect(p.chapters).toEqual(['pos']);
  });

  it('ignora valores corruptos y vuelve al estado vacío', async () => {
    raw.set('dv-onboarding-progress-v1', '{no-json');

    const { loadLocalProgress, EMPTY_PROGRESS } = await loadStore();
    expect(loadLocalProgress()).toEqual(EMPTY_PROGRESS);
  });
});
