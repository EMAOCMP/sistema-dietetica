import { supabase } from './supabase';
import { upsertProductBarcode } from './productBarcodes';
import { nextReceiptNumber } from './receipt';
import {
  getPendingQueue,
  markQueueItemSynced,
  incrementQueueRetries,
  markQueueItemFailed,
  setLastSyncTime,
  getPendingCount,
} from './offlineDB';

let syncInProgress = false;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let onlineListener: (() => void) | null = null;
let currentUserId: string | null = null;

const MAX_RETRIES = 5;
const SYNC_INTERVAL_MS = 10000; // 10 segundos
const BATCH_SIZE = 5;

export function startSyncEngine(userId?: string | null) {
  currentUserId = userId || null;
  if (syncInterval) return;

  // Sync inmediato al iniciar
  processQueue();

  // Luego cada SYNC_INTERVAL_MS
  syncInterval = setInterval(() => {
    if (navigator.onLine) processQueue();
  }, SYNC_INTERVAL_MS);

  // También sincronizar cuando vuelve la conexión
  if (!onlineListener) {
    onlineListener = () => {
      console.log('[Sync] Conexión restaurada, sincronizando...');
      processQueue();
    };
    window.addEventListener('online', onlineListener);
  }
}

export function stopSyncEngine() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (onlineListener) {
    window.removeEventListener('online', onlineListener);
    onlineListener = null;
  }
  currentUserId = null;
}

async function processQueue() {
  if (syncInProgress || !navigator.onLine) return;

  syncInProgress = true;
  console.log('[Sync] Iniciando sincronización...');

  try {
    const pending = await getPendingQueue(currentUserId);
    if (pending.length === 0) {
      syncInProgress = false;
      return;
    }

    console.log(`[Sync] ${pending.length} items pendientes`);

    // Procesar en lotes. Cada ítem es independiente: un fallo NO debe abortar el resto.
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (!navigator.onLine) break;

      const batch = pending.slice(i, i + BATCH_SIZE);
      // allSettled: los ítems que fallan se marcan, pero el lote continúa.
      const results = await Promise.allSettled(batch.map((item) => processQueueItem(item)));

      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          console.error(`[Sync] Item ${batch[idx]?.id} falló y queda en cola para reintento`);
        }
      });

      // Pequeña pausa entre lotes (no después del último).
      if (i + BATCH_SIZE < pending.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    try {
      await setLastSyncTime(Date.now());
    } catch (metaErr) {
      console.warn('[Sync] No se pudo guardar metadata, items ya sincronizados:', metaErr);
    }
    console.log('[Sync] Sincronización completada');
  } catch (err) {
    console.error('[Sync] Error:', err);
  } finally {
    syncInProgress = false;
  }
}

async function processQueueItem(item: any) {
  const { id, type, payload, retries } = item;

  try {
    switch (type) {
      case 'sale':
        await syncSale(payload);
        break;
      case 'stock_adjustment':
        await syncStockAdjustment(payload);
        break;
      case 'product_create':
        await syncProductCreate(payload);
        break;
      case 'product_update':
        await syncProductUpdate(payload);
        break;
      default:
        // Tipo desconocido: NO se marca como sincronizado (evita perder datos en silencio).
        throw new Error(`[Sync] Tipo de cola desconocido: ${type}`);
    }

    await markQueueItemSynced(id);
    console.log(`[Sync] Item ${id} sincronizado`);
  } catch (err: any) {
    console.error(`[Sync] Error en item ${id}:`, err);

    if (retries >= MAX_RETRIES - 1) {
      // Dead-letter: se marca como fallido y deja de reintentarse en cada ciclo.
      await markQueueItemFailed(id, err?.message || 'Error desconocido');
      console.error(`[Sync] Item ${id} superó max reintentos y pasó a estado fallido`);
    } else {
      await incrementQueueRetries(id);
    }

    throw err;
  }
}

/** Extrae el detalle de pago del payload de la venta al formato que espera el RPC. */
function paymentPayloadFromSale(salePayload: any) {
  const method = salePayload.payment_method || 'cash';
  const payment: Record<string, unknown> = { method };

  if (method === 'transfer') {
    if (salePayload.transfer_bank) payment.transfer_bank = salePayload.transfer_bank;
    if (salePayload.transfer_account) payment.transfer_account = salePayload.transfer_account;
    if (salePayload.transfer_ref) payment.transfer_ref = salePayload.transfer_ref;
  } else if (method === 'card') {
    if (salePayload.card_type) payment.card_type = salePayload.card_type;
    if (salePayload.card_brand) payment.card_brand = salePayload.card_brand;
    if (salePayload.card_last4) payment.card_last4 = salePayload.card_last4;
    if (salePayload.card_auth) payment.card_auth = salePayload.card_auth;
    if (salePayload.card_installments) payment.card_installments = salePayload.card_installments;
  }

  return payment;
}

async function syncSale(payload: any) {
  const isWrapped = payload && payload.salePayload && payload.cart;
  const salePayload = isWrapped ? payload.salePayload : payload;
  const cart = isWrapped ? payload.cart : payload.sale_items;

  const items = (cart || []).map((item: any) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    cost_price: item.cost_price,
  }));

  // Ticket: si la venta offline no lo tiene (no había red para reservarlo),
  // se reserva ahora para que toda venta tenga correlativo.
  let receiptNumber: string | null = salePayload.receipt_number || null;
  if (!receiptNumber) {
    receiptNumber = await nextReceiptNumber();
    if (receiptNumber) console.log(`[Sync] Ticket asignado a la venta offline: ${receiptNumber}`);
  }

  // Idempotencia: la misma clave en todos los reintentos evita ventas duplicadas.
  const idempotencyKey: string | null = salePayload.idempotency_key || salePayload.op_key || null;

  const { data, error } = await supabase.rpc('create_sale', {
    p_customer_name: salePayload.customer_name || 'Cliente General',
    p_total_amount: salePayload.total_amount,
    p_items: items,
    p_payment: paymentPayloadFromSale(salePayload),
    p_sale_type: salePayload.sale_type || 'internal',
    p_dispatch_type: salePayload.dispatch_type || 'pickup',
    p_notes: salePayload.notes || null,
    p_customer_doc: salePayload.customer_doc || null,
    p_customer_iva_cond: salePayload.customer_iva_cond || 'CF',
    p_customer_phone: salePayload.customer_phone || null,
    p_net_amount: salePayload.net_amount,
    p_iva_amount: salePayload.iva_amount,
    p_profit_amount: salePayload.profit_amount,
    p_idempotency_key: idempotencyKey,
    p_receipt_number: receiptNumber,
  });
  if (error) throw error;

  // Descuentos (columnas nuevas, best-effort — ignorar si el SQL falta)
  try {
    const row: any = Array.isArray(data) ? data[0] : data;
    const saleId = row?.sale_id;
    if (saleId) {
      const g = Number(salePayload.discount_amount || 0);
      if (g > 0) await supabase.from('sales').update({ discount_amount: g }).eq('id', saleId);
      for (const item of cart || []) {
        if (Number(item.discount_amount || 0) > 0) {
          await supabase.from('sale_items')
            .update({ discount_amount: Number(item.discount_amount) })
            .eq('sale_id', saleId)
            .eq('product_id', item.product_id);
        }
      }
    }
  } catch { /* noop */ }

  return data;
}

async function syncStockAdjustment(payload: any) {
  const { error } = await supabase.rpc('adjust_stock', {
    p_product_id: payload.product_id,
    p_quantity: payload.quantity_change,
    p_reference_type: 'adjustment',
    p_reference_id: null,
    p_reason: payload.reason || null,
  });
  if (error) throw error;
}

async function syncProductCreate(payload: any) {
  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;
  if (data?.id && payload?.barcode) {
    const res = await upsertProductBarcode(data.id, payload.barcode);
    if (res.error) console.warn('[Sync] No se pudo registrar el código offline en product_barcodes:', res.error);
  }
}

async function syncProductUpdate(payload: any) {
  const { id, ...updates } = payload;
  const { error } = await supabase.from('products').update(updates).eq('id', id);
  if (error) throw error;
  if (updates.barcode) {
    const res = await upsertProductBarcode(id, updates.barcode);
    if (res.error) console.warn('[Sync] No se pudo registrar el código offline en product_barcodes:', res.error);
  }
}

// API pública para obtener conteo pendiente (para UI)
export async function getPendingQueueCount(): Promise<number> {
  return getPendingCount();
}

export function isSyncInProgress(): boolean {
  return syncInProgress;
}