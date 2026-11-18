/**
 * Lectura de importes escritos por personas.
 *
 * En Argentina el punto se usa para los miles (`3.800`) y la coma para los
 * centavos (`3.800,50`). Los `<input type="number">` entregan el texto tal
 * cual, así que `parseFloat('3.800')` devuelve 3,8 y arruina el importe.
 *
 * `parseMoney` interpreta las dos convenciones:
 *   '3.800'      → 3800
 *   '1.234.567'  → 1234567
 *   '3.800,50'   → 3800.5
 *   '3800.50'    → 3800.5
 *   '3,8'        → 3.8
 *   ''           → NaN
 */

export function parseMoney(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const s = String(raw ?? '').trim();
  if (!s) return NaN;

  // Quita símbolos de moneda y espacios (incluye el espacio fino de miles).
  const clean = s.replace(/[$\s\u00a0\u202f]/g, '');

  const lastComma = clean.lastIndexOf(',');

  if (lastComma > -1) {
    // Coma decimal: los puntos son separadores de miles.
    const normalized = clean.replace(/\./g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  }

  // Sin coma: si los puntos separan grupos de 3 dígitos, son miles.
  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    const n = Number(clean.replace(/\./g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  // Punto decimal (ej. '3800.50') o entero.
  const n = Number(clean);
  return Number.isFinite(n) ? n : NaN;
}

/** Igual que `parseMoney` pero devuelve 0 cuando el campo está vacío o inválido. */
export function moneyOrZero(raw: unknown): number {
  const n = parseMoney(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Texto para mostrar un importe sin decimales innecesarios. */
export function moneyText(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
}