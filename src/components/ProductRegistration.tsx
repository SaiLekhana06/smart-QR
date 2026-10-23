import React, { useState } from 'react';
import {
  PlusCircle,
  Database,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  QrCode,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { ProductRecord } from '../types';
import { formatEsp32Payload } from '../services/qrParser';

interface ProductRegistrationProps {
  initialValues?: Partial<ProductRecord>;
  onRegister: (product: ProductRecord) => Promise<void>;
  onSuccessNavigate: () => void;
}

export const ProductRegistration: React.FC<ProductRegistrationProps> = ({
  initialValues,
  onRegister,
  onSuccessNavigate
}) => {
  const [productName, setProductName] = useState(initialValues?.productName || '');
  const [productId, setProductId] = useState(initialValues?.productId || '');
  const [manufacturer, setManufacturer] = useState(initialValues?.manufacturer || '');
  const [batchNumber, setBatchNumber] = useState(initialValues?.batchNumber || '');
  const [notes, setNotes] = useState(initialValues?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const previewPayload = formatEsp32Payload({
    productName: productName || 'Product Name',
    productId: productId || 'ID',
    manufacturer: manufacturer || 'Manufacturer',
    batchNumber: batchNumber || 'Batch'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    try {
      if (!productName.trim() || !productId.trim() || !manufacturer.trim() || !batchNumber.trim()) {
        setError('All 4 parameters (Product Name, Product ID, Manufacturer, Batch Number) are required.');
        return;
      }

      const record: ProductRecord = {
        productName: productName.trim(),
        productId: productId.trim(),
        manufacturer: manufacturer.trim(),
        batchNumber: batchNumber.trim(),
        notes: notes.trim(),
        registeredAt: new Date().toISOString()
      };

      await onRegister(record);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(previewPayload);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <PlusCircle className="w-5 h-5 text-cyan-400" />
          Register Authorized Product
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Add an authentic product specification to the local database. When scanned, products matching these 4 parameters will be certified as GENUINE.
        </p>
      </div>

      {/* Form Container */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-xl space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Product ID */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Product ID * <span className="text-slate-400 font-normal">(Unique Master Key)</span>
              </label>
              <input
                type="text"
                required
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                placeholder="e.g. SB001, SS002, SC003"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono font-bold text-cyan-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>

            {/* Product Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Product Name *
              </label>
              <input
                type="text"
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Smart Battery"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>

            {/* Manufacturer */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Manufacturer Name *
              </label>
              <input
                type="text"
                required
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="e.g. ABC Electronics"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>

            {/* Batch Number */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Batch Number *
              </label>
              <input
                type="text"
                required
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g. B001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Engineering / Verification Notes <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Authorized batch produced for B.Tech demonstration."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Notification */}
          {success && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 space-y-2">
              <div className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Product Successfully Registered into Local Database!</span>
              </div>
              <p className="text-[11px] text-emerald-300/80">
                Product ID <strong>"{productId}"</strong> is now an authorized reference record. Any scan with these parameters will be authenticated as GENUINE.
              </p>
              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onSuccessNavigate}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
                >
                  <span>View in Product Registry</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex justify-end gap-3">
            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-xs font-bold text-white shadow-lg shadow-cyan-600/30 transition flex items-center justify-center gap-2"
            >
              <Database className="w-4 h-4" />
              <span>Save to Authorized Registry</span>
            </button>
          </div>
        </form>

        {/* ESP32 QR Payload Preview Box */}
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <QrCode className="w-3.5 h-3.5 text-cyan-400" />
              Expected ESP32 QR Output Payload:
            </span>
            <button
              onClick={handleCopyPayload}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              {copiedPayload ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy Payload</span>
                </>
              )}
            </button>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-cyan-300 break-all select-all">
            {previewPayload}
          </div>
          <p className="text-[11px] text-slate-400">
            This string matches the format generated by the ESP32 firmware when submitted via the ESP32 web dashboard.
          </p>
        </div>
      </div>
    </div>
  );
};
