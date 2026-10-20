'use client';

import React, { useState } from 'react';
import { formatPaise } from '@/lib/money';
import { CategoryBadge } from './CategoryBadge';
import { EditExpenseModal } from './EditExpenseModal';
import { Store, FileText, Pencil } from 'lucide-react';
import type { Expense } from '@/db/schema';

interface Props {
  expense: Expense;
  onUpdated: (updated: Expense) => void;
  onDeleted: (id: string) => void;
}

export function ExpenseItem({ expense, onUpdated, onDeleted }: Props) {
  const [isEditOpen, setIsEditOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => setIsEditOpen(true)}
        className="glass-card flex min-h-[58px] cursor-pointer items-center justify-between rounded-2xl p-3.5 transition active:scale-[0.99] hover:border-slate-700/80"
      >
        <div className="flex items-center gap-3">
          <CategoryBadge category={expense.category} size="md" showLabel={false} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{expense.category}</span>
              {expense.merchant && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Store className="h-3 w-3 text-slate-500" />
                  <span>{expense.merchant}</span>
                </span>
              )}
            </div>
            {expense.note && (
              <p className="flex items-center gap-1 text-xs text-slate-400 line-clamp-1">
                <FileText className="h-3 w-3 shrink-0 text-slate-500" />
                <span>{expense.note}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight text-emerald-400">
            {formatPaise(expense.amountPaise)}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditOpen(true);
            }}
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <EditExpenseModal
        expense={expense}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />
    </>
  );
}
