import React, { useState } from 'react';
import {
  History,
  Search,
  FileDown,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Filter,
  Calendar,
  Eye,
  X,
  Clock,
  ArrowUpDown
} from 'lucide-react';
import { ScanHistoryEntry, VerificationStatus } from '../types';

interface ScanHistoryProps {
  history: ScanHistoryEntry[];
  onClearHistory: () => Promise<void>;
  onExportCsv: () => void;
  onExportJson: () => void;
}

export const ScanHistory: React.FC<ScanHistoryProps> = ({
  history,
  onClearHistory,
  onExportCsv,
  onExportJson
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | VerificationStatus>('ALL');
  const [selectedEntry, setSelectedEntry] = useState<ScanHistoryEntry | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Filter history
  const filteredHistory = history.filter((item) => {
    // Status filter
    if (statusFilter !== 'ALL' && item.status !== statusFilter) {
      return false;
    }

    // Search query
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;

    return (
      item.productId.toLowerCase().includes(q) ||
      item.productName.toLowerCase().includes(q) ||
      item.manufacturer.toLowerCase().includes(q) ||
      item.batchNumber.toLowerCase().includes(q) ||
      item.rawText.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header & Export Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">Scan Verification Audit Log</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Persistent local record of all authenticated and intercepted scans.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onExportCsv}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
          >
            <FileDown className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={onExportJson}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
          >
            <FileDown className="w-3.5 h-3.5 text-sky-400" />
            <span>Export JSON</span>
          </button>
          {history.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-xs font-semibold text-slate-400 hover:text-rose-400 border border-slate-700 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Log</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Product ID, Name, Manufacturer, or Batch..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
          />
        </div>

        {/* Status Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
          {(['ALL', 'GENUINE', 'FAKE_MISMATCH', 'UNREGISTERED', 'INVALID_QR'] as const).map(
            (status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border transition ${
                  statusFilter === status
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {status === 'ALL'
                  ? `All (${history.length})`
                  : status === 'FAKE_MISMATCH'
                  ? 'Tampered / Fake'
                  : status.replace('_', ' ')}
              </button>
            )
          )}
        </div>
      </div>

      {/* History Items Table */}
      {filteredHistory.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                  <th className="py-3 px-4 font-semibold">Timestamp</th>
                  <th className="py-3 px-4 font-semibold">Verification Result</th>
                  <th className="py-3 px-4 font-semibold">Product ID</th>
                  <th className="py-3 px-4 font-semibold">Product Name</th>
                  <th className="py-3 px-4 font-semibold">Manufacturer</th>
                  <th className="py-3 px-4 font-semibold">Batch</th>
                  <th className="py-3 px-4 font-semibold text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredHistory.map((item) => {
                  const isGen = item.status === 'GENUINE';
                  const isFake = item.status === 'FAKE_MISMATCH';
                  const isUnreg = item.status === 'UNREGISTERED';

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-800/40 transition-colors group"
                    >
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        {new Date(item.timestamp).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            isGen
                              ? 'bg-emerald-950/80 text-emerald-400 border-emerald-700/80'
                              : isFake
                              ? 'bg-rose-950/80 text-rose-400 border-rose-700/80'
                              : isUnreg
                              ? 'bg-amber-950/80 text-amber-400 border-amber-700/80'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {isGen && <ShieldCheck className="w-3.5 h-3.5" />}
                          {isFake && <ShieldX className="w-3.5 h-3.5" />}
                          {isUnreg && <ShieldAlert className="w-3.5 h-3.5" />}
                          <span>{item.status.replace('_', ' ')}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-cyan-300">
                        {item.productId || 'N/A'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-white">
                        {item.productName || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {item.manufacturer || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {item.batchNumber || '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setSelectedEntry(item)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-950/60 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>
              Showing {filteredHistory.length} of {history.length} logged scans
            </span>
            <span className="text-slate-400">Section 10 Audit Store</span>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
          <History className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Scan Records Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {searchQuery || statusFilter !== 'ALL'
              ? 'No history entries matched the active filters.'
              : 'Scan product QR codes using the in-app scanner to record authentication audit logs.'}
          </p>
        </div>
      )}

      {/* History Detail Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                Scan Audit Entry
              </h3>
              <button
                onClick={() => setSelectedEntry(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400">Verification Outcome:</span>
                <span
                  className={`font-bold px-2.5 py-0.5 rounded-full text-[11px] ${
                    selectedEntry.status === 'GENUINE'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {selectedEntry.status.replace('_', ' ')}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider block">
                  Scanned Product Parameters:
                </span>
                <p><strong>Name:</strong> {selectedEntry.productName || '—'}</p>
                <p><strong>ID:</strong> <span className="font-mono text-cyan-300">{selectedEntry.productId || '—'}</span></p>
                <p><strong>Manufacturer:</strong> {selectedEntry.manufacturer || '—'}</p>
                <p><strong>Batch:</strong> <span className="font-mono">{selectedEntry.batchNumber || '—'}</span></p>
              </div>

              {selectedEntry.mismatchedFields.length > 0 && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 space-y-1">
                  <strong>Mismatched Fields:</strong>
                  <p>{selectedEntry.mismatchedFields.join(', ')}</p>
                </div>
              )}

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider block">
                  Raw Payload Captured:
                </span>
                <p className="font-mono text-cyan-300/90 break-all select-all">
                  {selectedEntry.rawText}
                </p>
              </div>

              <div className="text-[11px] text-slate-400">
                Timestamp: <span className="font-mono">{new Date(selectedEntry.timestamp).toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedEntry(null)}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-rose-800/80 p-6 shadow-2xl text-slate-100 space-y-4">
            <h3 className="text-base font-bold text-white">Clear Scan History?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              This will permanently delete all {history.length} audit entries from the local database.
            </p>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onClearHistory();
                  setShowClearConfirm(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition"
              >
                Wipe History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
