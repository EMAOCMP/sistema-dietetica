import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS, TOUR_STEPS, guideSteps } from '../guides';

/**
 * Integridad del recorrido: cada paso debe apuntar a un `data-tour` que exista
 * de verdad en algún componente. Si alguien renombra o borra el ancla, el tour
 * se salta el paso en silencio; este test lo hace fallar antes.
 */
const sources = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const allSources = Object.values(sources).join('\n');

function selectorValue(selector: string): string | null {
  const match = selector.match(/^\[data-tour="([^"]+)"\]$/);
  return match?.[1] ?? null;
}

describe('guides', () => {
  it('todos los pasos tienen título, texto y selector válido', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length).toBeGreaterThan(0);
      expect(selectorValue(step.selector)).not.toBeNull();
    }
  });

  it('no hay selectores de tour duplicados', () => {
    const selectors = TOUR_STEPS.map((s) => s.selector);
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it('cada selector existe como data-tour en la app', () => {
    for (const step of TOUR_STEPS) {
      const value = selectorValue(step.selector);
      expect(allSources, `Falta data-tour="${value}" para el paso "${step.title}"`)
        .toContain(`data-tour="${value}"`);
    }
  });

  it('cada sección del centro de guías tiene al menos un paso', () => {
    for (const section of GUIDE_SECTIONS) {
      expect(guideSteps(section.id).length, `La sección "${section.id}" no tiene pasos`)
        .toBeGreaterThan(0);
    }
  });

  it('las guías globales no quedan vacías', () => {
    expect(guideSteps('inicio').length).toBeGreaterThan(0);
    expect(guideSteps('completa').length).toBe(TOUR_STEPS.length);
  });
});
