'use client';

import React, { useState } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, History, Sparkles, Repeat, Settings, Home } from 'lucide-react';

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
    <header className="sticky top-0 z-30 glass-panel border-b border-slate-800/80 px-3 py-2.5">
      <div className="flex items-center justify-between gap-1">
        {/* Brand */}
        <NextLink href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-md shadow-emerald-500/20">
            <span className="text-sm font-black text-slate-950">₹</span>
          </div>
          <span className="text-sm font-bold tracking-tight text-white hidden sm:inline">SpendCoach</span>
        </NextLink>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          <NextLink
            href="/"
            title="Tonight's Entry"
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Home className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden xs:inline">Entry</span>
          </NextLink>

          <NextLink
            href="/commitments"
            title="Commitments"
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/commitments'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Repeat className="h-3.5 w-3.5 text-purple-400" />
            <span>Commitments</span>
          </NextLink>

          <NextLink
            href="/review"
            title="Review"
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/review'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Review</span>
          </NextLink>

          <NextLink
            href="/insights"
            title="Insights"
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/insights'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <span>Insights</span>
          </NextLink>

          <NextLink
            href="/history"
            title="History"
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition active:scale-95 ${
              pathname === '/history'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <History className="h-3.5 w-3.5" />
          </NextLink>

          <NextLink
            href="/settings"
            title="Settings & Export"
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold transition active:scale-95 ${
              pathname === '/settings'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
          </NextLink>

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Log out"
            aria-label="Log out"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-slate-800/40 text-slate-400 transition hover:bg-red-950/40 hover:text-red-400 active:scale-95"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
