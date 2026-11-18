import React, { useState, useRef, useEffect } from 'react';
import { ShieldCheck, KeyRound, AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import { MAX_BATCH_ATTEMPTS } from '../services/verificationEngine';

interface BatchChallengeModalProps {
  productId: string;
  onSubmitBatch: (batchNumber: string, attemptNumber: number) => Promise<boolean>;
  onCancel: () => void;
}

export const BatchChallengeModal: React.FC<BatchChallengeModalProps> = ({
  productId,
  onSubmitBatch,
  onCancel
}) => {
  const [batchInput, setBatchInput] = useState('');
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const remainingChances = MAX_BATCH_ATTEMPTS - attemptsUsed;

  useEffect(() => {
    inputRef.current?.focus();
  }, [attemptsUsed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = batchInput.trim();
    if (!trimmed || isChecking) return;

    const currentAttempt = attemptsUsed + 1;
    setIsChecking(true);
    setErrorMessage(null);

    try {
      const matched = await onSubmitBatch(trimmed, currentAttempt);
      if (!matched && currentAttempt < MAX_BATCH_ATTEMPTS) {
        const left = MAX_BATCH_ATTEMPTS - currentAttempt;
        setAttemptsUsed(currentAttempt);
        setBatchInput('');
        setErrorMessage(
          `Batch number does not match. Please re-enter carefully (${left} ${
            left === 1 ? 'chance' : 'chances'
          } remaining).`
        );
      }
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-cyan-500/40 shadow-[0_0_50px_rgba(6,182,212,0.18)] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="p-6 bg-gradient-to-b from-cyan-950/60 to-slate-900 border-b border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-cyan-950 border border-cyan-700/80 flex items-center justify-center shrink-0">
                <KeyRound className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 block">
                  Step 2 • Batch Verification
                </span>
                <h2 className="text-lg font-extrabold text-white">
                  Enter Batch Number
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              aria-label="Cancel verification"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">
              Scanned QR Product ID
            </span>
            <span className="font-mono text-sm font-bold text-cyan-300">
              {productId}
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            This Product ID is recognized in our system. Enter the{' '}
            <strong className="text-white">Batch Number</strong> printed on the product to verify whether it is genuine or fake.
          </p>

          {/* 3-Chance Progress Indicator */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold">
                Verification Chances Remaining
              </span>
              <span
                className={`font-mono font-bold ${
                  remainingChances === 1
                    ? 'text-rose-400'
                    : remainingChances === 2
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {remainingChances} / {MAX_BATCH_ATTEMPTS}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: MAX_BATCH_ATTEMPTS }).map((_, idx) => {
                const isFailed = idx < attemptsUsed;
                const isCurrent = idx === attemptsUsed;
                return (
                  <div
                    key={idx}
                    className={`h-2 rounded-full transition-all ${
                      isFailed
                        ? 'bg-rose-500'
                        : isCurrent
                        ? 'bg-cyan-400 animate-pulse'
                        : 'bg-slate-800'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Batch Number Input */}
          <div className="space-y-2">
            <label
              htmlFor="batch-challenge-input"
              className="block text-xs font-bold text-slate-300 uppercase tracking-wider"
            >
              Batch Number *
            </label>
            <input
              id="batch-challenge-input"
              ref={inputRef}
              type="text"
              required
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder="Enter batch number (case-sensitive)"
              className={`w-full px-4 py-3 rounded-xl bg-slate-950 border text-sm font-mono text-white placeholder-slate-600 focus:outline-none transition ${
                errorMessage
                  ? 'border-rose-500/80 focus:border-rose-400'
                  : 'border-slate-700 focus:border-cyan-500'
              }`}
            />
          </div>

          {/* Mismatch Error Feedback */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/80 text-xs text-rose-300 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!batchInput.trim() || isChecking}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 disabled:opacity-50 text-xs font-bold text-white shadow-lg shadow-cyan-600/30 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Verify Batch Number</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
