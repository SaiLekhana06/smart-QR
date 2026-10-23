import React, { useState } from 'react';
import {
  Database,
  Search,
  PlusCircle,
  FileDown,
  FileUp,
  Trash2,
  Edit3,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  X,
  Eye,
  Info,
  Calendar,
  Layers,
  Building,
  Tag
} from 'lucide-react';
import { ProductRecord } from '../types';

interface ProductDatabaseProps {
  products: ProductRecord[];
  onAddProduct: () => void;
  onUpdateProduct: (product: ProductRecord) => Promise<void>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onImportJson: (jsonStr: string, mode: 'merge' | 'replace') => Promise<{
    imported: number;
    skippedDuplicates: number;
    invalidCount: number;
    errors: string[];
  }>;
  onExportJson: () => void;
  onResetSampleData: () => Promise<void>;
  onClearAll: () => Promise<void>;
}

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({
  products,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onImportJson,
  onExportJson,
  onResetSampleData,
  onClearAll
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importResult, setImportResult] = useState<{
    imported: number;
    skippedDuplicates: number;
    invalidCount: number;
    errors: string[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Search filtering across all 4 parameters
  const filteredProducts = products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.productId.toLowerCase().includes(q) ||
      p.productName.toLowerCase().includes(q) ||
      p.manufacturer.toLowerCase().includes(q) ||
      p.batchNumber.toLowerCase().includes(q)
    );
  });

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    await onUpdateProduct(editingProduct);
    setEditingProduct(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportText(content);
    };
    reader.readAsText(file);
  };

  const executeImport = async () => {
    setImportError(null);
    setImportResult(null);
    try {
      if (!importText.trim()) {
        setImportError('Please select a JSON file or paste JSON data into the text area.');
        return;
      }
      const res = await onImportJson(importText, importMode);
      setImportResult(res);
      setImportText('');
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">Authorized Product Registry</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Locally stored master records used by the verification engine for exact matching.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onAddProduct}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white shadow-sm transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Register Product</span>
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
          >
            <FileDown className="w-3.5 h-3.5 text-cyan-400" />
            <span>Import JSON</span>
          </button>
          <button
            onClick={onExportJson}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
          >
            <FileUp className="w-3.5 h-3.5 text-sky-400" />
            <span>Export Dataset</span>
          </button>
          <button
            onClick={onResetSampleData}
            title="Reload default 3 sample products"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <RefreshCw className="w-4 h-4 text-emerald-400" />
          </button>
          <button
            onClick={() => setShowClearConfirm(true)}
            title="Clear all records"
            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-700 transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input Filter */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by Product ID (e.g. SB001), Name, Manufacturer, or Batch..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Table of Records */}
      {filteredProducts.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                  <th className="py-3 px-4 font-semibold">Product ID</th>
                  <th className="py-3 px-4 font-semibold">Product Name</th>
                  <th className="py-3 px-4 font-semibold">Manufacturer</th>
                  <th className="py-3 px-4 font-semibold">Batch No</th>
                  <th className="py-3 px-4 font-semibold">Registered</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredProducts.map((p) => (
                  <tr
                    key={p.productId}
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-cyan-400">
                      {p.productId}
                    </td>
                    <td className="py-3 px-4 font-semibold text-white">
                      {p.productName}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {p.manufacturer}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {p.batchNumber}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      {p.registeredAt
                        ? new Date(p.registeredAt).toLocaleDateString()
                        : 'System Initial'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setSelectedProduct(p)}
                          title="View Details"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingProduct({ ...p })}
                          title="Edit"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(p.productId)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-950/60 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>
              Showing {filteredProducts.length} of {products.length} registered products
            </span>
            <span className="font-mono text-cyan-500">IndexedDB: SmartQrLocalDb</span>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
          <Database className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Matching Products</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {searchQuery
              ? `No records matched query "${searchQuery}".`
              : 'The registered product dataset is currently empty.'}
          </p>
          <div className="pt-2 flex items-center justify-center gap-2">
            <button
              onClick={onResetSampleData}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition"
            >
              Restore B.Tech Sample Dataset
            </button>
            <button
              onClick={onAddProduct}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
            >
              Add Product Manually
            </button>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block">
                  Authorized Record
                </span>
                <h3 className="text-base font-bold text-white">
                  {selectedProduct.productName}
                </h3>
              </div>
              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider block">
                  Product ID (Primary Key)
                </span>
                <span className="font-mono font-bold text-cyan-300 text-sm">
                  {selectedProduct.productId}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider block">
                    Manufacturer
                  </span>
                  <span className="font-semibold text-slate-200">
                    {selectedProduct.manufacturer}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider block">
                    Batch Number
                  </span>
                  <span className="font-mono font-semibold text-slate-200">
                    {selectedProduct.batchNumber}
                  </span>
                </div>
              </div>

              {selectedProduct.notes && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider block">
                    Engineering / Lab Notes
                  </span>
                  <p className="text-slate-300">{selectedProduct.notes}</p>
                </div>
              )}

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400">
                <span>Registered on: </span>
                <span className="font-mono text-slate-300">
                  {selectedProduct.registeredAt
                    ? new Date(selectedProduct.registeredAt).toLocaleString()
                    : 'System Default'}
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditingProduct({ ...selectedProduct });
                  setSelectedProduct(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
              >
                Edit Record
              </button>
              <button
                onClick={() => setSelectedProduct(null)}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Record Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-cyan-400" />
                Edit Authorized Record ({editingProduct.productId})
              </h3>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">
                  Product ID (Fixed Primary Key)
                </label>
                <input
                  type="text"
                  disabled
                  value={editingProduct.productId}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={editingProduct.productName}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, productName: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Manufacturer *
                </label>
                <input
                  type="text"
                  required
                  value={editingProduct.manufacturer}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, manufacturer: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Batch Number *
                </label>
                <input
                  type="text"
                  required
                  value={editingProduct.batchNumber}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, batchNumber: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={editingProduct.notes || ''}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, notes: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Record Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-rose-800/80 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-rose-950 border border-rose-800 text-rose-400 flex items-center justify-center">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Delete Product Record?</h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Are you sure you want to delete Product ID{' '}
                <strong className="text-rose-400 font-mono">{showDeleteConfirm}</strong>?
                Scans of this product will now return <strong>UNREGISTERED PRODUCT</strong>.
              </p>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onDeleteProduct(showDeleteConfirm);
                  setShowDeleteConfirm(null);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-rose-800/80 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-rose-950 border border-rose-800 text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Clear All Products?</h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                This will purge all {products.length} registered products from the local device database. You can restore the sample products anytime.
              </p>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onClearAll();
                  setShowClearConfirm(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition"
              >
                Wipe Dataset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON Dataset Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileDown className="w-4 h-4 text-cyan-400" />
                Import JSON Product Dataset
              </h3>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportResult(null);
                  setImportError(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Upload a <code className="text-cyan-400">.json</code> file or paste a JSON array of product objects. All 4 parameters (<code className="text-slate-200">productName</code>, <code className="text-slate-200">productId</code>, <code className="text-slate-200">manufacturer</code>, <code className="text-slate-200">batchNumber</code>) are mandatory per record.
            </p>

            {/* Mode Selector */}
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="accent-cyan-500"
                />
                <span>Merge (Keep existing, add new IDs)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="accent-rose-500"
                />
                <span className="text-rose-400">Replace entire dataset</span>
              </label>
            </div>

            {/* File Picker */}
            <div>
              <label className="w-full py-3 px-4 rounded-xl border border-dashed border-slate-700 hover:border-cyan-500/80 bg-slate-950 flex items-center justify-center gap-2 text-xs text-slate-300 cursor-pointer transition">
                <FileDown className="w-4 h-4 text-cyan-400" />
                <span>Select .json file from device</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Text Area */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                Or Paste JSON Content:
              </label>
              <textarea
                rows={6}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='[&#10;  {&#10;    "productName": "Smart Battery",&#10;    "productId": "SB001",&#10;    "manufacturer": "ABC Electronics",&#10;    "batchNumber": "B001"&#10;  }&#10;]'
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Error & Success Reports */}
            {importError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300">
                {importError}
              </div>
            )}

            {importResult && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Import Successful</span>
                </div>
                <p>
                  Imported: <strong>{importResult.imported}</strong> records | Skipped duplicate IDs: <strong>{importResult.skippedDuplicates}</strong> | Invalid records rejected: <strong>{importResult.invalidCount}</strong>
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="list-disc pl-4 mt-1 text-[11px] text-amber-300">
                    {importResult.errors.map((e, idx) => (
                      <li key={idx}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportResult(null);
                  setImportError(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={executeImport}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition shadow-sm"
              >
                Execute Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
