import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueSale,
  enqueueStockAdjustment,
  enqueueProductCreate,
  enqueueProductUpdate,
  getPendingQueue,
  markQueueItemSynced,
  incrementQueueRetries,
  markQueueItemFailed,
  getFailedQueue,
  retryQueueItem,
  getPendingCount,
  cacheProducts,
  getCachedProducts,
  cacheCustomers,
  getCachedCustomers,
  clearOfflineData,
} from '../offlineDB';

beforeEach(async () => {
  await clearOfflineData();
});

describe('cola de sincronización', () => {
  it('encola una venta con su tipo y usuario', async () => {
    await enqueueSale({ salePayload: { total_amount: 100 }, cart: [] }, 'user-a');
    const pending = await getPendingQueue();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe('sale');
    expect(pending[0].user_id).toBe('user-a');
    expect(pending[0].synced).toBe(false);
    expect(pending[0].retries).toBe(0);
  });

  it('encola los 4 tipos de operación', async () => {
    await enqueueSale({ a: 1 }, 'u');
    await enqueueStockAdjustment({ b: 2 }, 'u');
    await enqueueProductCreate({ c: 3 }, 'u');
    await enqueueProductUpdate({ d: 4 }, 'u');
    const pending = await getPendingQueue();
    expect(pending.map((p: any) => p.type).sort()).toEqual([
      'product_create',
      'product_update',
      'sale',
      'stock_adjustment',
    ]);
  });

  it('aisla la cola por usuario', async () => {
    await enqueueSale({ x: 1 }, 'user-a');
    await enqueueSale({ x: 2 }, 'user-b');
    expect(await getPendingQueue('user-a')).toHaveLength(1);
    expect(await getPendingQueue('user-b')).toHaveLength(1);
    expect(await getPendingQueue()).toHaveLength(2);
  });

  it('el conteo pendiente refleja lo que falta sincronizar', async () => {
    expect(await getPendingCount()).toBe(0);
    await enqueueSale({}, 'u');
    await enqueueSale({}, 'u');
    expect(await getPendingCount()).toBe(2);

    const pending = await getPendingQueue();
    await markQueueItemSynced(pending[0].id);
    expect(await getPendingCount()).toBe(1);
  });

  it('un ítem sincronizado sale de la cola', async () => {
    await enqueueSale({}, 'u');
    const [item] = await getPendingQueue();
    await markQueueItemSynced(item.id);
    expect(await getPendingQueue()).toHaveLength(0);
  });

  it('incrementa los reintentos', async () => {
    await enqueueSale({}, 'u');
    const [item] = await getPendingQueue();
    await incrementQueueRetries(item.id);
    await incrementQueueRetries(item.id);
    const [after] = await getPendingQueue();
    expect(after.retries).toBe(2);
  });

  it('los ítems en dead-letter no se reintentan pero quedan visibles', async () => {
    await enqueueSale({}, 'u');
    const [item] = await getPendingQueue();
    await markQueueItemFailed(item.id, 'boom');

    expect(await getPendingQueue()).toHaveLength(0);
    expect(await getPendingCount()).toBe(0);

    const failed = await getFailedQueue();
    expect(failed).toHaveLength(1);
    expect(failed[0].last_error).toBe('boom');
    expect(failed[0].failed).toBe(true);
  });

  it('reintentar un ítem fallido lo devuelve a la cola', async () => {
    await enqueueSale({}, 'u');
    const [item] = await getPendingQueue();
    await markQueueItemFailed(item.id, 'boom');
    await retryQueueItem(item.id);

    expect(await getFailedQueue()).toHaveLength(0);
    const pending = await getPendingQueue();
    expect(pending).toHaveLength(1);
    expect(pending[0].retries).toBe(0);
  });
});

describe('caché de productos y clientes', () => {
  it('guarda y recupera productos', async () => {
    await cacheProducts([{ id: 'p1', name: 'Alfa', barcode: '111', category: 'X' }]);
    const cached = await getCachedProducts();
    expect(cached).toHaveLength(1);
    expect(cached[0].name).toBe('Alfa');
  });

  it('guarda y recupera clientes', async () => {
    await cacheCustomers([{ id: 'c1', name: 'Juan' }]);
    const cached = await getCachedCustomers();
    expect(cached).toHaveLength(1);
    expect(cached[0].name).toBe('Juan');
  });
});

describe('clearOfflineData', () => {
  it('borra caché y cola (logout)', async () => {
    await enqueueSale({}, 'u');
    await cacheProducts([{ id: 'p1', name: 'Alfa' }]);
    await cacheCustomers([{ id: 'c1', name: 'Juan' }]);

    await clearOfflineData();

    expect(await getPendingQueue()).toHaveLength(0);
    expect(await getPendingCount()).toBe(0);
    expect(await getCachedProducts()).toHaveLength(0);
    expect(await getCachedCustomers()).toHaveLength(0);
  });
});
