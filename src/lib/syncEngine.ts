import { supabase } from './supabase';
import { upsertProductBarcode } from './productBarcodes';
import {
  getPendingQueue,
  markQueueItemSynced,
  incrementQueueRetries,
  setLastSyncTime,
  getPendingCount,
} from './offlineDB';

let syncInProgress = false;
let syncInterval: ReturnType<typeof setInterval> | null = null;

const MAX_RETRIES = 5;
const SYNC_INTERVAL_MS = 10000; // 10 segundos
const BATCH_SIZE = 5;

export function startSyncEngine() {
  if (syncInterval) return;
  
  // Sync inmediato al iniciar
  processQueue();
  
  // Luego cada SYNC_INTERVAL_MS
  syncInterval = setInterval(() => {
    if (navigator.onLine) processQueue();
  }, SYNC_INTERVAL_MS);
  
  // También sincronizar cuando vuelve la conexión
  window.addEventListener('online', () => {
    console.log('[Sync] Conexión restaurada, sincronizando...');
    processQueue();
  });
}

export function stopSyncEngine() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

async function processQueue() {
  if (syncInProgress || !navigator.onLine) return;
  
  syncInProgress = true;
  console.log('[Sync] Iniciando sincronización...');
  
  try {
    const pending = await getPendingQueue();
    if (pending.length === 0) {
      syncInProgress = false;
      return;
    }
    
    console.log(`[Sync] ${pending.length} items pendientes`);
    
    // Procesar en lotes
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (!navigator.onLine) break;
      
      const batch = pending.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processQueueItem));
      
      // Pequeña pausa entre lotes
      await new Promise(r => setTimeout(r, 500));
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
        console.warn('[Sync] Tipo desconocido:', type);
    }
    
    await markQueueItemSynced(id);
    console.log(`[Sync] Item ${id} sincronizado`);
  } catch (err: any) {
    console.error(`[Sync] Error en item ${id}:`, err);
    
    if (retries >= MAX_RETRIES - 1) {
      console.error(`[Sync] Item ${id} superó max reintentos, se mantiene en cola`);
      // Podríamos mover a una cola de "dead letter" aquí
    } else {
      await incrementQueueRetries(id);
    }
    
    throw err;
  }
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

  const { data, error } = await supabase.rpc('create_sale', {
    p_customer_name: salePayload.customer_name || 'Cliente General',
    p_total_amount: salePayload.total_amount,
    p_items: items,
    p_payment: { method: salePayload.payment_method || 'cash' },
    p_sale_type: salePayload.sale_type || 'internal',
    p_dispatch_type: salePayload.dispatch_type || 'pickup',
    p_notes: salePayload.notes || null,
    p_customer_doc: salePayload.customer_doc || null,
    p_customer_iva_cond: salePayload.customer_iva_cond || 'CF',
    p_customer_phone: salePayload.customer_phone || null,
    p_net_amount: salePayload.net_amount,
    p_iva_amount: salePayload.iva_amount,
    p_profit_amount: salePayload.profit_amount,
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