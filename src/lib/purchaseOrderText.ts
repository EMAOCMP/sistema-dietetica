/**
 * Texto de la orden de compra para el proveedor (WhatsApp / clipboard).
 *
 * Costo: se usa el costo congelado en la orden (`unitCost`). Si la orden es
 * vieja y no lo tiene, se cae al costo actual del producto (`fallbackCost`).
 * En ambos casos el total se presenta como ESTIMADO: el costo real se
 * confirma al recibir la mercadería (se puede corregir en el ingreso).
 */

import { fmtMoney } from './format';

export interface PurchaseOrderTextItem {
  name: string;
  quantity: number;
  /** Unidad de venta del producto: 'kg' o 'un'. */
  unit?: string | null;
  /** Costo congelado al generar la orden (puede ser null en órdenes viejas). */
  unitCost?: number | null;
  /** Costo actual del producto, usado solo si falta `unitCost`. */
  fallbackCost?: number | null;
}

export interface PurchaseOrderTextData {
  id: string;
  orderNumber?: string | null;
  supplierName?: string | null;
  /** Fecha de creación (ISO). */
  createdAt: string;
  notes?: string | null;
  items: PurchaseOrderTextItem[];
}

const qtyLabel = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '0';

/** "N° OC-000012" o el prefijo del id si la orden no tiene número. */
export function purchaseOrderNumberLabel(data: PurchaseOrderTextData): string {
  return data.orderNumber || (data.id || '').slice(0, 8).toUpperCase();
}

export function buildPurchaseOrderText(data: PurchaseOrderTextData): string {
  let total = 0;
  let sinCosto = 0;

  const lines = data.items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const unit = it.unit === 'kg' ? 'kg' : 'un';
    const cost = it.unitCost != null ? Number(it.unitCost) : (Number(it.fallbackCost) || 0);
    const qtyText = `${qtyLabel(qty)} ${unit}`;
    if (cost > 0) {
      total += qty * cost;
      return `- ${it.name || 'Producto'}: ${qtyText} × ${fmtMoney(cost)} = ${fmtMoney(qty * cost)}`;
    }
    sinCosto++;
    return `- ${it.name || 'Producto'}: ${qtyText}`;
  });

  const supplier = data.supplierName && data.supplierName !== 'Sin proveedor'
    ? data.supplierName
    : null;
  const date = new Date(data.createdAt).toLocaleDateString('es-AR');

  const out: string[] = [];
  out.push(supplier ? `Hola ${supplier}, te paso la orden de compra:` : 'Hola, te paso la orden de compra:');
  out.push('');
  out.push(`*Orden ${purchaseOrderNumberLabel(data)}*`);
  out.push(`Fecha: ${date}`);
  out.push('');
  out.push(...lines);
  out.push('');
  if (total > 0) out.push(`*Costo estimado: ${fmtMoney(total)}*`);
  if (sinCosto > 0) {
    out.push(`(${sinCosto} producto${sinCosto === 1 ? '' : 's'} sin costo cargado)`);
  }
  if (data.notes) out.push(`Notas: ${data.notes}`);
  out.push('');
  out.push('Los precios son estimados y se confirman al recibir la mercadería.');
  return out.join('\n');
}
