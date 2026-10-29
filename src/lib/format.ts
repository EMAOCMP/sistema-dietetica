/**
 * Formato de moneda argentino: $6.000,00
 * - Separador de miles: punto
 * - Decimales: coma, siempre 2 dígitos
 *
 * Fuente única de verdad. Antes cada vista tenía su propia copia
 * (y el PDF redondeaba a pesos enteros, perdiendo los centavos).
 */

/** Con signo peso y 2 decimales: "$6.000,00". */
export function fmtMoney(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0,00';
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compacto, sin decimales (para KPIs grandes): "$6.000". */
export function fmtMoney0(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0';
  return '$' + Math.round(v).toLocaleString('es-AR');
}

/**
 * Sin signo peso, para CSV/Excel (así la celda queda numérica):
 * "6.000,00". Devuelve cadena vacía cuando no hay valor.
 */
export function fmtMoneyPlain(n: unknown): string {
  if (n === null || n === undefined) return '';
  if (typeof n === 'string' && n.trim() === '') return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
