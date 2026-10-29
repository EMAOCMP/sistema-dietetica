/**
 * Modelo y texto del ticket — fuente única de verdad.
 *
 * Antes el POS y el Historial tenían dos constructores distintos del mismo
 * ticket (y con información distinta: el Historial no mostraba descuento,
 * envío ni detalles del pago). Ahora ambos arman un `TicketData` y de ahí
 * salen el texto de WhatsApp, la impresión y el PDF.
 */

import { loadBusiness } from './businessSettings';
import { paymentLabel } from './paymentMethods';
import { fmtMoney } from './format';

export interface TicketItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface TicketData {
  saleId: string;
  receiptNumber?: string | null;
  dateLabel: string;
  customerName: string;
  customerDoc?: string | null;
  customerIvaCond?: string | null;
  saleType?: string | null;
  paymentMethod?: string | null;
  dispatchType?: string | null;
  /** Líneas extra del medio de pago (banco, tarjeta, cuotas…). */
  paymentDetails?: string[];
  notes?: string | null;
  items: TicketItem[];
  /** Subtotal antes de descuento y envío. Si falta, se calcula con los ítems. */
  subtotal?: number;
  discountLabel?: string | null;
  discountAmount?: number;
  deliveryFee?: number;
  /** Envío bonificado (sin costo) */
  deliveryFeeFree?: boolean;
  netAmount?: number;
  ivaAmount?: number;
  totalAmount: number;
  sellerName?: string | null;
}

/** "N° 0001-00000018" si hay correlativo, si no "Ticket #A1B2C3D4". */
export function ticketNumberLabel(data: TicketData): string {
  return data.receiptNumber
    ? `N° ${data.receiptNumber}`
    : `Ticket #${(data.saleId || '').slice(0, 8).toUpperCase()}`;
}

/** Nombre de archivo del PDF del ticket. */
export function ticketFileName(data: TicketData): string {
  const base = data.receiptNumber
    ? `ticket-${data.receiptNumber}`
    : `ticket-${(data.saleId || 'venta').slice(0, 8).toUpperCase()}`;
  return `${base}.pdf`;
}

export function dispatchLabel(d?: string | null): string {
  return d === 'delivery' ? 'Envío' : 'Retira';
}

/** Subtotal del ticket (suma de ítems si no viene informado). */
export function ticketSubtotal(data: TicketData): number {
  if (typeof data.subtotal === 'number' && Number.isFinite(data.subtotal)) return data.subtotal;
  return data.items.reduce((acc, i) => acc + (Number(i.subtotal) || 0), 0);
}

/**
 * Texto plano del ticket (WhatsApp / clipboard).
 * WhatsApp interpreta *texto* como negrita.
 */
export function buildTicketText(data: TicketData): string {
  const biz = loadBusiness();
  const lines: string[] = [];

  lines.push(`*${biz.name} - ${ticketNumberLabel(data)}*`);
  if (biz.address) lines.push(biz.address);
  if (biz.phone) lines.push(`Tel: ${biz.phone}`);
  if (biz.cuit) lines.push(`CUIT: ${biz.cuit}`);
  lines.push(`Cliente: ${data.customerName || 'Cliente General'}`);
  if (data.saleType === 'afip') {
    if (data.customerDoc) lines.push(`CUIT/DNI: ${data.customerDoc}`);
    lines.push(`Cond. IVA: ${data.customerIvaCond || 'CF'}`);
  }
  lines.push(`Fecha: ${data.dateLabel}`);
  lines.push(`Pago: ${paymentLabel(data.paymentMethod || 'cash')} | Despacho: ${dispatchLabel(data.dispatchType)}`);
  (data.paymentDetails || []).forEach((d) => lines.push(d));
  if (data.sellerName) lines.push(`Vendedor: ${data.sellerName}`);
  if (data.notes) lines.push(`Notas: ${data.notes}`);
  lines.push('');

  if (data.items.length === 0) {
    lines.push('(Detalle de items no registrado - venta antigua)');
  } else {
    data.items.forEach((i) => {
      lines.push(`- ${i.name} x${i.quantity} - ${fmtMoney(i.subtotal)}`);
    });
  }

  lines.push('');
  lines.push(`Subtotal: ${fmtMoney(ticketSubtotal(data))}`);
  if ((data.discountAmount || 0) > 0) {
    const label = data.discountLabel || '';
    lines.push(`Descuento${label ? ` (${label})` : ''}: -${fmtMoney(data.discountAmount)}`);
  }
  if (data.dispatchType === 'delivery') {
    lines.push((data.deliveryFee || 0) > 0 ? `Envio: +${fmtMoney(data.deliveryFee)}` : 'Envio: BONIFICADO');
  }
  lines.push('');
  if (data.saleType === 'afip') {
    lines.push(`Neto: ${fmtMoney(data.netAmount ?? 0)}`);
    lines.push(`IVA 21%: ${fmtMoney(data.ivaAmount ?? 0)}`);
  }
  lines.push(`*TOTAL: ${fmtMoney(data.totalAmount)}*`);
  lines.push('');
  lines.push('¡Gracias por elegir saludable! 🌱');
  if (biz.footer) lines.push(biz.footer);
  return lines.join('\n');
}
