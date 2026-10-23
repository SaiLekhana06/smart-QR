import React, { useState, useEffect, useCallback } from 'react';
import { ProductRecord, ScanHistoryEntry, DatasetStats, VerificationResult } from './types';
import { localDb, INITIAL_SAMPLE_PRODUCTS } from './services/db';
import { verifyProductPayload } from './services/verificationEngine';
import { Navigation, ActiveTab } from './components/Navigation';
import { Dashboard } from './components/Dashboard';
import { Scanner } from './components/Scanner';
import { VerificationResultModal } from './components/VerificationResultModal';
import { ProductDatabase } from './components/ProductDatabase';
import { ProductRegistration } from './components/ProductRegistration';
import { ScanHistory } from './components/ScanHistory';
import { TestSuiteView } from './components/TestSuiteView';
import { SecurityAnalysisView } from './components/SecurityAnalysisView';
import { AndroidCodeExporterView } from './components/AndroidCodeExporterView';
import { WifiOff, AlertCircle } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [stats, setStats] = useState<DatasetStats>({
    totalRegistered: 0,
    totalScans: 0,
    genuineCount: 0,
    fakeMismatchCount: 0,
    unregisteredCount: 0,
    invalidQrCount: 0,
    ambiguousCount: 0,
    lastScanTimestamp: null
  });
  const [activeResult, setActiveResult] = useState<VerificationResult | null>(null);
  const [prefilledRegister, setPrefilledRegister] = useState<Partial<ProductRecord> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load state from IndexedDB
  const refreshData = useCallback(async () => {
    try {
      const [prods, hist, st] = await Promise.all([
        localDb.getAllProducts(),
        localDb.getAllHistory(),
        localDb.getStats()
      ]);
      setProducts(prods);
      setHistory(hist);
      setStats(st);
    } catch (err) {
      console.error('Failed to query local database:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();

    // Register Service Worker for offline capability if supported
    if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'development') {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration:', err);
      });
    }
  }, [refreshData]);

  // Execute verification on a scanned QR payload
  const handleScanSuccess = async (rawPayload: string) => {
    try {
      const result = await verifyProductPayload(rawPayload);
      setActiveResult(result);

      // Save deliberate scan into local audit log
      const historyEntry: ScanHistoryEntry = {
        id: result.id,
        timestamp: result.timestamp,
        rawText: rawPayload,
        productName: result.scanned.productName || 'Unknown Product',
        productId: result.scanned.productId || 'UNKNOWN_ID',
        manufacturer: result.scanned.manufacturer || 'Unknown',
        batchNumber: result.scanned.batchNumber || 'Unknown',
        status: result.status,
        mismatchedFields: result.mismatchedFields,
        registeredProductId: result.registeredRecord?.productId
      };

      await localDb.addHistoryEntry(historyEntry);
      await refreshData();
    } catch (err) {
      console.error('Verification error:', err);
    }
  };

  // Reset to default 3 sample products
  const handleResetSampleData = async () => {
    await localDb.resetToSampleDataset();
    await refreshData();
  };

  // Clear all registered products
  const handleClearAllProducts = async () => {
    await localDb.clearAllProducts();
    await refreshData();
  };

  // Update an existing product
  const handleUpdateProduct = async (prod: ProductRecord) => {
    await localDb.updateProduct(prod);
    await refreshData();
  };

  // Delete a product
  const handleDeleteProduct = async (id: string) => {
    await localDb.deleteProduct(id);
    await refreshData();
  };

  // Add a manual product
  const handleRegisterProduct = async (prod: ProductRecord) => {
    await localDb.addProduct(prod);
    await refreshData();
  };

  // JSON Import
  const handleImportJson = async (jsonStr: string, mode: 'merge' | 'replace') => {
    const res = await localDb.importProductsFromJson(jsonStr, mode);
    await refreshData();
    return res;
  };

  // JSON Export
  const handleExportJson = async () => {
    const jsonStr = await localDb.exportProductsAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SmartQR_Authorized_Dataset_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clear history
  const handleClearHistory = async () => {
    await localDb.clearHistory();
    await refreshData();
  };

  // Export history CSV
  const handleExportHistoryCsv = async () => {
    const csvStr = await localDb.exportHistoryAsCsv();
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SmartQR_Scan_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export history JSON
  const handleExportHistoryJson = async () => {
    const jsonStr = await localDb.exportHistoryAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SmartQR_Scan_Audit_Log_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header & Tab Navigation */}
      <Navigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        registeredCount={products.length}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {isLoading ? (
          <div className="py-24 text-center space-y-4">
            <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400 font-mono tracking-wider">
              INITIALIZING LOCAL INDEXEDDB DATASET...
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <Dashboard
                stats={stats}
                recentScan={history.length > 0 ? history[0] : null}
                onNavigate={setActiveTab}
                onResetSampleData={handleResetSampleData}
                onQuickSimulate={handleScanSuccess}
              />
            )}

            {activeTab === 'scanner' && (
              <Scanner
                onScanSuccess={handleScanSuccess}
                onCancel={() => setActiveTab('dashboard')}
              />
            )}

            {activeTab === 'database' && (
              <ProductDatabase
                products={products}
                onAddProduct={() => {
                  setPrefilledRegister(null);
                  setActiveTab('register');
                }}
                onUpdateProduct={handleUpdateProduct}
                onDeleteProduct={handleDeleteProduct}
                onImportJson={handleImportJson}
                onExportJson={handleExportJson}
                onResetSampleData={handleResetSampleData}
                onClearAll={handleClearAllProducts}
              />
            )}

            {activeTab === 'register' && (
              <ProductRegistration
                initialValues={prefilledRegister || undefined}
                onRegister={handleRegisterProduct}
                onSuccessNavigate={() => {
                  setPrefilledRegister(null);
                  setActiveTab('database');
                }}
              />
            )}

            {activeTab === 'history' && (
              <ScanHistory
                history={history}
                onClearHistory={handleClearHistory}
                onExportCsv={handleExportHistoryCsv}
                onExportJson={handleExportHistoryJson}
              />
            )}

            {activeTab === 'testsuite' && <TestSuiteView />}

            {activeTab === 'security' && <SecurityAnalysisView />}

            {activeTab === 'android_code' && <AndroidCodeExporterView />}
          </>
        )}
      </main>

      {/* Verification Result Modal / Screen */}
      {activeResult && (
        <VerificationResultModal
          result={activeResult}
          onClose={() => setActiveResult(null)}
          onScanAnother={() => {
            setActiveResult(null);
            setActiveTab('scanner');
          }}
          onRegisterUnregistered={(prefill) => {
            setPrefilledRegister(prefill);
            setActiveTab('register');
          }}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>
            SmartQR • Design & Development of a Smart QR Code Printing System
          </p>
          <p className="text-[11px] text-slate-400">
            B.Tech Final Year Engineering Project • Offline-First Architecture
          </p>
        </div>
      </footer>
    </div>
  );
}
