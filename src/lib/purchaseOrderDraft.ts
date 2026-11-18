import type { PurchaseOrderItem } from '../types';

export type DraftUnit = 'kg' | 'unit';

/** Redondeo a centavos para que el total coincida con lo que muestra la UI. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Subtotal de una línea: cantidad × costo unitario. Costo nulo cuenta como 0. */
export const draftLineTotal = (
  line: Pick<PurchaseOrderItem, 'quantity' | 'unit_cost'>,
): number => {
  const qty = Number(line.quantity);
  const cost = line.unit_cost == null ? 0 : Number(line.unit_cost);
  if (!Number.isFinite(qty) || !Number.isFinite(cost)) return 0;
  return round2(qty * cost);
};

/** Total estimado del borrador (misma fórmula que usa la base). */
export const draftTotal = (
  lines: Array<Pick<PurchaseOrderItem, 'quantity' | 'unit_cost'>>,
): number => round2(lines.reduce((acc, line) => acc + draftLineTotal(line), 0));

/**
 * Valida las líneas antes de guardar. Devuelve el primer error en texto
 * listo para mostrar, o null si está todo bien.
 */
export const validateDraftLines = (
  lines: Array<Pick<PurchaseOrderItem, 'product_id' | 'quantity' | 'unit_cost' | 'product_name'>>,
  unitOf: (productId: string) => DraftUnit = () => 'unit',
): string | null => {
  if (lines.length === 0) return 'Agregá al menos un producto a la orden.';
  const seen = new Set<string>();
  for (const line of lines) {
    const name = line.product_name || 'Producto';
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return `Cantidad inválida en "${name}".`;
    if (unitOf(line.product_id) !== 'kg' && !Number.isInteger(qty)) {
      return `"${name}" se vende por unidad: la cantidad debe ser entera.`;
    }
    if (line.unit_cost != null) {
      const cost = Number(line.unit_cost);
      if (!Number.isFinite(cost) || cost < 0) return `Costo inválido en "${name}".`;
    }
    if (seen.has(line.product_id)) return `"${name}" está repetido en la orden.`;
    seen.add(line.product_id);
  }
  return null;
};

export interface DraftPayloadLine {
  product_id: string;
  quantity: number;
  qty_replenish: number;
  qty_suggested: number;
  unit_cost: number | null;
}

/**
 * Payload para `update_purchase_order(p_items)`. La base recalcula
 * `total_cost` a partir de cantidad × costo.
 */
export const buildUpdatePayload = (
  lines: Array<
    Pick<PurchaseOrderItem, 'product_id' | 'quantity' | 'unit_cost' | 'qty_replenish' | 'qty_suggested'>
  >,
): DraftPayloadLine[] =>
  lines.map((line) => ({
    product_id: line.product_id,
    quantity: Number(line.quantity),
    qty_replenish: Number(line.qty_replenish) || 0,
    qty_suggested: Number(line.qty_suggested) || 0,
    unit_cost: line.unit_cost == null ? null : Number(line.unit_cost),
  }));

/**
 * Diferencia entre el total real del ingreso y el estimado de la OC.
 * Positivo = salió más caro de lo previsto. `null` si todavía no hay
 * total real (orden no recibida).
 */
export const costVariance = (
  estimated: number,
  real: number | null | undefined,
): number | null => {
  if (real == null) return null;
  const r = Number(real);
  if (!Number.isFinite(r)) return null;
  const e = Number(estimated);
  return round2(r - (Number.isFinite(e) ? e : 0));
};
