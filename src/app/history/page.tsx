'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Navbar } from '@/components/Navbar';
import { ExpenseItem } from '@/components/ExpenseItem';
import { formatPaise } from '@/lib/money';
import { getKolkataCurrentMonth, formatDisplayDate } from '@/lib/date';
import { ChevronLeft, ChevronRight, Calendar, Inbox, TrendingUp } from 'lucide-react';
import type { Expense } from '@/db/schema';

export default function HistoryPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => getKolkataCurrentMonth());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExpenses = useCallback(async (month: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/expenses?month=${month}`);
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
      }
    } catch (err) {
      console.error('Error fetching history expenses:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExpenses(selectedMonth);
  }, [selectedMonth, fetchExpenses]);

  const handlePrevMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 2, 1));
    const newMonth = date.toISOString().slice(0, 7);
    setSelectedMonth(newMonth);
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(Date.UTC(year, month, 1));
    const newMonth = date.toISOString().slice(0, 7);
    setSelectedMonth(newMonth);
  };

  const handleUpdated = (updated: Expense) => {
    setExpenses((prev) => {
      // If updated expense still in this month, update it; otherwise remove
      if (updated.spentOn.startsWith(selectedMonth)) {
        return prev.map((item) => (item.id === updated.id ? updated : item));
      }
      return prev.filter((item) => item.id !== updated.id);
    });
  };

  const handleDeleted = (id: string) => {
    setExpenses((prev) => prev.filter((item) => item.id !== id));
  };

  // Group expenses by spentOn day (already sorted descending from API)
  const groupedByDay = useMemo(() => {
    const map = new Map<string, { dayTotal: number; items: Expense[] }>();

    for (const exp of expenses) {
      const dateKey = exp.spentOn;
      const existing = map.get(dateKey);
      if (existing) {
        existing.dayTotal += exp.amountPaise;
        existing.items.push(exp);
      } else {
        map.set(dateKey, { dayTotal: exp.amountPaise, items: [exp] });
      }
    }

    return Array.from(map.entries()).map(([dateKey, val]) => ({
      date: dateKey,
      dayTotal: val.dayTotal,
      items: val.items,
    }));
  }, [expenses]);

  const monthTotalPaise = expenses.reduce((sum, item) => sum + item.amountPaise, 0);

  // Format month for header (e.g. October 2026)
  const displayMonth = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    if (!year || !month) return selectedMonth;
    const date = new Date(Date.UTC(year, month - 1, 1));
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }, [selectedMonth]);

  return (
    <div className="flex min-h-screen flex-col pb-16">
      <Navbar />

      <main className="flex-1 px-4 py-4 space-y-5">
        {/* Month Selector Bar */}
        <section className="glass-panel flex items-center justify-between rounded-2xl p-2.5">
          <button
            onClick={handlePrevMonth}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white active:scale-95"
            title="Previous Month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-emerald-400" />
            <input
              type="month"
              aria-label="Filter by month"
              value={selectedMonth}
              onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
              className="bg-transparent text-sm font-bold text-white outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={handleNextMonth}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white active:scale-95"
            title="Next Month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </section>

        {/* Monthly Summary Card */}
        <section className="glass-panel relative overflow-hidden rounded-3xl p-5 shadow-xl">
          <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-emerald-500/10 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>{displayMonth} Total</span>
              </span>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-white">
                {formatPaise(monthTotalPaise)}
              </h2>
              <span className="text-xs text-slate-400">
                {expenses.length} {expenses.length === 1 ? 'transaction' : 'transactions'}
              </span>
            </div>
          </div>
        </section>

        {/* Expenses Grouped by Day */}
        <section className="space-y-5">
          {loading ? (
            <div className="space-y-3 pt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass-card h-20 animate-pulse rounded-2xl" />
              ))}
            </div>
          ) : groupedByDay.length === 0 ? (
            <div className="glass-panel flex flex-col items-center justify-center rounded-3xl py-12 text-center">
              <Inbox className="h-10 w-10 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">No expenses in {displayMonth}</p>
              <p className="text-xs text-slate-500 mt-1">Select another month or record expenses on the Home tab.</p>
            </div>
          ) : (
            groupedByDay.map((group) => (
              <div key={group.date} className="space-y-2">
                {/* Day Header */}
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {formatDisplayDate(group.date)}
                  </span>
                  <span className="text-xs font-semibold text-emerald-400">
                    {formatPaise(group.dayTotal)}
                  </span>
                </div>

                {/* Day Entries */}
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <ExpenseItem
                      key={item.id}
                      expense={item}
                      onUpdated={handleUpdated}
                      onDeleted={handleDeleted}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
