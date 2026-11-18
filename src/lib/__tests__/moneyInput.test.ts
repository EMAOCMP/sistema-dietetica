import { describe, it, expect } from 'vitest';
import { moneyOrZero, moneyText, parseMoney } from '../moneyInput';

describe('parseMoney', () => {
  it('interpreta el punto como separador de miles', () => {
    expect(parseMoney('3.800')).toBe(3800);
    expect(parseMoney('9.000')).toBe(9000);
    expect(parseMoney('1.234.567')).toBe(1234567);
  });

  it('interpreta la coma como decimal', () => {
    expect(parseMoney('3.800,50')).toBe(3800.5);
    expect(parseMoney('3,8')).toBe(3.8);
    expect(parseMoney('0,125')).toBe(0.125);
  });

  it('acepta el punto decimal cuando no forma grupos de miles', () => {
    expect(parseMoney('3800.50')).toBe(3800.5);
    expect(parseMoney('3.8')).toBe(3.8);
    expect(parseMoney('3800')).toBe(3800);
  });

  it('ignora símbolos y espacios', () => {
    expect(parseMoney('$ 3.800')).toBe(3800);
    expect(parseMoney(' 9.000 ')).toBe(9000);
  });

  it('devuelve NaN con texto vacío o inválido', () => {
    expect(Number.isNaN(parseMoney(''))).toBe(true);
    expect(Number.isNaN(parseMoney(null))).toBe(true);
    expect(Number.isNaN(parseMoney('abc'))).toBe(true);
  });

  it('acepta números', () => {
    expect(parseMoney(3800)).toBe(3800);
    expect(Number.isNaN(parseMoney(Infinity))).toBe(true);
  });
});

describe('moneyOrZero', () => {
  it('devuelve 0 cuando no hay valor', () => {
    expect(moneyOrZero('')).toBe(0);
    expect(moneyOrZero('abc')).toBe(0);
  });

  it('devuelve el importe cuando existe', () => {
    expect(moneyOrZero('3.800')).toBe(3800);
  });
});

describe('moneyText', () => {
  it('redondea a dos decimales y quita ceros sobrantes', () => {
    expect(moneyText(3800)).toBe('3800');
    expect(moneyText(3800.5)).toBe('3800.5');
    expect(moneyText(3800.456)).toBe('3800.46');
  });
});