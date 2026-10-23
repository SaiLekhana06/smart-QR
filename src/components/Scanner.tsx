import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeCameraScanConfig, CameraDevice } from 'html5-qrcode';
import {
  Camera,
  Flashlight,
  FlashlightOff,
  RefreshCw,
  XCircle,
  AlertCircle,
  UploadCloud,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  ShieldAlert
} from 'lucide-react';

interface ScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onCancel: () => void;
}

export const Scanner: React.FC<ScannerProps> = ({ onScanSuccess, onCancel }) => {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [manualInput, setManualInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'smartqr-reader-container';

  // Haptic & Audio feedback
  const triggerFeedback = () => {
    try {
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([80, 50, 80]);
      }
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.16);
    } catch {
      // Audio or vibration unavailable
    }
  };

  const handleDecoded = (decodedText: string) => {
    if (isProcessing) return;
    setIsProcessing(true);
    triggerFeedback();

    // Stop scanner then callback
    if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current
        .stop()
        .then(() => {
          setIsScanning(false);
          onScanSuccess(decodedText);
        })
        .catch(() => {
          onScanSuccess(decodedText);
        });
    } else {
      onScanSuccess(decodedText);
    }
  };

  const startScanner = async (cameraIdToUse?: string) => {
    setCameraError(null);
    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerContainerId);
      }

      const scanner = scannerRef.current;
      if (scanner.isScanning) {
        await scanner.stop();
      }

      // Query devices if not loaded yet
      let devId = cameraIdToUse || selectedCameraId;
      if (!devId) {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          setCameras(devices);
          // Prefer back/environment camera
          const backCam = devices.find(
            (d) =>
              d.label.toLowerCase().includes('back') ||
              d.label.toLowerCase().includes('rear') ||
              d.label.toLowerCase().includes('environment')
          );
          devId = backCam ? backCam.id : devices[0].id;
          setSelectedCameraId(devId);
        } else {
          throw new Error('No camera devices detected on this device.');
        }
      }

      const config: Html5QrcodeCameraScanConfig = {
        fps: 15,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };

      await scanner.start(
        devId,
        config,
        (decodedText) => {
          handleDecoded(decodedText);
        },
        () => {
          // Frame error (no QR detected in frame) - standard scanner polling
        }
      );

      setIsScanning(true);

      // Check torch capability
      try {
        const capabilities = scanner.getRunningTrackCapabilities();
        if ('torch' in capabilities) {
          setTorchSupported(true);
        }
      } catch {
        setTorchSupported(false);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('Camera initialization note:', errorMsg);
      setCameraError(
        errorMsg.includes('Permission') || errorMsg.includes('NotAllowedError')
          ? 'Camera permission denied. Please grant camera access in browser settings to scan QR codes.'
          : `Camera notice: ${errorMsg}. You can also test with simulated ESP32 payloads below or upload an image.`
      );
      setIsScanning(false);
    }
  };

  const toggleTorch = async () => {
    if (!scannerRef.current || !torchSupported) return;
    try {
      const nextState = !torchOn;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: nextState }] as unknown as MediaTrackConstraintSet[]
      });
      setTorchOn(nextState);
    } catch (err) {
      console.warn('Torch toggle error:', err);
    }
  };

  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];
    setSelectedCameraId(nextCamera.id);
    await startScanner(nextCamera.id);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerContainerId);
      }
      const decoded = await scannerRef.current.scanFile(file, true);
      handleDecoded(decoded);
    } catch {
      setCameraError('No valid QR code could be decoded from the selected image file.');
    }
  };

  useEffect(() => {
    startScanner();

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Top Scanner Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Camera className="w-5 h-5 text-cyan-400" />
            Live Product QR Scanner
          </h2>
          <p className="text-xs text-slate-400">
            Align the ESP32 dashboard QR code or printed label within the target frame.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
        >
          <XCircle className="w-4 h-4 text-slate-400" />
          <span>Close</span>
        </button>
      </div>

      {/* Camera Viewport Container */}
      <div className="relative rounded-2xl overflow-hidden bg-slate-950 border-2 border-slate-800 shadow-2xl aspect-square max-w-md mx-auto flex items-center justify-center">
        {/* HTML5 QR code video container */}
        <div id={scannerContainerId} className="w-full h-full object-cover" />

        {/* High-tech Viewfinder HUD Overlay */}
        {isScanning && !cameraError && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Darkened mask around reticle */}
            <div className="relative w-64 h-64 border-2 border-cyan-400/80 rounded-2xl shadow-[0_0_25px_rgba(6,182,212,0.3)]">
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-cyan-400 rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-cyan-400 rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-cyan-400 rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-cyan-400 rounded-br-lg" />

              {/* Animated laser scan beam */}
              <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#38bdf8] animate-pulse top-1/2 -translate-y-1/2" />

              {/* Center crosshair */}
              <div className="absolute inset-0 flex items-center justify-center opacity-40">
                <div className="w-8 h-0.5 bg-cyan-400" />
                <div className="h-8 w-0.5 bg-cyan-400 -ml-4" />
              </div>

              <div className="absolute -bottom-8 left-0 right-0 text-center">
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-slate-900/90 text-cyan-300 border border-cyan-800/80 rounded-full tracking-wider">
                  AUTOFOCUS DETECTING...
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Camera Permission / Error Fallback Overlay */}
        {cameraError && (
          <div className="absolute inset-0 bg-slate-950/95 p-6 flex flex-col items-center justify-center text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Camera Notice</h3>
            <p className="text-xs text-slate-300 max-w-xs leading-relaxed">
              {cameraError}
            </p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button
                onClick={() => startScanner()}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Camera Permission</span>
              </button>
              <label className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition flex items-center justify-center gap-2 cursor-pointer">
                <UploadCloud className="w-4 h-4 text-cyan-400" />
                <span>Scan QR Image File</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {/* Processing State */}
        {isProcessing && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-bold text-cyan-300 font-mono tracking-wider">
              ANALYZING PAYLOAD & LOCAL DATASET...
            </span>
          </div>
        )}
      </div>

      {/* In-App Camera Controls */}
      <div className="flex items-center justify-center gap-3">
        {cameras.length > 1 && (
          <button
            onClick={switchCamera}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Switch Camera ({cameras.length})</span>
          </button>
        )}

        {torchSupported && (
          <button
            onClick={toggleTorch}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
              torchOn
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            {torchOn ? (
              <>
                <FlashlightOff className="w-3.5 h-3.5" />
                <span>Torch Off</span>
              </>
            ) : (
              <>
                <Flashlight className="w-3.5 h-3.5 text-amber-400" />
                <span>Torch On</span>
              </>
            )}
          </button>
        )}

        <label className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition cursor-pointer">
          <UploadCloud className="w-3.5 h-3.5 text-cyan-400" />
          <span>Scan Photo / File</span>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {/* Manual String Injection & Test Payloads for Engineering Demonstration */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Demo Test Payloads (ESP32 Raw Format)
          </h3>
          <span className="text-[10px] text-slate-400">Section 6 & 14 Compliance</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <button
            onClick={() =>
              handleDecoded(
                'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001'
              )
            }
            className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-850 border border-emerald-900/60 text-left transition flex items-center justify-between group"
          >
            <div>
              <span className="font-bold text-emerald-400 block">Genuine SB001</span>
              <span className="text-[10px] text-slate-400 truncate block">All 4 fields match registry</span>
            </div>
            <CheckCircle2 className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </button>

          <button
            onClick={() =>
              handleDecoded(
                'Product: Counterfeit Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001'
              )
            }
            className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-850 border border-rose-900/60 text-left transition flex items-center justify-between group"
          >
            <div>
              <span className="font-bold text-rose-400 block">Tampered Name</span>
              <span className="text-[10px] text-slate-400 truncate block">"Counterfeit Battery" vs SB001</span>
            </div>
            <ShieldAlert className="w-4 h-4 text-rose-500 group-hover:scale-110 transition-transform" />
          </button>

          <button
            onClick={() =>
              handleDecoded(
                'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B999_TAMPERED'
              )
            }
            className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-850 border border-rose-900/60 text-left transition flex items-center justify-between group"
          >
            <div>
              <span className="font-bold text-rose-400 block">Tampered Batch</span>
              <span className="text-[10px] text-slate-400 truncate block">B999_TAMPERED mismatch</span>
            </div>
            <ShieldAlert className="w-4 h-4 text-rose-500 group-hover:scale-110 transition-transform" />
          </button>

          <button
            onClick={() =>
              handleDecoded(
                'Product: Smart Drone; ID: SD999; Manufacturer: ABC Electronics; Batch: B001'
              )
            }
            className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-850 border border-amber-900/60 text-left transition flex items-center justify-between group"
          >
            <div>
              <span className="font-bold text-amber-400 block">Unregistered ID</span>
              <span className="text-[10px] text-slate-400 truncate block">SD999 not in local database</span>
            </div>
            <HelpCircle className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
          </button>
        </div>

        {/* Raw payload input */}
        <div className="pt-2 border-t border-slate-800 space-y-2">
          <label className="text-[11px] font-semibold text-slate-400 block">
            Or Paste Custom ESP32 QR Payload String:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001"
              className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <button
              onClick={() => {
                if (manualInput.trim()) {
                  handleDecoded(manualInput);
                }
              }}
              disabled={!manualInput.trim()}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-xs font-bold text-white transition"
            >
              Verify
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
