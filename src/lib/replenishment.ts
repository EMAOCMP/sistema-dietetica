/**
 * Criterio único de reposición.
 *
 * `min_stock` es el stock objetivo (el nivel al que se quiere volver).
 * - Sin historial de ventas no hay demanda confiable: se repone el faltante.
 * - Con historial, se usa lo que pide la demanda, pero nunca menos que el
 *   faltante contra el objetivo (para no quedar por debajo del mínimo).
 */

export interface SuggestionRow {
  stock: number;
  min_stock: number;
  /** Sugerido por demanda que calcula compute_replenishment. */
  suggested: number;
  /** Faltante contra el stock objetivo (min_stock − stock). */
  replenish: number;
  has_history: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cantidad a comprar antes de descontar lo que ya está pedido. */
export function targetReplenish(r: SuggestionRow): number {
  const demand = r.has_history ? r.suggested : 0;
  return round2(Math.max(demand, r.replenish, 0));
}

/** Cantidad sugerida neta: descuenta lo que ya está pedido y sin pedir. */
export function netSuggested(r: SuggestionRow, pending = 0): number {
  return round2(Math.max(targetReplenish(r) - pending, 0));
}

/**
 * Modo que conviene dejar seleccionado al abrir el generador.
 * La demanda solo gana si supera el faltante contra el objetivo.
 */
export function defaultMode(r: SuggestionRow): 'suggested' | 'replenish' {
  return targetReplenish(r) > round2(r.replenish) ? 'suggested' : 'replenish';
}