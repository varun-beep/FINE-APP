'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/Navbar';
import { ExpenseForm } from '@/components/ExpenseForm';
import { ExpenseItem } from '@/components/ExpenseItem';
import { formatPaise } from '@/lib/money';
import { getKolkataToday, formatDisplayDate } from '@/lib/date';
import { Wallet, Sparkles, Inbox } from 'lucide-react';
import type { Expense } from '@/db/schema';

export default function HomePage() {
  const [todayExpenses, setTodayExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [todayDate] = useState(() => getKolkataToday());

  const fetchTodayExpenses = useCallback(async () => {
    try {
      const res = await fetch(`/api/expenses?date=${todayDate}`);
      if (res.ok) {
        const data = await res.json();
        setTodayExpenses(data.expenses || []);
      }
    } catch (err) {
      console.error('Error fetching today expenses:', err);
    } finally {
      setLoading(false);
    }
  }, [todayDate]);

  useEffect(() => {
    fetchTodayExpenses();
  }, [fetchTodayExpenses]);

  // Optimistic UI updates
  const handleOptimisticAdd = (tempExpense: Expense) => {
    if (tempExpense.spentOn === todayDate) {
      setTodayExpenses((prev) => [tempExpense, ...prev]);
    }
  };

  const handleOptimisticRevert = (tempId: string) => {
    setTodayExpenses((prev) => prev.filter((item) => item.id !== tempId));
  };

  const handleExpenseAdded = (realExpense: Expense) => {
    if (realExpense.spentOn === todayDate) {
      setTodayExpenses((prev) => {
        // Replace temporary optimistic item or append
        const filtered = prev.filter((item) => !item.id.startsWith('temp-') && item.id !== realExpense.id);
        return [realExpense, ...filtered];
      });
    }
  };

  const handleExpenseUpdated = (updated: Expense) => {
    setTodayExpenses((prev) => {
      if (updated.spentOn === todayDate) {
        return prev.map((item) => (item.id === updated.id ? updated : item));
      } else {
        // Moved to a different date
        return prev.filter((item) => item.id !== updated.id);
      }
    });
  };

  const handleExpenseDeleted = (id: string) => {
    setTodayExpenses((prev) => prev.filter((item) => item.id !== id));
  };

  const todayTotalPaise = todayExpenses.reduce((sum, item) => sum + item.amountPaise, 0);

  return (
    <div className="flex min-h-screen flex-col pb-16">
      <Navbar />

      <main className="flex-1 px-4 py-4 space-y-5">
        {/* Today Banner with Total */}
        <section className="glass-panel relative overflow-hidden rounded-3xl p-5 shadow-xl">
          <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-emerald-500/10 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{formatDisplayDate(todayDate)}</span>
              </span>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-white">
                {formatPaise(todayTotalPaise)}
              </h2>
              <span className="text-xs text-slate-400">
                {todayExpenses.length} {todayExpenses.length === 1 ? 'expense' : 'expenses'} logged
              </span>
            </div>

            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
        </section>

        {/* Add Expense Section */}
        <section>
          <ExpenseForm
            onExpenseAdded={handleExpenseAdded}
            onOptimisticAdd={handleOptimisticAdd}
            onOptimisticRevert={handleOptimisticRevert}
          />
        </section>

        {/* Today's Expense List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Today&apos;s Expenses
            </h3>
            <span className="text-xs font-semibold text-emerald-400">
              {formatPaise(todayTotalPaise)}
            </span>
          </div>

          {loading ? (
            <div className="space-y-2 pt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass-card h-14 animate-pulse rounded-2xl" />
              ))}
            </div>
          ) : todayExpenses.length === 0 ? (
            <div className="glass-panel flex flex-col items-center justify-center rounded-2xl py-10 text-center">
              <Inbox className="h-8 w-8 text-slate-600 mb-2" />
              <p className="text-sm font-medium text-slate-400">No expenses logged today</p>
              <p className="text-xs text-slate-600 mt-0.5">Enter an amount above to record your first spend</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayExpenses.map((expense) => (
                <ExpenseItem
                  key={expense.id}
                  expense={expense}
                  onUpdated={handleExpenseUpdated}
                  onDeleted={handleExpenseDeleted}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
