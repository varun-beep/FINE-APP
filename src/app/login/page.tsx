'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setError(data.message || 'Too many attempts. Please try again later.');
        } else {
          setError(data.error || 'Incorrect passcode');
        }
        setLoading(false);
        return;
      }

      // Login success: redirect to target or home
      const from = searchParams.get('from') || '/';
      router.push(from);
      router.refresh();
    } catch {
      setError('Unable to reach server. Please check your network.');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-between px-6 py-10">
      <div className="flex flex-col items-center pt-8 text-center">
        {/* App Badge */}
        <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 p-0.5 shadow-2xl shadow-emerald-500/20">
          <div className="flex h-full w-full items-center justify-center rounded-[22px] bg-slate-950/80 backdrop-blur-md">
            <span className="text-3xl font-black tracking-tight text-emerald-400">₹</span>
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white">SpendCoach</h1>
        <p className="mt-1 text-sm text-slate-400">
          Personal expense tracking for your iPhone
        </p>
      </div>

      {/* Passcode Card */}
      <div className="glass-panel w-full rounded-3xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-400">
          <Lock className="h-3.5 w-3.5" />
          <span>Passcode Protected</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="passcode-input" className="sr-only">
              Passcode
            </label>
            <input
              id="passcode-input"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              placeholder="Enter passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full rounded-2xl border border-slate-700/60 bg-slate-900/90 px-4 py-4 text-center text-xl font-semibold tracking-widest text-white placeholder-slate-500 shadow-inner outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              style={{ minHeight: '52px' }}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-950/50 border border-red-800/40 p-3 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !passcode.trim()}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <span className="text-sm">Verifying...</span>
            ) : (
              <>
                <span className="text-sm">Unlock SpendCoach</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4 text-emerald-500/60" />
        <span>End-to-end encrypted session (30-day token)</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
