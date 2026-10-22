/**
 * Estado de onboarding persistido.
 *
 * Dos capas:
 *  - localStorage: caché local inmediata + fuente de verdad offline.
 *  - Supabase (`user_onboarding_progress`): misma forma de datos, por cuenta.
 *
 * La nube nunca reemplaza al local: se hace merge por unión (un progreso hecho
 * en un dispositivo no se pierde si otro device no lo tenía).
 */

/** Estado completo del onboarding de un usuario. */
export interface OnboardingProgress {
  /** El tour inicial ("Primeros pasos") o el recorrido completo ya terminó. */
  tourDone: boolean;
  /** Guías por sección completadas (ids de `GUIDE_SECTIONS`). */
  chapters: string[];
  /** Secciones cuyo aviso contextual ya se mostró. */
  sections: string[];
  /** Micro-tooltips contextuales ya vistos (por `tipKey`). */
  tips: string[];
  /** Secciones visitadas al menos una vez (alimenta el checklist del dashboard). */
  visited: string[];
  /** El checklist de inicio del dashboard fue ocultado a mano. */
  checklistHidden: boolean;
}

export const EMPTY_PROGRESS: OnboardingProgress = {
  tourDone: false,
  chapters: [],
  sections: [],
  tips: [],
  visited: [],
  checklistHidden: false,
};

const STORAGE_KEY = 'dv-onboarding-progress-v1';

/* ── Claves legacy (pre-Store) ──────────────────────────────────────── */
const LEGACY_TOUR_KEY = 'dv-tour-done-v1';
const LEGACY_CHAPTER_PREFIX = 'dv-chapter-done-';
const LEGACY_SECTION_PREFIX = 'dv-section-seen-';
const LEGACY_TIP_PREFIX = 'dv-tip-';
const LEGACY_VISITED_PREFIX = 'dv-visited-';
const LEGACY_HIDDEN_KEY = 'dv-onboarding-hidden';

const LEGACY_PREFIXES = [
  LEGACY_CHAPTER_PREFIX,
  LEGACY_SECTION_PREFIX,
  LEGACY_TIP_PREFIX,
  LEGACY_VISITED_PREFIX,
];

/**
 * Fallback en memoria para modo privado / storage bloqueado.
 * Evita que el tour se reinicie en cada recarga cuando localStorage falla.
 */
const memoryFallback = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v === undefined ? null : v;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function storageSet(key: string, value: string): void {
  memoryFallback.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* modo privado: queda solo en memoria */
  }
}

function storageRemove(key: string): void {
  memoryFallback.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

function storageKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
  } catch {
    /* noop */
  }
  return keys;
}

/* ── Utilidades ─────────────────────────────────────────────────────── */

function unique(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value) : [];
}

function normalize(raw: unknown): OnboardingProgress {
  const p = (raw ?? {}) as Partial<OnboardingProgress>;
  return {
    tourDone: p.tourDone === true,
    chapters: asStringArray(p.chapters),
    sections: asStringArray(p.sections),
    tips: asStringArray(p.tips),
    visited: asStringArray(p.visited),
    checklistHidden: p.checklistHidden === true,
  };
}

/**
 * Une dos estados. Los booleanos son OR y los arrays son unión: el progreso
 * nunca se pierde, sin importar de dónde venga cada parte.
 */
export function mergeProgress(a: OnboardingProgress, b: OnboardingProgress): OnboardingProgress {
  return {
    tourDone: a.tourDone || b.tourDone,
    chapters: unique([...a.chapters, ...b.chapters]),
    sections: unique([...a.sections, ...b.sections]),
    tips: unique([...a.tips, ...b.tips]),
    visited: unique([...a.visited, ...b.visited]),
    checklistHidden: a.checklistHidden || b.checklistHidden,
  };
}

/* ── Migración desde las claves legacy ──────────────────────────────── */

/**
 * Reconstruye el estado a partir de las claves sueltas que usaba la
 * versión anterior (`dv-tour-done-v1`, `dv-chapter-done-*`, etc.).
 */
function migrateLegacy(): OnboardingProgress {
  const keys = storageKeys();
  const chapters: string[] = [];
  const sections: string[] = [];
  const tips: string[] = [];
  const visited: string[] = [];

  for (const key of keys) {
    if (key.startsWith(LEGACY_CHAPTER_PREFIX)) chapters.push(key.slice(LEGACY_CHAPTER_PREFIX.length));
    else if (key.startsWith(LEGACY_SECTION_PREFIX)) sections.push(key.slice(LEGACY_SECTION_PREFIX.length));
    else if (key.startsWith(LEGACY_TIP_PREFIX)) tips.push(key.slice(LEGACY_TIP_PREFIX.length));
    else if (key.startsWith(LEGACY_VISITED_PREFIX)) visited.push(key.slice(LEGACY_VISITED_PREFIX.length));
  }

  // El fallback en memoria también puede tener claves legacy (modo privado).
  for (const key of memoryFallback.keys()) {
    if (key.startsWith(LEGACY_CHAPTER_PREFIX)) chapters.push(key.slice(LEGACY_CHAPTER_PREFIX.length));
    else if (key.startsWith(LEGACY_SECTION_PREFIX)) sections.push(key.slice(LEGACY_SECTION_PREFIX.length));
    else if (key.startsWith(LEGACY_TIP_PREFIX)) tips.push(key.slice(LEGACY_TIP_PREFIX.length));
    else if (key.startsWith(LEGACY_VISITED_PREFIX)) visited.push(key.slice(LEGACY_VISITED_PREFIX.length));
  }

  return normalize({
    tourDone: storageGet(LEGACY_TOUR_KEY) === '1',
    chapters,
    sections,
    tips,
    visited,
    checklistHidden: storageGet(LEGACY_HIDDEN_KEY) === '1',
  });
}

/* ── API pública ────────────────────────────────────────────────────── */

/** Lee el progreso local. Migra las claves legacy la primera vez. */
export function loadLocalProgress(): OnboardingProgress {
  const raw = storageGet(STORAGE_KEY);
  if (raw) {
    try {
      return normalize(JSON.parse(raw));
    } catch {
      /* JSON roto: se reconstruye desde legacy */
    }
  }
  const migrated = migrateLegacy();
  saveLocalProgress(migrated);
  return migrated;
}

/** Guarda el progreso local. */
export function saveLocalProgress(progress: OnboardingProgress): void {
  storageSet(STORAGE_KEY, JSON.stringify(progress));
}

/** Borra el progreso local, incluidas las claves legacy. */
export function clearLocalProgress(): void {
  storageRemove(STORAGE_KEY);
  storageRemove(LEGACY_TOUR_KEY);
  storageRemove(LEGACY_HIDDEN_KEY);
  for (const key of storageKeys()) {
    if (LEGACY_PREFIXES.some((p) => key.startsWith(p))) storageRemove(key);
  }
  for (const key of Array.from(memoryFallback.keys())) {
    if (key === STORAGE_KEY || key === LEGACY_TOUR_KEY || key === LEGACY_HIDDEN_KEY) {
      memoryFallback.delete(key);
    } else if (LEGACY_PREFIXES.some((p) => key.startsWith(p))) {
      memoryFallback.delete(key);
    }
  }
}
