import React, { useState } from 'react';
import {
  QrCode,
  LayoutDashboard,
  Scan,
  Database,
  PlusCircle,
  History,
  CheckCircle2,
  ShieldAlert,
  Smartphone,
  Download,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePWAInstall } from '../hooks/usePWAInstall';

export type ActiveTab =
  | 'dashboard'
  | 'scanner'
  | 'database'
  | 'register'
  | 'history'
  | 'testsuite'
  | 'security'
  | 'android_code';

interface NavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  registeredCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  registeredCount
}) => {
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  const navItems = [
    { id: 'dashboard' as ActiveTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'scanner' as ActiveTab, label: 'Scan QR', icon: Scan, primary: true },
    { id: 'database' as ActiveTab, label: 'Product Registry', icon: Database, badge: registeredCount },
    { id: 'register' as ActiveTab, label: 'Register Product', icon: PlusCircle },
    { id: 'history' as ActiveTab, label: 'Scan History', icon: History },
    { id: 'testsuite' as ActiveTab, label: 'Test Suite', icon: CheckCircle2 },
    { id: 'security' as ActiveTab, label: 'Security Analysis', icon: ShieldAlert },
    { id: 'android_code' as ActiveTab, label: 'Android APK / Source', icon: Smartphone }
  ];

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      {/* Top Identity & Status Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
        <div
          onClick={() => onTabChange('dashboard')}
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-sky-500 to-emerald-400 p-0.5 shadow-lg shadow-cyan-500/20 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <QrCode className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white group-hover:text-cyan-400 transition-colors">
                SmartQR
              </span>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 rounded-full tracking-wider uppercase">
                ESP32 Ready
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Smart Product Authentication System • B.Tech Engineering Project
            </p>
          </div>
        </div>

        {/* Right Status Badges & Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Offline / Online Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              isOnline
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                : 'bg-amber-950/60 text-amber-300 border-amber-800/80 animate-pulse'
            }`}
            title={isOnline ? 'Online (IndexedDB Local Storage Active)' : 'Offline Mode — Local Database Active'}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Local & Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>Offline Mode (DB Active)</span>
              </>
            )}
          </div>

          {/* In-App PWA Install Prompt Button */}
          {!isInstalled && isInstallable && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm shadow-cyan-600/30 transition-all hover:scale-[1.02] active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install App</span>
            </button>
          )}

          {!isInstalled && isIOS && (
            <button
              onClick={() => setShowIOSModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install iOS</span>
            </button>
          )}

          {/* Quick Scan Primary CTA */}
          <button
            onClick={() => onTabChange('scanner')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
              activeTab === 'scanner'
                ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                : 'bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white shadow-cyan-600/30'
            }`}
          >
            <Scan className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scan QR</span>
          </button>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-slate-800/80 overflow-x-auto scrollbar-none flex gap-1 py-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{item.label}</span>
              {typeof item.badge === 'number' && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* iOS Safari Install Guide Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-cyan-400" />
              Install SmartQR on iOS
            </h3>
            <p className="mt-3 text-xs text-slate-300 leading-relaxed">
              1. Tap the <strong className="text-cyan-400">Share</strong> button in the Safari browser toolbar.<br />
              2. Scroll down and tap <strong className="text-cyan-400">Add to Home Screen</strong>.<br />
              3. SmartQR will install as a standalone native-like offline app with full camera scanning.
            </p>
            <button
              onClick={() => setShowIOSModal(false)}
              className="mt-5 w-full rounded-xl bg-slate-800 hover:bg-slate-700 py-2 text-xs font-semibold text-slate-200 border border-slate-700 transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
