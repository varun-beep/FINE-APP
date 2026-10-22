'use client';

import React, { useState, useEffect } from 'react';
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
  PiggyBank,
  CalendarCheck,
  CheckCircle2,
  Save,
} from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Savings Target State
  const [savingsPct, setSavingsPct] = useState<number>(20);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingsMessage, setSavingsMessage] = useState<string | null>(null);

  // Backfilled Data / Learning Gate State
  const [closingDays, setClosingDays] = useState(false);
  const [closeMessage, setCloseMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.savingsTargetPct === 'number') {
          setSavingsPct(data.savingsTargetPct);
        }
      })
      .catch((err) => console.error('Error fetching settings:', err));
  }, []);

  const handleSaveSavings = async () => {
    setSavingSettings(true);
    setSavingsMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savingsTargetPct: savingsPct }),
      });
      if (res.ok) {
        setSavingsMessage(`Savings target updated to ${savingsPct}%. Allowance updated.`);
        setTimeout(() => setSavingsMessage(null), 3500);
      } else {
        setSavingsMessage('Failed to save settings.');
      }
    } catch {
      setSavingsMessage('Network error updating savings target.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClosePastDays = async () => {
    setClosingDays(true);
    setCloseMessage(null);
    try {
      const res = await fetch('/api/settings/close-past-days', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setCloseMessage(data.message || `Treated ${data.count} days as closed.`);
      } else {
        setCloseMessage(data.error || 'Failed to close past days.');
      }
    } catch {
      setCloseMessage('Network error while closing past days.');
    } finally {
      setClosingDays(false);
    }
  };

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

      <main className="mx-auto max-w-xl px-4 pt-4 space-y-6">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white">Settings & Preferences</h1>
          <p className="text-xs text-slate-400">
            Set your savings target, manage backfilled closures, export backups, and security.
          </p>
        </div>

        {/* 1. Savings Target Setting (Feeds Allowance) */}
        <div className="rounded-2xl border border-emerald-900/40 bg-emerald-950/20 p-5 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <PiggyBank className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Monthly Savings Target</h2>
              <p className="text-xs text-emerald-400/80">
                Current target: <span className="font-bold text-white">{savingsPct}%</span> of monthly income
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Your savings target is subtracted from income before calculating your discretionary allowance, ensuring you never accidentally spend what you planned to save.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="5"
                max="50"
                step="1"
                value={savingsPct}
                onChange={(e) => setSavingsPct(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              />
              <span className="text-sm font-mono font-bold text-emerald-400 w-12 text-right">{savingsPct}%</span>
            </div>

            {savingsMessage && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-950/60 border border-emerald-800/60 p-3 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{savingsMessage}</span>
              </div>
            )}

            <button
              onClick={handleSaveSavings}
              disabled={savingSettings}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{savingSettings ? 'Saving...' : 'Save Savings Target'}</span>
            </button>
          </div>
        </div>

        {/* 2. Backfilled Data & Learning Gate Action */}
        <div className="rounded-2xl border border-indigo-900/40 bg-indigo-950/20 p-5 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Backfilled Data & Learning Gate</h2>
              <p className="text-xs text-indigo-400/80">
                Treat past days that have entries as closed
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            If you imported or backfilled past expenses, SpendCoach requires 14 closed days before unlocking advanced pattern insights. Tap below to automatically mark every past day that has expense entries as closed.
          </p>

          {closeMessage && (
            <div className="flex items-center gap-2 rounded-xl bg-indigo-950/60 border border-indigo-800/60 p-3 text-xs text-indigo-300 mb-3">
              <Info className="h-4 w-4 shrink-0" />
              <span>{closeMessage}</span>
            </div>
          )}

          <button
            onClick={handleClosePastDays}
            disabled={closingDays}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-500 active:scale-95 disabled:opacity-50"
          >
            <CalendarCheck className="h-4 w-4" />
            <span>{closingDays ? 'Closing past days...' : 'Treat Past Days With Entries as Closed'}</span>
          </button>
        </div>

        {/* 3. Export Data Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 border border-slate-700">
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
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 text-xs font-bold text-white transition hover:bg-slate-700 active:scale-95 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>{downloading ? 'Preparing CSV...' : 'Download Complete Backup (CSV)'}</span>
          </button>
        </div>

        {/* 4. Security & System Info */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
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

        {/* 5. Session Management */}
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
