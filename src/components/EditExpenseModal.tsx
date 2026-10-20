'use client';

import React, { useState } from 'react';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/validations';
import { parseRupeesToPaise, paiseToDecimalString } from '@/lib/money';
import { CATEGORY_META } from './CategoryBadge';
import { X, Check, Trash2, AlertCircle } from 'lucide-react';
import type { Expense } from '@/db/schema';

interface Props {
  expense: Expense;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: (updated: Expense) => void;
  onDeleted: (id: string) => void;
}

export function EditExpenseModal({ expense, isOpen, onClose, onUpdated, onDeleted }: Props) {
  const [amountRupees, setAmountRupees] = useState(paiseToDecimalString(expense.amountPaise));
  const [category, setCategory] = useState<ExpenseCategory>(expense.category as ExpenseCategory);
  const [spentOn, setSpentOn] = useState(expense.spentOn);
  const [merchant, setMerchant] = useState(expense.merchant || '');
  const [note, setNote] = useState(expense.note || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let paise: number;
    try {
      paise = parseRupeesToPaise(amountRupees.trim());
      if (paise <= 0) {
        setError('Amount must be greater than zero');
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid amount');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_paise: paise,
          category,
          spent_on: spentOn,
          merchant: merchant.trim() || null,
          note: note.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || data.error || 'Failed to update expense');
        setLoading(false);
        return;
      }

      onUpdated(data.expense);
      onClose();
    } catch {
      setError('Network error while saving changes');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete expense');
        setLoading(false);
        return;
      }

      onDeleted(expense.id);
      onClose();
    } catch {
      setError('Network error while deleting expense');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="glass-panel w-full max-w-sm rounded-3xl p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h2 className="text-base font-bold text-white">Edit Expense</h2>
          <button
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Amount Input */}
          <div>
            <label htmlFor="edit-amount" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Amount (₹)
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-lg font-bold text-emerald-400">₹</span>
              <input
                id="edit-amount"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/90 py-2.5 pl-8 pr-3 text-lg font-bold text-white outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Category Chips */}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Category
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EXPENSE_CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                const isSelected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`flex min-h-[40px] items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-medium transition ${
                      isSelected
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{cat}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date */}
          <div>
            <label htmlFor="edit-date" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Date
            </label>
            <input
              id="edit-date"
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          {/* Merchant */}
          <div>
            <label htmlFor="edit-merchant" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Merchant
            </label>
            <input
              id="edit-merchant"
              type="text"
              placeholder="Merchant or store name"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          {/* Note */}
          <div>
            <label htmlFor="edit-note" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Note
            </label>
            <input
              id="edit-note"
              type="text"
              placeholder="Note or context"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-800/40 bg-red-950/40 p-3 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-red-950/50 text-red-400 hover:bg-red-900/60 transition active:scale-95"
              title="Delete Expense"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <button
              type="submit"
              disabled={loading}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-sm font-bold text-slate-950 shadow-md shadow-emerald-500/20 active:scale-95"
            >
              <Check className="h-4 w-4 stroke-[3]" />
              <span>{loading ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
