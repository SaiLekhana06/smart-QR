import React, { useState } from 'react';
import {
  Smartphone,
  Copy,
  Check,
  Download,
  FolderTree,
  FileCode,
  Terminal,
  ExternalLink,
  Info,
  CheckCircle2,
  FileText
} from 'lucide-react';
import { ANDROID_PROJECT_FILES, AndroidFile } from '../services/androidSourceCode';

export const AndroidCodeExporterView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<AndroidFile>(ANDROID_PROJECT_FILES[0]);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopySingle = () => {
    navigator.clipboard.writeText(selectedFile.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDownloadAllBundle = () => {
    const bundleData = {
      project: 'SmartQR Android Native Kotlin Studio Project',
      architecture: 'Jetpack Compose + CameraX + Google ML Kit + Room SQLite',
      instructions: 'Paste files into an Android Studio Empty Activity (Compose) project.',
      files: ANDROID_PROJECT_FILES
    };

    const blob = new Blob([JSON.stringify(bundleData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SmartQR_Android_Studio_Project_Source.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">Native Android Studio Source & APK Guide</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Section 3 & 15 Deliverables: Complete native Kotlin project files, Gradle setup, and APK build walkthrough.
          </p>
        </div>

        <button
          onClick={handleDownloadAllBundle}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white shadow-sm transition"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download All Android Files (.JSON)</span>
        </button>
      </div>

      {/* PWA vs Native Android Comparison Notice (Section 3 Requirement) */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
          <Info className="w-4 h-4" />
          <span>Platform Architecture Comparison: PWA vs. Native Android APK</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <span className="font-bold text-emerald-400 block">Progressive Web App (PWA)</span>
            <p className="text-slate-400 leading-relaxed">
              Runs in browser or standalone home screen container. Uses Web APIs (HTML5 Camera, IndexedDB) with zero store approvals needed. Installable via browser "Install App" button. 100% offline capable via Service Worker.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <span className="font-bold text-sky-400 block">Native Android APK (Kotlin / Jetpack Compose)</span>
            <p className="text-slate-400 leading-relaxed">
              Compiles to bytecode (<code className="text-slate-200">.apk</code>) using Android Studio and Gradle. Directly talks to hardware via CameraX, Google ML Kit Vision Barcode Scanner, and Room SQLite database with full OS deep integration.
            </p>
          </div>
        </div>
      </div>

      {/* File Browser Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar File Tree */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            <FolderTree className="w-4 h-4 text-cyan-400" />
            <span>Android Project Files ({ANDROID_PROJECT_FILES.length})</span>
          </div>

          <div className="space-y-1.5">
            {ANDROID_PROJECT_FILES.map((file) => {
              const isSelected = selectedFile.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-cyan-950/60 text-cyan-300 border-cyan-700/80 shadow-sm'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="truncate">{file.filename}</span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
                      {file.category}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 truncate block mt-0.5">
                    {file.path}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Code Content & Details View */}
        <div className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">{selectedFile.filename}</h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{selectedFile.description}</p>
            </div>

            <button
              onClick={handleCopySingle}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
            >
              {copiedCode ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>

          <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 flex-1">
            <pre className="p-4 text-xs font-mono text-cyan-300/90 overflow-x-auto max-h-[500px] scrollbar-thin">
              {selectedFile.code}
            </pre>
          </div>

          <div className="text-[11px] text-slate-400 flex items-center justify-between pt-2">
            <span>Path: <code className="text-slate-300 font-mono">{selectedFile.path}</code></span>
            <span>Language: <strong className="text-slate-300">Kotlin / Gradle / XML</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
};
