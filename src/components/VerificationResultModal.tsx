import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  XCircle,
  Scan,
  Clock,
  Calendar,
  AlertTriangle,
  History,
  BellRing,
  Download
} from 'lucide-react';
import { VerificationResult } from '../types';

interface VerificationResultModalProps {
  result: VerificationResult;
  onClose: () => void;
  onScanAnother: () => void;
}

export const VerificationResultModal: React.FC<VerificationResultModalProps> = ({
  result,
  onClose,
  onScanAnother
}) => {
  const isGenuine = result.status === 'GENUINE';
  const isFakeMismatch = result.status === 'FAKE_MISMATCH';
  const isUnregistered = result.status === 'UNREGISTERED';

  const qrScanHistory = result.qrScanHistory || [];
  const qrScanCount = result.qrScanCount ?? qrScanHistory.length;
  const hasMultipleScans = (isGenuine || isFakeMismatch) && qrScanCount > 1;

  const [showDuplicatePopup, setShowDuplicatePopup] = useState<boolean>(hasMultipleScans);

  useEffect(() => {
    setShowDuplicatePopup(hasMultipleScans);
  }, [result.id, hasMultipleScans]);

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
  }, [isGenuine, result.id]);

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
        title: 'GENUINE PRODUCT'
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
        title: 'FAKE PRODUCT'
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
        title: 'This product is not developed by us'
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
        title: result.title
      };

  const StatusIcon = theme.icon;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const exportResultReport = () => {
    const report = {
      scanId: result.id,
      timestamp: result.timestamp,
      verificationResult: result.status,
      verdictTitle: theme.title,
      productId: result.scanned.productId || null,
      qrScanCount,
      qrScanHistory: qrScanHistory.map((h) => ({
        timestamp: h.timestamp,
        status: h.status
      }))
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
                <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-950/80 text-slate-300 border border-slate-700/80 mb-1.5">
                  <span>{formatDate(result.timestamp)}</span>
                  <span className="text-slate-600">•</span>
                  <span className="font-mono text-cyan-400">
                    {formatTime(result.timestamp)}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  {theme.title}
                </h2>
                <p className="text-xs text-slate-300 mt-1 font-medium">
                  {result.message}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              aria-label="Close modal"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body — Strictly NO Complete Product Details */}
        <div className="p-6 space-y-5">
          {/* Verdict Summary Card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                Verification Outcome
              </span>
              <span
                className={`mt-1 inline-block text-sm font-black ${
                  isGenuine
                    ? 'text-emerald-400'
                    : isFakeMismatch
                    ? 'text-rose-400'
                    : isUnregistered
                    ? 'text-amber-400'
                    : 'text-slate-300'
                }`}
              >
                {theme.title}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                QR Product ID
              </span>
              <span className="mt-1 inline-block font-mono text-sm font-bold text-cyan-300">
                {result.scanned.productId || 'N/A'}
              </span>
            </div>
          </div>

          {/* Persistent Multiple Scan Banner when scanned > 1 time */}
          {hasMultipleScans && (
            <div className="p-4 rounded-xl bg-amber-950/35 border border-amber-600/60 flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <BellRing className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-300">
                    Multiple Scan Notice: Scanned {qrScanCount} Times
                  </h4>
                  <p className="text-[11px] text-amber-200/85 mt-0.5">
                    This QR code has been scanned {qrScanCount} times. Review the scan timestamps below.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDuplicatePopup(true)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-[11px] font-bold text-amber-300 transition"
              >
                View Alert
              </button>
            </div>
          )}

          {/* Unregistered Product Notice */}
          {isUnregistered && (
            <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/60 space-y-2">
              <h4 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Unrecognized Product ID
              </h4>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                This product is not developed by us. The scanned Product ID does not exist in our authorized product registry.
              </p>
            </div>
          )}

          {/* Fake Product Summary */}
          {isFakeMismatch && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/60 space-y-2">
              <h4 className="text-xs font-bold text-rose-300 flex items-center gap-2">
                <ShieldX className="w-4 h-4 text-rose-400" />
                Verification Failed
              </h4>
              <p className="text-xs text-rose-200/90 leading-relaxed">
                All 3 batch verification chances were exhausted without a valid batch number match. This product is flagged as <strong>FAKE</strong>.
              </p>
            </div>
          )}

          {/* Particular QR Scan History (Date & Time) */}
          {(isGenuine || isFakeMismatch) && qrScanHistory.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-cyan-400" />
                  Scan History for This QR
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-cyan-300 border border-slate-700">
                  Total Scans: {qrScanCount}
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950 max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3.5 font-semibold">Scan #</th>
                      <th className="py-2.5 px-3.5 font-semibold">Date</th>
                      <th className="py-2.5 px-3.5 font-semibold">Time</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {qrScanHistory.map((entry, index) => {
                      const scanNumber = qrScanHistory.length - index;
                      const entryGenuine = entry.status === 'GENUINE';
                      return (
                        <tr
                          key={entry.id}
                          className={index === 0 ? 'bg-cyan-950/20' : 'bg-slate-950/40'}
                        >
                          <td className="py-2.5 px-3.5 font-mono text-slate-300 font-semibold">
                            #{scanNumber}
                            {index === 0 && (
                              <span className="ml-1.5 text-[10px] text-cyan-400 font-sans">
                                (Current)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-200 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              {formatDate(entry.timestamp)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-slate-300 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {formatTime(entry.timestamp)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                entryGenuine
                                  ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                                  : 'bg-rose-950 text-rose-400 border-rose-800'
                              }`}
                            >
                              {entryGenuine ? 'GENUINE' : 'FAKE'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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

      {/* Popup Notification when QR is scanned more than 1 time */}
      {showDuplicatePopup && hasMultipleScans && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border-2 border-amber-500/80 shadow-[0_0_60px_rgba(245,158,11,0.3)] overflow-hidden text-slate-100">
            <div className="p-5 bg-gradient-to-r from-amber-950/90 to-slate-900 border-b border-amber-700/50 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/60 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-400 block">
                    Duplicate / Multiple Scan Notification
                  </span>
                  <h3 className="text-lg font-black text-white">
                    Scanned {qrScanCount} Times!
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setShowDuplicatePopup(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition"
                aria-label="Dismiss alert"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-700/50 text-xs text-amber-100 leading-relaxed">
                This QR code (Product ID:{' '}
                <strong className="font-mono text-amber-300">
                  {result.scanned.productId}
                </strong>
                ) has now been scanned{' '}
                <strong className="text-white underline">{qrScanCount} times</strong>.
                If you did not perform all previous scans, this QR label may have been duplicated.
              </div>

              <div className="space-y-2">
                <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-amber-400" />
                  Complete Scanning History ({qrScanCount} Scans)
                </h4>
                <div className="rounded-xl border border-slate-800 bg-slate-950 max-h-52 overflow-y-auto divide-y divide-slate-800/70">
                  {qrScanHistory.map((entry, idx) => {
                    const scanNum = qrScanHistory.length - idx;
                    const entryGenuine = entry.status === 'GENUINE';
                    return (
                      <div
                        key={entry.id}
                        className="px-3.5 py-2.5 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-bold text-amber-300">
                            #{scanNum}
                          </span>
                          <div>
                            <div className="text-slate-200 font-medium">
                              {formatDate(entry.timestamp)}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {formatTime(entry.timestamp)}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            entryGenuine
                              ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                              : 'bg-rose-950 text-rose-400 border-rose-800'
                          }`}
                        >
                          {entryGenuine ? 'GENUINE' : 'FAKE'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowDuplicatePopup(false)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-extrabold text-slate-950 transition shadow-lg shadow-amber-500/20"
              >
                Acknowledge & View Result
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
