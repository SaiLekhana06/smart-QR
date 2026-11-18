import { ProductRecord, ScanHistoryEntry, DatasetStats } from '../types';

const DB_NAME = 'SmartQrLocalDb';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_HISTORY = 'scan_history';

export const INITIAL_SAMPLE_PRODUCTS: ProductRecord[] = [
  {
    productName: 'Smart Battery',
    productId: 'SB001',
    manufacturer: 'ABC Electronics',
    batchNumber: 'B001',
    registeredAt: '2026-10-01T08:00:00.000Z',
    notes: 'Primary reference lithium battery pack - authorized batch.'
  },
  {
    productName: 'Smart Sensor',
    productId: 'SS002',
    manufacturer: 'XYZ Electronics',
    batchNumber: 'B002',
    registeredAt: '2026-10-05T09:30:00.000Z',
    notes: 'Industrial IoT environmental telemetry sensor.'
  },
  {
    productName: 'Smart Controller',
    productId: 'SC003',
    manufacturer: 'Tech Solutions',
    batchNumber: 'B003',
    registeredAt: '2026-10-10T14:15:00.000Z',
    notes: 'ARM Cortex embedded telemetry master controller.'
  }
];

class SmartQrDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this environment.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
          const productStore = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'productId' });
          productStore.createIndex('productName', 'productName', { unique: false });
          productStore.createIndex('manufacturer', 'manufacturer', { unique: false });
          productStore.createIndex('batchNumber', 'batchNumber', { unique: false });

          // Seed default sample products on first creation
          INITIAL_SAMPLE_PRODUCTS.forEach((prod) => {
            productStore.add(prod);
          });
        }

        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const historyStore = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
          historyStore.createIndex('status', 'status', { unique: false });
          historyStore.createIndex('productId', 'productId', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  // --- PRODUCTS REPOSITORY ---

  async getAllProducts(): Promise<ProductRecord[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const store = tx.objectStore(STORE_PRODUCTS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getProductById(productId: string): Promise<ProductRecord | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const store = tx.objectStore(STORE_PRODUCTS);
      const req = store.get(productId.trim());
      req.onsuccess = () => resolve(req.result || undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async searchProducts(query: string): Promise<ProductRecord[]> {
    const all = await this.getAllProducts();
    const q = query.trim().toLowerCase();
    if (!q) return all;

    return all.filter(
      (p) =>
        p.productId.toLowerCase().includes(q) ||
        p.productName.toLowerCase().includes(q) ||
        p.manufacturer.toLowerCase().includes(q) ||
        p.batchNumber.toLowerCase().includes(q)
    );
  }

  async addProduct(record: ProductRecord): Promise<void> {
    const normalized: ProductRecord = {
      productId: record.productId.trim(),
      productName: record.productName.trim(),
      manufacturer: record.manufacturer.trim(),
      batchNumber: record.batchNumber.trim(),
      registeredAt: record.registeredAt || new Date().toISOString(),
      notes: record.notes?.trim() || ''
    };

    if (!normalized.productId || !normalized.productName || !normalized.manufacturer || !normalized.batchNumber) {
      throw new Error('All four fields (Product Name, Product ID, Manufacturer, Batch Number) are required.');
    }

    const existing = await this.getProductById(normalized.productId);
    if (existing) {
      throw new Error(`Product with ID "${normalized.productId}" is already registered. IDs must be unique.`);
    }

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTS);
      const req = store.add(normalized);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async updateProduct(record: ProductRecord): Promise<void> {
    const normalized: ProductRecord = {
      productId: record.productId.trim(),
      productName: record.productName.trim(),
      manufacturer: record.manufacturer.trim(),
      batchNumber: record.batchNumber.trim(),
      registeredAt: record.registeredAt || new Date().toISOString(),
      notes: record.notes?.trim() || ''
    };

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTS);
      const req = store.put(normalized);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteProduct(productId: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTS);
      const req = store.delete(productId.trim());
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clearAllProducts(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTS);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async resetToSampleDataset(): Promise<void> {
    await this.clearAllProducts();
    for (const prod of INITIAL_SAMPLE_PRODUCTS) {
      await this.addProduct(prod);
    }
  }

  async importProductsFromJson(
    jsonContent: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<{ imported: number; skippedDuplicates: number; invalidCount: number; errors: string[] }> {
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(jsonContent);
    } catch {
      throw new Error('Invalid JSON format. Please upload a valid JSON array of product records.');
    }

    if (!Array.isArray(parsedData)) {
      throw new Error('Root JSON element must be an array of product objects.');
    }

    if (mode === 'replace') {
      await this.clearAllProducts();
    }

    const currentMap = new Map<string, ProductRecord>();
    if (mode === 'merge') {
      const current = await this.getAllProducts();
      current.forEach((p) => currentMap.set(p.productId.toLowerCase(), p));
    }

    let imported = 0;
    let skippedDuplicates = 0;
    let invalidCount = 0;
    const errors: string[] = [];

    const db = await this.open();
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    const store = tx.objectStore(STORE_PRODUCTS);

    for (let i = 0; i < parsedData.length; i++) {
      const item = parsedData[i] as Record<string, unknown>;
      const productName = String(item.productName || item.product || item.name || '').trim();
      const productId = String(item.productId || item.id || '').trim();
      const manufacturer = String(item.manufacturer || item.mfr || item.mfg || '').trim();
      const batchNumber = String(item.batchNumber || item.batch || '').trim();

      if (!productName || !productId || !manufacturer || !batchNumber) {
        invalidCount++;
        errors.push(`Record #${i + 1} is missing required fields (Name, ID, Manufacturer, or Batch).`);
        continue;
      }

      if (currentMap.has(productId.toLowerCase())) {
        skippedDuplicates++;
        continue;
      }

      const newRecord: ProductRecord = {
        productId,
        productName,
        manufacturer,
        batchNumber,
        registeredAt: item.registeredAt ? String(item.registeredAt) : new Date().toISOString(),
        notes: item.notes ? String(item.notes) : ''
      };

      store.put(newRecord);
      currentMap.set(productId.toLowerCase(), newRecord);
      imported++;
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return { imported, skippedDuplicates, invalidCount, errors };
  }

  async exportProductsAsJson(): Promise<string> {
    const products = await this.getAllProducts();
    return JSON.stringify(products, null, 2);
  }

  // --- SCAN HISTORY REPOSITORY ---

  async getAllHistory(): Promise<ScanHistoryEntry[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readonly');
      const store = tx.objectStore(STORE_HISTORY);
      const req = store.getAll();
      req.onsuccess = () => {
        const results = (req.result || []) as ScanHistoryEntry[];
        results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async addHistoryEntry(entry: ScanHistoryEntry): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      const req = store.add(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clearHistory(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async exportHistoryAsCsv(): Promise<string> {
    const history = await this.getAllHistory();
    const headers = [
      'Timestamp',
      'Status',
      'Product ID',
      'Product Name',
      'Manufacturer',
      'Batch Number',
      'Mismatched Fields',
      'Raw QR Payload'
    ];
    const rows = history.map((h) => [
      `"${h.timestamp}"`,
      `"${h.status}"`,
      `"${h.productId.replace(/"/g, '""')}"`,
      `"${h.productName.replace(/"/g, '""')}"`,
      `"${h.manufacturer.replace(/"/g, '""')}"`,
      `"${h.batchNumber.replace(/"/g, '""')}"`,
      `"${h.mismatchedFields.join('; ')}"`,
      `"${h.rawText.replace(/"/g, '""')}"`
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  async exportHistoryAsJson(): Promise<string> {
    const history = await this.getAllHistory();
    return JSON.stringify(history, null, 2);
  }

  // --- STATS COMPUTATION ---

  async getStats(): Promise<DatasetStats> {
    const products = await this.getAllProducts();
    const history = await this.getAllHistory();

    let genuineCount = 0;
    let fakeMismatchCount = 0;
    let unregisteredCount = 0;
    let invalidQrCount = 0;
    let ambiguousCount = 0;

    for (const h of history) {
      if (h.status === 'GENUINE') genuineCount++;
      else if (h.status === 'FAKE_MISMATCH') fakeMismatchCount++;
      else if (h.status === 'UNREGISTERED') unregisteredCount++;
      else if (h.status === 'INVALID_QR') invalidQrCount++;
      else if (h.status === 'AMBIGUOUS_RECORD') ambiguousCount++;
    }

    return {
      totalRegistered: products.length,
      totalScans: history.length,
      genuineCount,
      fakeMismatchCount,
      unregisteredCount,
      invalidQrCount,
      ambiguousCount,
      lastScanTimestamp: history.length > 0 ? history[0].timestamp : null
    };
  }
}

export const localDb = new SmartQrDatabase();
