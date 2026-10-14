import { openDB } from 'idb';

const dbPromise = openDB<any>('dietetica-offline', 1, {
  upgrade(db) {
    // Products store
    const products = db.createObjectStore('products', { keyPath: 'id' });
    products.createIndex('by-barcode', 'barcode');
    products.createIndex('by-category', 'category');
    products.createIndex('by-name', 'name');

    // Sales queue store
    const salesQueue = db.createObjectStore('sales_queue', { keyPath: 'id', autoIncrement: true });
    salesQueue.createIndex('by-synced', 'synced');
    salesQueue.createIndex('by-type', 'type');

    // Customers store
    const customers = db.createObjectStore('customers', { keyPath: 'id' });
    customers.createIndex('by-name', 'name');

    // Settings store
    db.createObjectStore('settings', { keyPath: 'key' });

    // Sync metadata
    db.createObjectStore('sync_metadata', { keyPath: 'key' });
  },
});

export function getOfflineDB() {
  return dbPromise;
}

// Products cache
export async function cacheProducts(products: any[]) {
  const db = await getOfflineDB();
  const tx = db.transaction('products', 'readwrite');
  const now = Date.now();
  for (const p of products) {
    await tx.store.put({ ...p, updated_at: now });
  }
  await tx.done;
}

export async function getCachedProducts(): Promise<any[]> {
  const db = await getOfflineDB();
  return db.getAll('products');
}

export async function getCachedProductByBarcode(barcode: string): Promise<any | undefined> {
  const db = await getOfflineDB();
  return db.getFromIndex('products', 'by-barcode', barcode);
}

export async function getCachedProductById(id: string): Promise<any | undefined> {
  const db = await getOfflineDB();
  return db.get('products', id);
}

// Sales queue
export async function enqueueSale(payload: any) {
  const db = await getOfflineDB();
  await db.add('sales_queue', {
    type: 'sale',
    payload,
    created_at: Date.now(),
    retries: 0,
    synced: false,
  } as any);
  await updatePendingCount();
}

export async function enqueueStockAdjustment(payload: any) {
  const db = await getOfflineDB();
  await db.add('sales_queue', {
    type: 'stock_adjustment',
    payload,
    created_at: Date.now(),
    retries: 0,
    synced: false,
  } as any);
  await updatePendingCount();
}

export async function enqueueProductCreate(payload: any) {
  const db = await getOfflineDB();
  await db.add('sales_queue', {
    type: 'product_create',
    payload,
    created_at: Date.now(),
    retries: 0,
    synced: false,
  } as any);
  await updatePendingCount();
}

export async function enqueueProductUpdate(payload: any) {
  const db = await getOfflineDB();
  await db.add('sales_queue', {
    type: 'product_update',
    payload,
    created_at: Date.now(),
    retries: 0,
    synced: false,
  } as any);
  await updatePendingCount();
}

async function updatePendingCount() {
  const db = await getOfflineDB();
  const all = await db.getAll('sales_queue');
  const count = all.filter((item: any) => !item.synced).length;
  await db.put('sync_metadata', { key: 'pending', last_sync: 0, pending_count: count });
}

export async function getPendingQueue(): Promise<any[]> {
  const db = await getOfflineDB();
  const all = await db.getAll('sales_queue');
  return all.filter((item: any) => !item.synced);
}

export async function markQueueItemSynced(id: number) {
  const db = await getOfflineDB();
  const item = await db.get('sales_queue', id);
  if (item) {
    item.synced = true;
    await db.put('sales_queue', item);
    await updatePendingCount();
  }
}

export async function incrementQueueRetries(id: number) {
  const db = await getOfflineDB();
  const item = await db.get('sales_queue', id);
  if (item) {
    item.retries += 1;
    await db.put('sales_queue', item);
  }
}

export async function getPendingCount(): Promise<number> {
  const db = await getOfflineDB();
  const meta = await db.get('sync_metadata', 'pending');
  return meta?.pending_count || 0;
}

// Customers cache
export async function cacheCustomers(customers: any[]) {
  const db = await getOfflineDB();
  const tx = db.transaction('customers', 'readwrite');
  const now = Date.now();
  for (const c of customers) {
    await tx.store.put({ ...c, updated_at: now });
  }
  await tx.done;
}

export async function getCachedCustomers(): Promise<any[]> {
  const db = await getOfflineDB();
  return db.getAll('customers');
}

// Settings
export async function setSetting(key: string, value: any) {
  const db = await getOfflineDB();
  await db.put('settings', { key, value, updated_at: Date.now() });
}

export async function getSetting(key: string): Promise<any> {
  const db = await getOfflineDB();
  const item = await db.get('settings', key);
  return item?.value;
}

// Sync metadata
export async function setLastSyncTime(time: number) {
  const db = await getOfflineDB();
  const all = await db.getAll('sales_queue');
  const count = all.filter((item: any) => !item.synced).length;
  await db.put('sync_metadata', { key: 'last_sync', last_sync: time, pending_count: count });
}

export async function getLastSyncTime(): Promise<number> {
  const db = await getOfflineDB();
  const meta = await db.get('sync_metadata', 'last_sync');
  return meta?.last_sync || 0;
}

// Clear all (logout)
export async function clearOfflineData() {
  const db = await getOfflineDB();
  await db.clear('products');
  await db.clear('sales_queue');
  await db.clear('customers');
  await db.clear('settings');
  await db.clear('sync_metadata');
}