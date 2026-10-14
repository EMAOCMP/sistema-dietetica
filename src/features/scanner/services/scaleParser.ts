/**
 * Parser de códigos EAN-13 de balanza / escala (uso interno).
 * Formato: 20 | PPPPP | WWWWW | C
 *   2 dígitos prefijo (20-29, típico 20)
 *   5 dígitos PLU (código del producto en la balanza)
 *   5 dígitos peso (gramos) o precio (centavos) según config de la balanza
 *   1 dígito verificador
 * v1: se interpreta como PESO (dietética vende por kg). El modo precio
 * queda preparado vía `mode` para cuando se confirme con el usuario.
 */

export interface ScaleCode {
  raw: string;
  prefix: string;
  plu: string;
  valueRaw: string;
  weightKg: number;
  priceCents: number;
  check: string;
}

export function isScaleCode(code: string): boolean {
  const c = (code || '').trim();
  return /^\d{13}$/.test(c) && c[0] === '2';
}

export function parseScaleCode(code: string): ScaleCode | null {
  const c = (code || '').trim();
  if (!isScaleCode(c)) return null;
  const prefix = c.slice(0, 2);
  const plu = c.slice(2, 7);
  const valueRaw = c.slice(7, 12);
  const check = c.slice(12, 13);
  const value = parseInt(valueRaw, 10);
  if (Number.isNaN(value)) return null;
  return {
    raw: c,
    prefix,
    plu,
    valueRaw,
    // Convención dietética: gramos → kg (01250 = 1.250 kg)
    weightKg: value / 1000,
    // Alternativa: centavos → $ (01250 = $12,50)
    priceCents: value,
    check,
  };
}
