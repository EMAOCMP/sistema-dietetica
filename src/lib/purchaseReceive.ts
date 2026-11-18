/** Campos mínimos para comparar pedido vs recibido (acepta nulos de la base). */
export interface ReceivedLine {
  product_id?: string;
  product_name?: string;
  quantity?: number | null;
  unit_cost?: number | null;
  received_quantity?: number | null;
}

/** Redondeo a centavos para que el faltante coincida con la UI. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Unidades que faltaron en una línea: pedido − recibido, nunca negativo.
 * Si no hay dato de recibido (legacy/sin confirmar) devuelve 0 para no
 * inventar un faltante.
 */
export const lineShortage = (line: ReceivedLine): number => {
  const ordered = Number(line.quantity);
  if (!Number.isFinite(ordered) || ordered <= 0) return 0;
  if (line.received_quantity == null) return 0;
  const received = Number(line.received_quantity);
  if (!Number.isFinite(received)) return 0;
  return Math.max(round2(ordered - received), 0);
};

/** Costo estimado de lo que faltó: faltante × costo unitario. */
export const lineShortageCost = (line: ReceivedLine): number => {
  const shortage = lineShortage(line);
  if (shortage <= 0) return 0;
  const cost = line.unit_cost == null ? 0 : Number(line.unit_cost);
  if (!Number.isFinite(cost)) return 0;
  return round2(shortage * cost);
};

export interface ShortageSummary {
  /** Unidades totales que faltaron. */
  quantity: number;
  /** Costo estimado de esas unidades. */
  cost: number;
  /** Cantidad de líneas con faltante. */
  lines: number;
}

/** Totales de faltante de una orden. Sin líneas devuelve todo en 0. */
export const shortageSummary = (lines: ReceivedLine[] = []): ShortageSummary => {
  const summary: ShortageSummary = { quantity: 0, cost: 0, lines: 0 };
  for (const line of lines) {
    const shortage = lineShortage(line);
    if (shortage <= 0) continue;
    summary.quantity = round2(summary.quantity + shortage);
    summary.cost = round2(summary.cost + lineShortageCost(line));
    summary.lines += 1;
  }
  return summary;
};

/** true si faltó al menos una unidad. */
export const hasShortage = (lines: ReceivedLine[] = []): boolean =>
  shortageSummary(lines).quantity > 0;
