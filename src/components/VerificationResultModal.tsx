import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  XCircle,
  Scan,
  Check,
  X,
  Clock,
  PlusCircle,
  ArrowRight,
  Database,
  ExternalLink,
  Lock,
  Download
} from 'lucide-react';
import { VerificationResult } from '../types';

interface VerificationResultModalProps {
  result: VerificationResult;
  onClose: () => void;
  onScanAnother: () => void;
  onRegisterUnregistered: (prefill: {
    productName: string;
    productId: string;
    manufacturer: string;
    batchNumber: string;
  }) => void;
}

export const VerificationResultModal: React.FC<VerificationResultModalProps> = ({
  result,
  onClose,
  onScanAnother,
  onRegisterUnregistered
}) => {
  const isGenuine = result.status === 'GENUINE';
  const isFakeMismatch = result.status === 'FAKE_MISMATCH';
  const isUnregistered = result.status === 'UNREGISTERED';
  const isInvalidQr = result.status === 'INVALID_QR';
  const isAmbiguous = result.status === 'AMBIGUOUS_RECORD';

  useEffect(() => {
    if (isGenuine) {
      try {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch {
        // Confetti unavailable
      }
    }
  }, [isGenuine]);

  // Color schemes based on status
  const theme = isGenuine
    ? {
        border: 'border-emerald-500/50',
        glow: 'shadow-[0_0_50px_rgba(16,185,129,0.2)]',
        badgeBg: 'bg-emerald-950/80',
        badgeText: 'text-emerald-400',
        badgeBorder: 'border-emerald-700/80',
        headerBg: 'from-emerald-950/60 to-slate-900',
        icon: ShieldCheck,
        iconColor: 'text-emerald-400',
        title: 'GENUINE PRODUCT',
        subtitle: 'Authentic Specimen Confirmed'
      }
    : isFakeMismatch
    ? {
        border: 'border-rose-500/60',
        glow: 'shadow-[0_0_50px_rgba(244,63,94,0.25)]',
        badgeBg: 'bg-rose-950/80',
        badgeText: 'text-rose-400',
        badgeBorder: 'border-rose-700/80',
        headerBg: 'from-rose-950/70 to-slate-900',
        icon: ShieldX,
        iconColor: 'text-rose-500',
        title: 'FAKE / INVALID PRODUCT',
        subtitle: 'Counterfeit / Tamper Alert'
      }
    : isUnregistered
    ? {
        border: 'border-amber-500/50',
        glow: 'shadow-[0_0_50px_rgba(245,158,11,0.2)]',
        badgeBg: 'bg-amber-950/80',
        badgeText: 'text-amber-400',
        badgeBorder: 'border-amber-700/80',
        headerBg: 'from-amber-950/60 to-slate-900',
        icon: ShieldAlert,
        iconColor: 'text-amber-400',
        title: 'UNREGISTERED PRODUCT',
        subtitle: 'Product ID Not In Authorized Dataset'
      }
    : {
        border: 'border-slate-700',
        glow: 'shadow-2xl',
        badgeBg: 'bg-slate-800',
        badgeText: 'text-slate-300',
        badgeBorder: 'border-slate-600',
        headerBg: 'from-slate-800 to-slate-900',
        icon: ShieldAlert,
        iconColor: 'text-slate-400',
        title: result.title,
        subtitle: 'Malformed QR Payload'
      };

  const StatusIcon = theme.icon;

  const exportResultReport = () => {
    const report = {
      scanId: result.id,
      timestamp: result.timestamp,
      verificationResult: result.status,
      scannedData: result.scanned,
      registeredRecord: result.registeredRecord,
      fieldComparisons: result.fieldComparisons,
      mismatchedFields: result.mismatchedFields
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SmartQR_Verification_${result.scanned.productId || 'unknown'}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div
        className={`relative w-full max-w-2xl rounded-2xl bg-slate-900 border ${theme.border} ${theme.glow} shadow-2xl overflow-hidden text-slate-100 my-8`}
      >
        {/* Top Header Banner */}
        <div className={`p-6 sm:p-8 bg-gradient-to-b ${theme.headerBg} border-b border-slate-800`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={`w-14 h-14 rounded-2xl ${theme.badgeBg} border ${theme.badgeBorder} flex items-center justify-center shrink-0 shadow-lg`}
              >
                <StatusIcon className={`w-8 h-8 ${theme.iconColor}`} />
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-950/80 text-slate-300 border border-slate-700/80 mb-1">
                  <span>Audit Timestamp:</span>
                  <span className="font-mono text-cyan-400">
                    {new Date(result.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  {theme.title}
                </h2>
                <p className="text-xs text-slate-300 mt-0.5 font-medium">
                  {result.message}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {/* Section 8 Field-by-Field Exact Comparison Matrix */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-cyan-400" />
                Deterministic Field-by-Field Audit Matrix
              </h3>
              <span className="text-[11px] text-slate-400">
                Candidate ID:{' '}
                <strong className="text-white font-mono">
                  {result.scanned.productId || 'N/A'}
                </strong>
              </span>
            </div>

            {result.fieldComparisons.length > 0 ? (
              <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                      <th className="py-2.5 px-3.5 font-semibold">Parameter</th>
                      <th className="py-2.5 px-3.5 font-semibold">Scanned QR Data</th>
                      <th className="py-2.5 px-3.5 font-semibold">Authorized Local Registry</th>
                      <th className="py-2.5 px-3.5 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {result.fieldComparisons.map((c) => (
                      <tr
                        key={c.field}
                        className={c.matched ? 'bg-slate-950/40' : 'bg-rose-950/20'}
                      >
                        <td className="py-2.5 px-3.5 font-semibold text-slate-300">
                          {c.label}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono text-slate-200">
                          {c.scannedValue || '—'}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono text-slate-300">
                          {c.registeredValue || '—'}
                        </td>
                        <td className="py-2.5 px-3.5 text-center">
                          {c.matched ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                              <Check className="w-3 h-3" /> MATCH
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-800">
                              <X className="w-3 h-3" /> MISMATCH
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400">
                No field matrix could be generated due to malformed payload syntax.
              </div>
            )}
          </div>

          {/* Tamper Explanation or Unregistered Action */}
          {isFakeMismatch && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/60 space-y-2">
              <h4 className="text-xs font-bold text-rose-300 flex items-center gap-2">
                <ShieldX className="w-4 h-4 text-rose-400" />
                Cryptographic / Dataset Inconsistency Summary
              </h4>
              <p className="text-xs text-rose-200/90 leading-relaxed">
                The Product ID <strong>"{result.scanned.productId}"</strong> exists in your local authorized registry, but the QR code encodes altered parameters:{' '}
                <span className="font-semibold text-rose-300 underline">
                  {result.mismatchedFields.join(', ')}
                </span>
                . This indicates unauthorized relabeling or batch falsification.
              </p>
            </div>
          )}

          {isUnregistered && result.scanned.productId && (
            <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/60 space-y-3">
              <h4 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Unregistered Product Handling Policy
              </h4>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                Product ID <strong>"{result.scanned.productId}"</strong> is not recognized in your local database. By engineering specification, scanning does not auto-register new products. You can register it through a deliberate authorization workflow below if you are the system administrator.
              </p>
              <button
                onClick={() => {
                  onClose();
                  onRegisterUnregistered({
                    productName: result.scanned.productName || '',
                    productId: result.scanned.productId || '',
                    manufacturer: result.scanned.manufacturer || '',
                    batchNumber: result.scanned.batchNumber || ''
                  });
                }}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold text-slate-950 transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Open Explicit Registration Form</span>
              </button>
            </div>
          )}

          {/* Raw Payload Inspection */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
              Raw ESP32 QR Payload Decoded:
            </span>
            <p className="font-mono text-xs text-cyan-300/90 break-all select-all">
              {result.scanned.rawText || 'Empty payload'}
            </p>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-5 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={exportResultReport}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 transition"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export Verification JSON</span>
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
            >
              Done
            </button>
            <button
              onClick={() => {
                onClose();
                onScanAnother();
              }}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-xs font-bold text-white shadow-lg shadow-cyan-600/30 transition"
            >
              <Scan className="w-4 h-4" />
              <span>Scan Another Product</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
