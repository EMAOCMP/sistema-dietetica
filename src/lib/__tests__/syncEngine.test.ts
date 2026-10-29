// IndexedDB en memoria: debe cargarse ANTES de cualquier módulo de la app
// que use `idb` (offlineDB / syncEngine).
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock de Supabase (antes de importar el módulo bajo prueba) ---
const rpcMock = vi.fn();
const fromMock = vi.fn(() => ({
  update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })),
  insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })),
}));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: (...args: any[]) => fromMock(...args),
  },
}));

vi.mock('../receipt', () => ({
  nextReceiptNumber: vi.fn(async () => '0001-00000042'),
}));

vi.mock('../productBarcodes', () => ({
  upsertProductBarcode: vi.fn(async () => ({ created: true })),
}));

import {
  startSyncEngine,
  stopSyncEngine,
  getPendingQueueCount,
  isSyncInProgress,
} from '../syncEngine';
import { enqueueSale, getPendingQueue, clearOfflineData } from '../offlineDB';

beforeEach(async () => {
  await clearOfflineData();
  rpcMock.mockReset();
  fromMock.mockClear();
});

afterEach(async () => {
  // Espera a que termine el ciclo en vuelo (el flag syncInProgress es de módulo).
  const start = Date.now();
  while (Date.now() - start < 3000 && isSyncInProgress()) {
    await new Promise((r) => setTimeout(r, 25));
  }
  stopSyncEngine();
});

/** Espera a que el engine termine un ciclo de sync. */
const waitFor = async (predicate: () => boolean | Promise<boolean>, timeout = 4000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

describe('syncEngine', () => {
  it('expone el conteo de la cola pendiente', async () => {
    expect(await getPendingQueueCount()).toBe(0);
    await enqueueSale({ salePayload: { total_amount: 100 }, cart: [] }, 'u');
    expect(await getPendingQueueCount()).toBe(1);
  });

  it('sincroniza una venta offline pasando ticket, idempotencia y detalle de pago', async () => {
    rpcMock.mockResolvedValue({ data: [{ sale_id: 'sale-1', receipt_number: '0001-00000042' }], error: null });

    await enqueueSale(
      {
        salePayload: {
          total_amount: 1000,
          payment_method: 'transfer',
          transfer_bank: 'Galicia',
          transfer_account: 'alias-123',
          transfer_ref: 'REF99',
          customer_name: 'Ana',
          idempotency_key: 'op-key-1',
          receipt_number: null,
        },
        cart: [{ product_id: 'p1', quantity: 2, unit_price: 500, cost_price: 300 }],
      },
      'u'
    );

    startSyncEngine('u');
    const done = await waitFor(async () => (await getPendingQueue()).length === 0);
    expect(done).toBe(true);

    expect(rpcMock).toHaveBeenCalled();
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe('create_sale');
    // Ticket asignado en el momento de sincronizar (no había red al encolar).
    expect(args.p_receipt_number).toBe('0001-00000042');
    // Idempotencia: la misma clave en cada reintento.
    expect(args.p_idempotency_key).toBe('op-key-1');
    // Detalle de pago preservado (antes se perdía).
    expect(args.p_payment).toMatchObject({
      method: 'transfer',
      transfer_bank: 'Galicia',
      transfer_account: 'alias-123',
      transfer_ref: 'REF99',
    });
    // Ítems con sus precios.
    expect(args.p_items).toEqual([
      { product_id: 'p1', quantity: 2, unit_price: 500, cost_price: 300 },
    ]);
  });

  it('un fallo NO bloquea el resto de la cola', async () => {
    // La primera venta falla, la segunda debe sincronizarse igual.
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: [{ sale_id: 'sale-2' }], error: null });

    await enqueueSale({ salePayload: { total_amount: 100, idempotency_key: 'k1' }, cart: [] }, 'u');
    await enqueueSale({ salePayload: { total_amount: 200, idempotency_key: 'k2' }, cart: [] }, 'u');

    startSyncEngine('u');
    const settled = await waitFor(async () => {
      const pending = await getPendingQueue();
      return pending.length <= 1;
    });
    expect(settled).toBe(true);

    // La que falló sigue en cola (con reintentos) y la otra ya salió.
    const pending = await getPendingQueue();
    expect(pending).toHaveLength(1);
    expect(pending[0].retries).toBeGreaterThan(0);
  });

  it('un tipo desconocido NO se marca como sincronizado', async () => {
    await enqueueSale({ salePayload: {} }, 'u');
    // Forzamos un tipo inválido en la cola.
    const { getOfflineDB } = await import('../offlineDB');
    const db = await getOfflineDB();
    const all = await db.getAll('sales_queue');
    await db.put('sales_queue', { ...all[0], type: 'desconocido' });

    startSyncEngine('u');
    await new Promise((r) => setTimeout(r, 400));

    const pending = await getPendingQueue();
    expect(pending).toHaveLength(1);
  });
});
