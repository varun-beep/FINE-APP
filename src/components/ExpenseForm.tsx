'use client';

import React, { useState } from 'react';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/validations';
import { parseRupeesToPaise } from '@/lib/money';
import { getKolkataToday } from '@/lib/date';
import { CATEGORY_META } from './CategoryBadge';
import { Plus, Calendar, Store, FileText, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import type { Expense } from '@/db/schema';

interface Props {
  onExpenseAdded: (expense: Expense) => void;
  onOptimisticAdd?: (tempExpense: Expense) => void;
  onOptimisticRevert?: (tempId: string) => void;
}

export function ExpenseForm({ onExpenseAdded, onOptimisticAdd, onOptimisticRevert }: Props) {
  const [amountRupees, setAmountRupees] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory>('Food');
  const [spentOn, setSpentOn] = useState(getKolkataToday());
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent, directCategory?: ExpenseCategory) => {
    if (e) e.preventDefault();
    setError(null);

    const categoryToUse = directCategory || selectedCategory;

    // Validate amount
    if (!amountRupees.trim()) {
      setError('Please enter an amount');
      return;
    }

    let paise: number;
    try {
      paise = parseRupeesToPaise(amountRupees.trim());
      if (paise <= 0) {
        setError('Amount must be greater than zero');
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid amount format');
      return;
    }

    const payload = {
      amount_paise: paise,
      category: categoryToUse,
      spent_on: spentOn,
      merchant: merchant.trim() || null,
      note: note.trim() || null,
    };

    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const optimisticExpense: Expense = {
      id: tempId,
      amountPaise: paise,
      category: categoryToUse,
      spentOn,
      merchant: payload.merchant,
      note: payload.note,
      kind: 'spend',
      source: 'manual',
      scheduleId: null,
      oneOff: false,
      createdAt: new Date(),
    };

    if (onOptimisticAdd) {
      onOptimisticAdd(optimisticExpense);
    }

    // Reset inputs immediately for snappy 2-tap workflow
    setAmountRupees('');
    setMerchant('');
    setNote('');
    setShowDetails(false);
    setSubmitting(true);

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        if (onOptimisticRevert) onOptimisticRevert(tempId);
        setError(data.message || data.error || 'Failed to save expense');
        // Restore amount so user does not lose their entry
        setAmountRupees(amountRupees);
        return;
      }

      onExpenseAdded(data.expense);
    } catch {
      if (onOptimisticRevert) onOptimisticRevert(tempId);
      setError('Network error while saving expense. Please try again.');
      setAmountRupees(amountRupees);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCategoryChipClick = (cat: ExpenseCategory) => {
    setSelectedCategory(cat);
    // If an amount is already typed, tapping a category chip can directly submit (2-tap flow)
    if (amountRupees.trim() && parseFloat(amountRupees) > 0) {
      handleSubmit(undefined, cat);
    }
  };

  return (
    <div className="glass-panel rounded-3xl p-5 shadow-2xl">
      <form onSubmit={(e) => handleSubmit(e)}>
        {/* Big Numeric Amount Input */}
        <div className="relative mb-5 flex flex-col items-center">
          <label htmlFor="amount-input" className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Amount Spent
          </label>
          <div className="flex w-full items-center justify-center">
            <span className="text-3xl font-extrabold text-emerald-400">₹</span>
            <input
              id="amount-input"
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              autoComplete="off"
              placeholder="0"
              value={amountRupees}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, '');
                setAmountRupees(val);
                if (error) setError(null);
              }}
              className="w-full max-w-[240px] bg-transparent text-center text-4xl font-extrabold tracking-tight text-white placeholder-slate-600 outline-none"
              style={{ minHeight: '52px' }}
            />
          </div>
        </div>

        {/* Category Chips */}
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Category
          </div>
          <div className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((cat) => {
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              const isSelected = selectedCategory === cat;

              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleCategoryChipClick(cat)}
                  className={`flex min-h-[44px] items-center gap-1.5 rounded-2xl border px-3 py-2 text-xs font-medium transition active:scale-95 ${
                    isSelected
                      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-400/30'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{cat}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Collapsible Details (Date, Merchant, Note) */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-2 text-xs font-medium text-slate-400 transition hover:text-slate-200"
          >
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-emerald-400" />
              <span>Details (Date, Merchant, Note)</span>
            </span>
            {showDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showDetails && (
            <div className="mt-3 space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3.5">
              {/* Date Input */}
              <div>
                <label htmlFor="expense-date" className="mb-1 block text-[11px] font-medium text-slate-400">
                  Date (defaults to today)
                </label>
                <input
                  id="expense-date"
                  type="date"
                  value={spentOn}
                  onChange={(e) => setSpentOn(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                />
              </div>

              {/* Merchant Input */}
              <div>
                <label htmlFor="merchant-input" className="mb-1 block text-[11px] font-medium text-slate-400">
                  Merchant / Place (optional)
                </label>
                <div className="relative flex items-center">
                  <Store className="absolute left-3 h-4 w-4 text-slate-500" />
                  <input
                    id="merchant-input"
                    type="text"
                    placeholder="e.g. Swiggy, Amazon, Metro"
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    maxLength={100}
                    className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/90 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-600 outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Note Input */}
              <div>
                <label htmlFor="note-input" className="mb-1 block text-[11px] font-medium text-slate-400">
                  Note (optional)
                </label>
                <div className="relative flex items-center">
                  <FileText className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                  <textarea
                    id="note-input"
                    placeholder="Quick context or item details"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/90 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-600 outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-800/40 bg-red-950/40 p-3 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={submitting || !amountRupees.trim()}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition active:scale-[0.98] disabled:opacity-50"
        >
          <Plus className="h-4 w-4 stroke-[3]" />
          <span>{submitting ? 'Adding...' : 'Add Expense'}</span>
        </button>
      </form>
    </div>
  );
}
