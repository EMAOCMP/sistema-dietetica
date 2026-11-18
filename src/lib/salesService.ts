import { supabase } from './supabase';
import { nextReceiptNumber } from './receipt';
import { netoFromTotal, ivaFromTotal, round2 } from './tax';
import type { CartItem } from '../types';

/**
 * Checkout de venta (V3 Fase 5): sin React.
 * RPC idempotente `create_sale` con reintentos por colisión de ticket
 * y fallback al flujo directo si el SQL aún no está migrado.
 */

export interface SaleCustomer {
  name: string;
  doc: string;
  ivaCond: string;
  phone: string;
}

export interface SaleConfig {
  saleType: 'internal' | 'afip';
  dispatchType: 'pickup' | 'delivery';
  notes: string | null;
  totalAmount: number;
  totalProfit: number;
  /** Descuento global de la venta (columna sales.discount_amount, best-effort). */
  discountAmount?: number;
}

export interface SaleCheckoutResult {
  saleId: string;
  receiptNumber: string | null;
  usedRpc: boolean;
}

export const newOpKey = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function buildSalePayload(args: {
  userId: string | null;
  customer: SaleCustomer;
  config: SaleConfig;
  receiptNumber: string | null;
  paymentMethod: string;
  paymentDetail: Record<string, unknown>;
}) {
  const { userId, customer, config, receiptNumber, paymentMethod, paymentDetail } = args;
  return {
    user_id: userId,
    customer_name: customer.name || 'Cliente General',
    customer_doc: customer.doc.replace(/\D/g, '') || null,
    customer_iva_cond: customer.ivaCond,
    customer_phone: customer.phone.replace(/\D/g, '') || null,
    sale_type: config.saleType,
    receipt_number: receiptNumber,
    total_amount: config.totalAmount,
    net_amount: round2(netoFromTotal(config.totalAmount)),
    iva_amount: round2(ivaFromTotal(config.totalAmount)),
    profit_amount: config.totalProfit,
    discount_amount: round2(config.discountAmount || 0),
    payment_method: paymentMethod,
    dispatch_type: config.dispatchType,
    notes: config.notes,
    status: 'completed' as const,
    ...paymentDetail,
  };
}

const CLASH_CODES = ['42703', 'PGRST204'];

/**
 * Ejecuta la venta online. Devuelve id + ticket.
 * Reintenta ante colisión de ticket con la MISMA opKey (sin duplicar).
 * Si el RPC no existe, hace fallback al flujo directo (items + adjust_stock).
 */
export async function executeSale(args: {
  payload: Record<string, unknown>;
  cart: CartItem[];
  customer: SaleCustomer;
  config: SaleConfig;
  paymentMethod: string;
  paymentDetail: Record<string, unknown>;
}): Promise<SaleCheckoutResult> {
  const { payload, cart, customer, config, paymentMethod, paymentDetail } = args;

  const opKey = newOpKey();
  let receiptNumber = (payload.receipt_number as string | null) || null;
  let saleData: { id: string; receipt_number?: string | null } | null = null;
  let usedRpc = false;

  for (let attempt = 0; attempt < 3 && !usedRpc; attempt++) {
    try {
      const { data, error } = await supabase.rpc('create_sale', {
        p_customer_name: customer.name || 'Cliente General',
        p_total_amount: config.totalAmount,
        p_items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price,
          cost_price: item.product.cost_price,
        })),
        p_payment: { method: paymentMethod, ...paymentDetail },
        p_sale_type: config.saleType,
        p_dispatch_type: config.dispatchType,
        p_notes: config.notes,
        p_customer_doc: customer.doc.replace(/\D/g, '') || null,
        p_customer_iva_cond: customer.ivaCond,
        p_customer_phone: customer.phone.replace(/\D/g, '') || null,
        p_net_amount: round2(netoFromTotal(config.totalAmount)),
        p_iva_amount: round2(ivaFromTotal(config.totalAmount)),
        p_profit_amount: config.totalProfit,
        p_idempotency_key: opKey,
        p_receipt_number: receiptNumber,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (!row?.sale_id) throw new Error('RPC sin sale_id');
      saleData = { id: row.sale_id, receipt_number: row.receipt_number || null };
      usedRpc = true;
    } catch (rpcErr: any) {
      const msg = rpcErr?.message || '';
      const receiptClash = rpcErr?.code === '23505'
        && (msg.includes('ux_sales_receipt_number') || msg.includes('receipt_number'));
      if (receiptClash && attempt < 2) {
        console.warn('Ticket en uso, reservando otro:', receiptNumber);
        receiptNumber = await nextReceiptNumber();
        continue;
      }
      console.warn('create_sale RPC no disponible, uso flujo directo:', msg || rpcErr);
      break;
    }
  }

  if (!usedRpc) {
    const directPayload: Record<string, unknown> = { ...payload, receipt_number: receiptNumber, idempotency_key: opKey };
    const res = await supabase.from('sales').insert(directPayload).select().single();
    saleData = res.data;
    let saleError = res.error;

    if (saleError && (saleError.message?.includes('column') || CLASH_CODES.includes(String(saleError.code)))) {
      // Schema viejo: eliminar columnas que no existen y reintentar
      for (const col of [
        'payment_method', 'dispatch_type', 'status', 'customer_doc', 'customer_iva_cond',
        'customer_phone', 'idempotency_key',
        'net_amount', 'iva_amount', 'receipt_number', 'transfer_bank', 'transfer_account',
        'transfer_ref', 'card_type', 'card_brand', 'card_last4', 'card_auth', 'card_installments',
      ]) delete directPayload[col];
      const retry = await supabase.from('sales').insert(directPayload).select().single();
      saleData = retry.data;
      saleError = retry.error;
    }
    if (saleError) throw saleError;
    if (!saleData) throw new Error('No se pudo crear la venta');

    for (const item of cart) {
      const unitPrice = item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price;
      const pct = item.discount || 0;
      const baseItem = {
        sale_id: saleData.id,
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: unitPrice,
        subtotal: unitPrice * item.quantity,
        cost_price_at_sale: item.product.cost_price,
      };
      let { error: itemError } = await supabase.from('sale_items').insert({
        ...baseItem,
        discount_amount: round2(unitPrice * item.quantity * pct / 100),
      });
      if (itemError && itemError.message?.includes('column')) {
        // Esquema viejo sin discount_amount
        ({ error: itemError } = await supabase.from('sale_items').insert(baseItem));
      }
      if (itemError) throw itemError;

      const { error: stockError } = await supabase.rpc('adjust_stock', {
        p_product_id: item.product.id,
        p_quantity: -item.quantity,
        p_reference_type: 'sale',
        p_reference_id: String(saleData.id),
        p_reason: `Venta #${String(saleData.id).slice(0, 8)} (${paymentMethod} - ${config.dispatchType})`,
      });
      if (stockError) {
        // La venta ya está creada: no se puede revertir acá. Antes el error se
        // descartaba y el stock quedaba sin descontar sin que nadie se enterara.
        console.error(
          `Venta ${saleData.id}: no se pudo descontar stock de ${item.product.name}:`,
          stockError.message,
        );
      }
    }
  }

  if (usedRpc) {
    // El RPC no persiste descuentos: se actualizan después (best-effort)
    await persistSaleDiscounts(saleData!.id, cart, config.discountAmount || 0);
  }

  // Teléfono del cliente (best-effort): el RPC create_sale lo recibe pero
  // algunas versiones desplegadas no lo guardan. set_sale_phone() cubre eso.
  await persistSalePhone(saleData!.id, customer.phone);

  return {
    saleId: saleData!.id,
    receiptNumber: saleData!.receipt_number || (payload.receipt_number as string | null) || null,
    usedRpc,
  };
}

/**
 * Guarda el teléfono del cliente en la venta (best-effort).
 * Usa el RPC `set_sale_phone` (SECURITY DEFINER: el vendedor puede tocar su
 * propia venta aunque la política de UPDATE sea solo admin/supervisor).
 * Si el SQL no está aplicado, intenta un update directo y, si tampoco hay
 * permiso, no rompe la venta.
 */
export async function persistSalePhone(saleId: string, phone?: string | null) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return;
  try {
    const { error } = await supabase.rpc('set_sale_phone', {
      p_sale_id: saleId,
      p_phone: digits,
    });
    if (!error) return;
    // Función ausente (SQL sin correr): probar update directo.
    if (!/function|schema cache|does not exist|PGRST202/i.test(error.message || '')) return;
    await supabase.from('sales').update({ customer_phone: digits }).eq('id', saleId);
  } catch { /* esquema viejo o sin red: noop */ }
}

/**
 * Persiste los descuentos (columnas nuevas, best-effort): el RPC create_sale
 * no las conoce, así que se actualizan después de crear la venta.
 * Si el SQL de reportes_mejoras.sql todavía no se corrió, los updates fallan
 * en silencio y los descuentos quedan solo embebidos en el total (como antes).
 */
export async function persistSaleDiscounts(saleId: string, cart: CartItem[], discountAmount: number) {
  try {
    if (discountAmount > 0) {
      await supabase.from('sales').update({ discount_amount: round2(discountAmount) }).eq('id', saleId);
    }
    for (const item of cart) {
      const pct = item.discount || 0;
      if (pct <= 0) continue;
      const unitPrice = item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price;
      await supabase.from('sale_items')
        .update({ discount_amount: round2(unitPrice * item.quantity * pct / 100) })
        .eq('sale_id', saleId)
        .eq('product_id', item.product.id);
    }
  } catch { /* esquema viejo o sin red: noop */ }
}
