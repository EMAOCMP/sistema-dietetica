import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hoursOf,
  isValidTime,
  formatHour,
  loadMetaSchedule,
  saveMetaSchedule,
  META_DEFAULT_OPEN,
  META_DEFAULT_CLOSE,
} from '../metaSchedule';

// El setup global mockea localStorage con vi.fn(); conectamos un store real de prueba.
const store: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.mocked(localStorage.getItem).mockImplementation((k: string) => (k in store ? store[k] : null));
  vi.mocked(localStorage.setItem).mockImplementation((k: string, v: string) => { store[k] = String(v); });
});

describe('hoursOf', () => {
  it('convierte HH:MM a horas decimales', () => {
    expect(hoursOf('08:00')).toBe(8);
    expect(hoursOf('21:30')).toBe(21.5);
    expect(hoursOf('8:05')).toBeCloseTo(8 + 5 / 60);
    expect(hoursOf('00:00')).toBe(0);
  });
  it('rechaza entradas inválidas', () => {
    expect(Number.isNaN(hoursOf('abc'))).toBe(true);
    expect(Number.isNaN(hoursOf(''))).toBe(true);
    expect(Number.isNaN(hoursOf('24:00'))).toBe(true);
    expect(Number.isNaN(hoursOf('10:60'))).toBe(true);
    expect(Number.isNaN(hoursOf('10:75'))).toBe(true);
    expect(Number.isNaN(hoursOf('10'))).toBe(true);
  });
});

describe('isValidTime', () => {
  it('acepta HH:MM válido', () => {
    expect(isValidTime('08:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });
  it('rechaza basura', () => {
    expect(isValidTime('mañana')).toBe(false);
    expect(isValidTime('25:00')).toBe(false);
  });
});

describe('formatHour', () => {
  it('formatea a H:MM', () => {
    expect(formatHour(8)).toBe('8:00');
    expect(formatHour(21.5)).toBe('21:30');
    expect(formatHour(7.75)).toBe('7:45');
  });
});

describe('loadMetaSchedule / saveMetaSchedule', () => {
  it('devuelve los defaults sin datos guardados', () => {
    expect(loadMetaSchedule()).toEqual({ open: META_DEFAULT_OPEN, close: META_DEFAULT_CLOSE });
  });
  it('guarda y recupera el horario', () => {
    expect(saveMetaSchedule('09:30', '20:15')).toBe(true);
    expect(loadMetaSchedule()).toEqual({ open: '09:30', close: '20:15' });
  });
  it('descarta valores corruptos guardados', () => {
    store['dv-meta-open'] = 'no-es-hora';
    expect(loadMetaSchedule().open).toBe(META_DEFAULT_OPEN);
  });
  it('devuelve false si localStorage falla', () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('quota'); });
    expect(saveMetaSchedule('08:00', '21:00')).toBe(false);
  });
});
