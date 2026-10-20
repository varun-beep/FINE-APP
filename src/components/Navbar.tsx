'use client';

import React, { useState } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, History, Sparkles } from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

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
    <header className="sticky top-0 z-30 glass-panel border-b border-slate-800/80 px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Brand */}
        <NextLink href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-md shadow-emerald-500/20">
            <span className="text-base font-black text-slate-950">₹</span>
          </div>
          <div>
            <span className="text-base font-bold tracking-tight text-white">SpendCoach</span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-emerald-400">
              Personal PWA
            </span>
          </div>
        </NextLink>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <NextLink
            href="/review"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/review'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <span>Review</span>
          </NextLink>

          <NextLink
            href="/insights"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/insights'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <span>Insights</span>
          </NextLink>

          <NextLink
            href="/history"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/history'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <History className="h-4 w-4 text-emerald-400" />
            <span>History</span>
          </NextLink>

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Log out"
            aria-label="Log out"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800/40 text-slate-400 transition hover:bg-red-950/40 hover:text-red-400 active:scale-95"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
