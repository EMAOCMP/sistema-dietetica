import { describe, expect, it } from 'vitest';
import { isScaleCode, parseScaleCode } from '../scaleParser';

describe('scaleParser', () => {
  it('detecta códigos de balanza (prefijo 2x)', () => {
    expect(isScaleCode('2000123012505')).toBe(true);
    expect(isScaleCode('2100001005001')).toBe(true);
    expect(isScaleCode('7791234567890')).toBe(false);
    expect(isScaleCode('123')).toBe(false);
    expect(isScaleCode('')).toBe(false);
  });

  it('parsea PLU + peso en gramos → kg', () => {
    const s = parseScaleCode('2000123012505');
    expect(s).not.toBeNull();
    expect(s!.prefix).toBe('20');
    expect(s!.plu).toBe('00123');
    expect(s!.valueRaw).toBe('01250');
    expect(s!.weightKg).toBeCloseTo(1.25, 3);
    expect(s!.check).toBe('5');
  });

  it('devuelve null si no es código de balanza', () => {
    expect(parseScaleCode('7791234567890')).toBeNull();
    expect(parseScaleCode('abc')).toBeNull();
  });
});
