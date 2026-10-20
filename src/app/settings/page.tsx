'use client';

import React, { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import {
  Download,
  LogOut,
  ShieldCheck,
  FileSpreadsheet,
  Database,
  Smartphone,
  Info,
} from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    try {
      setDownloading(true);
      window.location.href = '/api/export';
      setTimeout(() => setDownloading(false), 2000);
    } catch (err) {
      console.error('Export failed:', err);
      setDownloading(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 pb-24 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-4">
        <div className="pb-4">
          <h1 className="text-xl font-black tracking-tight text-white">Settings & Data Safety</h1>
          <p className="text-xs text-slate-400">
            Export your data, inspect security status, and manage session
          </p>
        </div>

        {/* Export Data Card */}
        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Export All Data (CSV)</h2>
              <p className="text-xs text-slate-400">
                Download all your logged expenses and commitment schedules in standard CSV format.
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Your data is stored securely in your private database. Exporting produces an unencrypted backup file for your spreadsheets or personal archives.
          </p>

          <button
            onClick={handleExport}
            disabled={downloading}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>{downloading ? 'Preparing CSV...' : 'Download Complete Backup (CSV)'}</span>
          </button>
        </div>

        {/* Security & System Info */}
        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex items-center gap-2 mb-3 text-slate-300">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider">Security Architecture</h3>
          </div>

          <div className="space-y-3 text-xs text-slate-400">
            <div className="flex items-start gap-2.5">
              <Database className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-200">Serverless-Safe Rate Limiter</span>
                <p className="text-[11px] text-slate-500">
                  DB-backed HMAC-SHA256 hashed rate limit on login attempts. 5 failures in 10 minutes lock the IP.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Smartphone className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-200">Standalone Safari PWA</span>
                <p className="text-[11px] text-slate-500">
                  Full iPhone safe-area padding, touch targets &ge; 44px, numeric decimal keypad, and zero auto-zoom.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-200">Zero Secret Leakage</span>
                <p className="text-[11px] text-slate-500">
                  Passcodes and JWT secrets are verified against strict length and entropy standards in production.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Session Management */}
        <div className="rounded-2xl border border-red-950/40 bg-red-950/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-red-200">Lock & Log Out</h3>
              <p className="text-xs text-red-400/80">
                Clears your current device session cookie immediately.
              </p>
            </div>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-red-600/80 px-4 text-xs font-bold text-white transition hover:bg-red-500 active:scale-95 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              <span>{loggingOut ? 'Exiting...' : 'Log Out'}</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
