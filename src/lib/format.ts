/**
 * Formato moneda argentino: $6.000,00
 * - Separador de miles: punto
 * - Decimales: coma, siempre 2 dígitos
 */
export function fmtMoney(n: number | string | null | undefined): string {
  const v = Number(n);
  if (isNaN(v)) return '$0,00';
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Formato moneda compacto sin decimales (para KPIs grandes): $6.000
 */
export function fmtMoney0(n: number | string | null | undefined): string {
  const v = Number(n);
  if (isNaN(v)) return '$0';
  return '$' + Math.round(v).toLocaleString('es-AR');
}
