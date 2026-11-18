import React, { useEffect, useState } from 'react';
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
  X,
  Eye,
  Printer,
  ShieldOff,
  ShieldCheck,
  Lock,
  Cpu,
  Send,
  AlertCircle
} from 'lucide-react';
import {
  Esp32Status,
  PrintLogEntry,
  ProductRecord,
  QrGenerationJob,
  QrGenerationStatus
} from '../types';
import { api } from '../services/api';

interface ProductDatabaseProps {
  isAdmin: boolean;
  products: ProductRecord[];
  onAdminLogin: (username: string, password: string) => Promise<void>;
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
  onRefresh: () => Promise<void>;
}

function formatJobBadge(status?: QrGenerationStatus | null): {
  label: string;
  classes: string;
} {
  switch (status) {
    case 'COMPLETED':
      return {
        label: 'ESP32 Printed',
        classes: 'bg-emerald-950 text-emerald-300 border-emerald-800'
      };
    case 'IN_PROGRESS':
      return {
        label: 'ESP32 Printing',
        classes: 'bg-cyan-950 text-cyan-300 border-cyan-800'
      };
    case 'DISPATCHING':
      return {
        label: 'Sending Payload',
        classes: 'bg-sky-950 text-sky-300 border-sky-800'
      };
    case 'PENDING':
      return {
        label: 'Waiting for ESP32',
        classes: 'bg-amber-950 text-amber-300 border-amber-800'
      };
    case 'FAILED':
      return {
        label: 'ESP32 Failed',
        classes: 'bg-rose-950 text-rose-300 border-rose-800'
      };
    default:
      return {
        label: 'Not Queued',
        classes: 'bg-slate-950 text-slate-400 border-slate-700'
      };
  }
}

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({
  isAdmin,
  products,
  onAdminLogin,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onImportJson,
  onExportJson,
  onResetSampleData,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [selectedJob, setSelectedJob] = useState<QrGenerationJob | null>(null);
  const [jobActionBusy, setJobActionBusy] = useState(false);
  const [jobActionMessage, setJobActionMessage] = useState<string | null>(null);
  const [esp32Status, setEsp32Status] = useState<Esp32Status | null>(null);

  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPrintLogs, setShowPrintLogs] = useState(false);
  const [printLogs, setPrintLogs] = useState<PrintLogEntry[]>([]);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importResult, setImportResult] = useState<{
    imported: number;
    skippedDuplicates: number;
    invalidCount: number;
    errors: string[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const st = await api.getEsp32Status();
        if (!cancelled) setEsp32Status(st);
      } catch {
        // Ignore transient failure
      }
    };
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedProduct || !selectedJob) return;
    if (selectedJob.status === 'COMPLETED' || selectedJob.status === 'FAILED') return;
    let cancelled = false;

    const pollJob = async () => {
      try {
        const updated = await api.getQrJobStatus(selectedJob.jobId);
        if (!cancelled) {
          setSelectedJob(updated);
          if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
            await onRefresh();
          }
        }
      } catch {
        // Ignore transient polling error
      }
    };

    const timer = setInterval(pollJob, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAdmin, selectedProduct, selectedJob?.jobId, selectedJob?.status, onRefresh]);

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <Lock className="w-5 h-5 text-cyan-400" />
          <span>Administrator Authentication Required</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          To keep registered batch numbers, manufacturing dates, and ESP32 QR generation jobs confidential from customers, Product Registry access requires Admin sign-in.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setLoginErr(null);
            try {
              await onAdminLogin(loginUser, loginPass);
            } catch (err) {
              setLoginErr(err instanceof Error ? err.message : 'Login failed');
            }
          }}
          className="space-y-3 text-xs"
        >
          <input
            type="text"
            required
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
            placeholder="Admin username"
            className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
          />
          <input
            type="password"
            required
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
            placeholder="Password"
            className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
          />
          {loginErr && (
            <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300">
              {loginErr}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition"
          >
            Sign In to Product Registry
          </button>
        </form>
      </div>
    );
  }

  const filteredProducts = products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.productId.toLowerCase().includes(q) ||
      p.productName.toLowerCase().includes(q) ||
      p.manufacturer.toLowerCase().includes(q) ||
      p.batchNumber.toLowerCase().includes(q) ||
      (p.qrId || '').toLowerCase().includes(q) ||
      (p.qrJobId || '').toLowerCase().includes(q)
    );
  });

  const openDetailsModal = async (product: ProductRecord) => {
    setSelectedProduct(product);
    setJobActionMessage(null);
    if (product.qrJobId) {
      try {
        const job = await api.getQrJobStatus(product.qrJobId);
        setSelectedJob(job);
      } catch {
        setSelectedJob({
          jobId: product.qrJobId,
          qrId: product.qrId || '',
          productId: product.productId,
          status: product.qrJobStatus || 'PENDING',
          deviceId: product.qrJobDeviceId,
          errorMessage: product.qrJobError,
          completedAt: product.qrJobCompletedAt ?? undefined,
          updatedAt: product.qrJobUpdatedAt ?? undefined
        });
      }
    } else {
      setSelectedJob(null);
    }
  };

  const handleQueueEsp32 = async (productId: string, forceNew = false) => {
    setJobActionBusy(true);
    setJobActionMessage(null);
    try {
      const res = await api.requestQrGeneration(productId, forceNew);
      setSelectedJob(res.job);
      setJobActionMessage(
        res.alreadyQueued
          ? `Job ${res.job.jobId} is already queued for ESP32.`
          : `Queued ESP32 job ${res.job.jobId} (status: ${res.job.status}).`
      );
      await onRefresh();
    } catch (err) {
      setJobActionMessage(err instanceof Error ? err.message : 'Failed to queue ESP32 job.');
    } finally {
      setJobActionBusy(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setJobActionBusy(true);
    setJobActionMessage(null);
    try {
      const res = await api.retryQrJob(jobId);
      setSelectedJob(res.job);
      setJobActionMessage(`Re-queued replacement job ${res.job.jobId} for ESP32.`);
      await onRefresh();
    } catch (err) {
      setJobActionMessage(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setJobActionBusy(false);
    }
  };

  const handleToggleQrStatus = async (qrId: string, currentStatus?: 'active' | 'revoked') => {
    const next = currentStatus === 'revoked' ? 'active' : 'revoked';
    await api.setQrStatus(qrId, next);
    if (selectedProduct && selectedProduct.qrId === qrId) {
      setSelectedProduct({ ...selectedProduct, qrStatus: next });
    }
    await onRefresh();
  };

  const openPrintLogsModal = async () => {
    const logs = await api.getPrintLogs();
    setPrintLogs(logs);
    setShowPrintLogs(true);
  };

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
      setImportText(event.target?.result as string);
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
            Backend master product records, ESP32 QR generation queue status, revocation controls, and thermal print logs.
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
            onClick={openPrintLogsModal}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
          >
            <Printer className="w-3.5 h-3.5 text-cyan-400" />
            <span>Print Logs</span>
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
            title="Restore sample products if missing"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <RefreshCw className="w-4 h-4 text-emerald-400" />
          </button>
        </div>
      </div>

      {/* Live ESP32 Personal Hotspot Connection Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
        <div className="flex items-center gap-2.5">
          <Cpu
            className={`w-4 h-4 ${
              esp32Status?.esp32Connected
                ? 'text-emerald-400'
                : esp32Status?.bridgeConnected
                ? 'text-amber-400'
                : 'text-slate-500'
            }`}
          />
          <span className="font-semibold text-white">ESP32 Personal Hotspot:</span>
          <span
            className={`font-mono ${
              esp32Status?.esp32Connected
                ? 'text-emerald-400'
                : esp32Status?.bridgeConnected
                ? 'text-amber-300'
                : 'text-slate-400'
            }`}
          >
            {esp32Status?.esp32Connected
              ? `Connected (${esp32Status.hotspotUrl || 'Wi-Fi HTTP'})`
              : esp32Status?.bridgeConnected
              ? 'Wi-Fi Bridge Online — Waiting for ESP32 Hotspot'
              : 'Offline (Connect to ESP32 hotspot & run Wi-Fi bridge)'}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
          <span>Pending: {esp32Status?.pendingJobs ?? 0}</span>
          <span>Active: {esp32Status?.inProgressJobs ?? 0}</span>
          <span>Printed: {esp32Status?.completedJobs ?? 0}</span>
        </div>
      </div>

      {/* Search Input Filter */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by Product ID (SB001), QR ID (QR-...), Job ID, Name, Manufacturer, or Batch..."
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
                  <th className="py-3 px-4 font-semibold">Batch & Mfg Date</th>
                  <th className="py-3 px-4 font-semibold">QR ID & Status</th>
                  <th className="py-3 px-4 font-semibold">ESP32 Job Status</th>
                  <th className="py-3 px-4 font-semibold">Verifications</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredProducts.map((p) => {
                  const jobBadge = formatJobBadge(p.qrJobStatus);
                  return (
                    <tr
                      key={p.productId}
                      className="hover:bg-slate-800/40 transition-colors group"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-cyan-400">
                        {p.productId}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-white block">{p.productName}</span>
                        <span className="text-[11px] text-slate-400">{p.manufacturer}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-slate-200 block">{p.batchNumber}</span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {p.manufacturingDate}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-cyan-300 block">{p.qrId || '—'}</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase mt-0.5 ${
                            p.qrStatus === 'revoked'
                              ? 'bg-rose-950 text-rose-400 border border-rose-800'
                              : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          }`}
                        >
                          {p.qrStatus || 'active'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${jobBadge.classes}`}
                        >
                          {jobBadge.label}
                        </span>
                        {p.qrJobId && (
                          <span className="block font-mono text-[10px] text-slate-400 mt-0.5">
                            {p.qrJobId}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-300">
                        {p.successfulVerifications ?? 0} ok / {p.totalScanAttempts ?? 0} attempts
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openDetailsModal(p)}
                            title="Inspect ESP32 QR Job & Product Details"
                            className="p-1.5 rounded-lg text-slate-300 hover:text-cyan-400 hover:bg-slate-800 transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleQueueEsp32(p.productId, false)}
                            title="Send / Queue to ESP32"
                            className="p-1.5 rounded-lg text-slate-300 hover:text-emerald-400 hover:bg-slate-800 transition"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                          {p.qrId && (
                            <button
                              onClick={() => handleToggleQrStatus(p.qrId!, p.qrStatus)}
                              title={p.qrStatus === 'revoked' ? 'Reactivate QR' : 'Revoke QR'}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                            >
                              {p.qrStatus === 'revoked' ? (
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <ShieldOff className="w-3.5 h-3.5 text-amber-400" />
                              )}
                            </button>
                          )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-950/60 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>
              Showing {filteredProducts.length} of {products.length} registered products
            </span>
            <span className="font-mono text-cyan-500">SQLite Server Registry • ESP32 Hardware QR</span>
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
        </div>
      )}

      {/* Product & ESP32 QR Job Details Modal (NO QR IMAGE RENDERING) */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-5 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block">
                  Product & ESP32 Hardware QR Job Status
                </span>
                <h3 className="text-base font-bold text-white">
                  {selectedProduct.productName} ({selectedProduct.productId})
                </h3>
              </div>
              <button
                onClick={() => {
                  setSelectedProduct(null);
                  setSelectedJob(null);
                  setJobActionMessage(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">QR ID</span>
                <span className="font-mono text-cyan-300 font-bold">
                  {selectedProduct.qrId || '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">QR Status</span>
                <span
                  className={`font-bold uppercase ${
                    selectedProduct.qrStatus === 'revoked' ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {selectedProduct.qrStatus || 'active'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Manufacturer</span>
                <span className="text-slate-200">{selectedProduct.manufacturer}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Mfg Date / Batch</span>
                <span className="font-mono text-slate-200">
                  {selectedProduct.manufacturingDate} • {selectedProduct.batchNumber}
                </span>
              </div>
            </div>

            {/* ESP32 Hardware Job Card */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  ESP32 Hardware QR Generation
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    formatJobBadge(selectedJob?.status || selectedProduct.qrJobStatus).classes
                  }`}
                >
                  {formatJobBadge(selectedJob?.status || selectedProduct.qrJobStatus).label}
                </span>
              </div>

              {selectedJob ? (
                <div className="space-y-1.5 text-[11px] text-slate-300">
                  <div>
                    Job ID: <strong className="font-mono text-white">{selectedJob.jobId}</strong>
                  </div>
                  {selectedJob.deviceId && (
                    <div>
                      Device: <span className="font-mono text-cyan-300">{selectedJob.deviceId}</span>
                    </div>
                  )}
                  {selectedJob.completedAt && (
                    <div>
                      Printed At:{' '}
                      <span className="font-mono">
                        {new Date(selectedJob.completedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {selectedJob.errorMessage && (
                    <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{selectedJob.errorMessage}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  No ESP32 print job has been queued for this product yet. Click &quot;Queue ESP32 Print&quot; to send the signed payload to the connected ESP32.
                </p>
              )}

              <p className="text-[10px] text-slate-500">
                QR codes are generated, displayed on the 0.96&quot; OLED, and printed on the TTL thermal printer exclusively by the ESP32 hardware.
              </p>
            </div>

            {selectedProduct.qrPayload && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-xs">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider block">
                  Signed Payload String (HMAC-SHA256 — No Batch Embedded)
                </span>
                <p className="font-mono text-[11px] text-cyan-300 break-all select-all">
                  {selectedProduct.qrPayload}
                </p>
              </div>
            )}

            {jobActionMessage && (
              <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-800 text-xs text-cyan-200">
                {jobActionMessage}
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs">
              {selectedJob?.status === 'FAILED' ? (
                <button
                  disabled={jobActionBusy}
                  onClick={() => handleRetryJob(selectedJob.jobId)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 font-bold text-white"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry ESP32 Job</span>
                </button>
              ) : (
                <button
                  disabled={jobActionBusy}
                  onClick={() => handleQueueEsp32(selectedProduct.productId, false)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 font-bold text-white"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Queue ESP32 Print</span>
                </button>
              )}

              <button
                disabled={jobActionBusy}
                onClick={() => handleQueueEsp32(selectedProduct.productId, true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 font-semibold text-slate-200 border border-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                <span>Issue New QR to ESP32</span>
              </button>
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-slate-800">
              {selectedProduct.qrId && (
                <button
                  onClick={() => handleToggleQrStatus(selectedProduct.qrId!, selectedProduct.qrStatus)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                    selectedProduct.qrStatus === 'revoked'
                      ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                      : 'bg-amber-700 hover:bg-amber-600 text-white'
                  }`}
                >
                  {selectedProduct.qrStatus === 'revoked' ? 'Reactivate QR Code' : 'Revoke QR Code'}
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedProduct(null);
                  setSelectedJob(null);
                  setJobActionMessage(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white transition ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Logs Modal */}
      {showPrintLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Printer className="w-4 h-4 text-cyan-400" />
                ESP32 Hardware Print Logs
              </h3>
              <button
                onClick={() => setShowPrintLogs(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 rounded-xl border border-slate-800 bg-slate-950">
              {printLogs.length > 0 ? (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-slate-400 border-b border-slate-800">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">QR ID</th>
                      <th className="py-2.5 px-3">Product</th>
                      <th className="py-2.5 px-3">Output / Status</th>
                      <th className="py-2.5 px-3">Device / Operator</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {printLogs.map((pl) => (
                      <tr key={pl.id}>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                          {new Date(pl.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 font-mono text-cyan-300">{pl.qrId}</td>
                        <td className="py-2 px-3 text-white">
                          {pl.productId} ({pl.productName})
                        </td>
                        <td className="py-2 px-3 font-mono text-emerald-400">
                          {pl.format} • {pl.printStatus}
                        </td>
                        <td className="py-2 px-3 text-slate-300">{pl.operatorName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  No ESP32 thermal print confirmations recorded yet.
                </div>
              )}
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
                <label className="block text-slate-300 font-semibold mb-1">Product Name *</label>
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
                <label className="block text-slate-300 font-semibold mb-1">Manufacturer *</label>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Batch Number *</label>
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
                  <label className="block text-slate-300 font-semibold mb-1">Mfg Date *</label>
                  <input
                    type="date"
                    required
                    value={editingProduct.manufacturingDate}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, manufacturingDate: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editingProduct.notes || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white"
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
            <h3 className="text-base font-bold text-white">Delete Product Record?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Delete Product ID <strong className="text-rose-400 font-mono">{showDeleteConfirm}</strong> and its signed QR codes?
            </p>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onDeleteProduct(showDeleteConfirm);
                  setShowDeleteConfirm(null);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white"
              >
                Delete
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

            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="accent-cyan-500"
                />
                <span>Merge (Add new records)</span>
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

            <textarea
              rows={5}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='[{"productName":"Smart Battery","productId":"SB010","manufacturer":"ABC Electronics","batchNumber":"B010","manufacturingDate":"2026-11-01"}]'
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />

            {importError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300">
                {importError}
              </div>
            )}

            {importResult && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Import Completed</span>
                </div>
                <p>
                  Imported: <strong>{importResult.imported}</strong> | Skipped: <strong>{importResult.skippedDuplicates}</strong> | Invalid: <strong>{importResult.invalidCount}</strong>
                </p>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Close
              </button>
              <button
                type="button"
                onClick={executeImport}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white"
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
