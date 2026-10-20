'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar } from '@/components/Navbar';
import { formatPaiseToRupees, parseAmountShorthand } from '@/lib/money';
import { getKolkataToday, formatDisplayDate } from '@/lib/date';
import { useRouter } from 'next/navigation';
import {
  CheckCircle,
  Plus,
  RotateCcw,
  Tag,
  AlertTriangle,
  Flame,
  Repeat,
  Check,
  Edit2,
} from 'lucide-react';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/validations';
import type { Expense } from '@/db/schema';

interface QuickRepeatCombo {
  key: string;
  merchant: string;
  category: ExpenseCategory;
  usualAmountPaise: number;
  count: number;
}

export default function TonightEntryPage() {
  const router = useRouter();
  const today = getKolkataToday();

  // Selected date for entry (defaults to today; can be switched to backfill unclosed days)
  const [activeDate, setActiveDate] = useState<string>(today);

  // Form State
  const [amountStr, setAmountStr] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory>('Food');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [isOneOff, setIsOneOff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Data & History State
  const [todayExpenses, setTodayExpenses] = useState<Expense[]>([]);
  const [unclosedPastDays, setUnclosedPastDays] = useState<string[]>([]);
  const [todayStatus, setTodayStatus] = useState<string | null>(null);
  const [orderedCategories, setOrderedCategories] = useState<ExpenseCategory[]>([...EXPENSE_CATEGORIES]);
  const [quickRepeatCombos, setQuickRepeatCombos] = useState<QuickRepeatCombo[]>([]);
  const [merchantCategoryMap, setMerchantCategoryMap] = useState<Map<string, ExpenseCategory>>(new Map());

  // Undo Toast State
  const [undoItem, setUndoItem] = useState<{ id: string; name: string } | null>(null);
  const undoTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Edit Amount Sheet / Modal State
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editAmountStr, setEditAmountStr] = useState('');

  // Refs for instantaneous autofocus without page jump
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Load today's expenses & day closures
  const loadData = useCallback(async () => {
    try {
      // 1. Fetch expenses for today
      const expRes = await fetch(`/api/expenses?date=${today}`);
      if (expRes.ok) {
        const expData = await expRes.json();
        setTodayExpenses(expData.expenses || []);
      }

      // 2. Fetch day closures & unclosed past days
      const closureRes = await fetch('/api/day-closures');
      if (closureRes.ok) {
        const closureData = await closureRes.json();
        setUnclosedPastDays(closureData.unclosedPastDays || []);
        setTodayStatus(closureData.todayStatus || null);
      }

      // 3. Fetch recent history to learn category frequency and quick-repeat combos
      const histRes = await fetch('/api/expenses');
      if (histRes.ok) {
        const histData = await histRes.json();
        const exps: Expense[] = histData.expenses || [];

        // Learn category frequency
        const catCounts: Record<string, number> = {};
        const merchCat = new Map<string, ExpenseCategory>();
        const comboMap = new Map<string, { merchant: string; category: ExpenseCategory; amounts: number[]; count: number }>();

        for (const e of exps) {
          catCounts[e.category] = (catCounts[e.category] || 0) + 1;

          if (e.merchant) {
            const mClean = e.merchant.trim();
            if (!merchCat.has(mClean.toLowerCase())) {
              merchCat.set(mClean.toLowerCase(), e.category as ExpenseCategory);
            }

            const comboKey = `${mClean.toLowerCase()}|${e.category}`;
            if (!comboMap.has(comboKey)) {
              comboMap.set(comboKey, {
                merchant: mClean,
                category: e.category as ExpenseCategory,
                amounts: [e.amountPaise],
                count: 1,
              });
            } else {
              const entry = comboMap.get(comboKey)!;
              entry.amounts.push(e.amountPaise);
              entry.count++;
            }
          }
        }

        // Sort categories by learned frequency
        const sortedCats = [...EXPENSE_CATEGORIES].sort(
          (a, b) => (catCounts[b] || 0) - (catCounts[a] || 0)
        );
        setOrderedCategories(sortedCats);
        if (sortedCats.length > 0) {
          setSelectedCategory(sortedCats[0]);
        }
        setMerchantCategoryMap(merchCat);

        // Derive top 6 quick-repeat combos
        const sortedCombos = Array.from(comboMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 6)
          .map((item) => {
            // Find most frequent amount (mode) or fallback to last
            const amtCounts = new Map<number, number>();
            for (const a of item.amounts) {
              amtCounts.set(a, (amtCounts.get(a) || 0) + 1);
            }
            let bestAmt = item.amounts[0];
            let maxC = 0;
            for (const [amt, c] of amtCounts.entries()) {
              if (c > maxC) {
                maxC = c;
                bestAmt = amt;
              }
            }
            return {
              key: `${item.merchant}|${item.category}`,
              merchant: item.merchant,
              category: item.category,
              usualAmountPaise: bestAmt,
              count: item.count,
            };
          });

        setQuickRepeatCombos(sortedCombos);
      }
    } catch (err) {
      console.error('Failed to load tonight entry data:', err);
    }
  }, [today]);

  useEffect(() => {
    loadData();
    // Autofocus amount on mount
    amountInputRef.current?.focus();
  }, [loadData]);

  // Merchant autocomplete change handler (auto-fills category)
  const handleMerchantChange = (val: string) => {
    setMerchant(val);
    const knownCat = merchantCategoryMap.get(val.toLowerCase().trim());
    if (knownCat) {
      setSelectedCategory(knownCat);
    }
  };

  // Fast Save Entry
  const handleFastSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    const paise = parseAmountShorthand(amountStr);
    if (!paise || paise <= 0) {
      setErrorMessage('Type a valid amount (e.g. 250, 2.5k, 1.2L)');
      amountInputRef.current?.focus();
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticEntry: Expense = {
      id: tempId,
      amountPaise: paise,
      category: selectedCategory,
      merchant: merchant.trim() || null,
      note: note.trim() || null,
      spentOn: activeDate,
      kind: 'spend',
      source: 'manual',
      scheduleId: null,
      oneOff: isOneOff,
      createdAt: new Date(),
    };

    // 1. Optimistic Update
    if (activeDate === today) {
      setTodayExpenses((prev) => [optimisticEntry, ...prev]);
    }

    // 2. Clear fields immediately & preserve amount focus
    setAmountStr('');
    setMerchant('');
    setNote('');
    setIsOneOff(false);
    amountInputRef.current?.focus();
    setSaving(true);

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_paise: paise,
          category: selectedCategory,
          merchant: optimisticEntry.merchant,
          note: optimisticEntry.note,
          spent_on: activeDate,
          one_off: isOneOff,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to save expense');
      }

      const data = await res.json();
      if (activeDate === today) {
        setTodayExpenses((prev) => [data.expense, ...prev.filter((p) => p.id !== tempId)]);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Could not save expense. Restoring...');
      // Revert optimistic
      setTodayExpenses((prev) => prev.filter((p) => p.id !== tempId));
      setAmountStr(amountStr);
    } finally {
      setSaving(false);
    }
  };

  // Quick Repeat Tap
  const handleQuickRepeat = async (combo: QuickRepeatCombo) => {
    setErrorMessage(null);
    const tempId = `temp-${Date.now()}`;
    const optimistic: Expense = {
      id: tempId,
      amountPaise: combo.usualAmountPaise,
      category: combo.category,
      merchant: combo.merchant,
      note: null,
      spentOn: today,
      kind: 'spend',
      source: 'manual',
      scheduleId: null,
      oneOff: false,
      createdAt: new Date(),
    };

    setTodayExpenses((prev) => [optimistic, ...prev]);

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_paise: combo.usualAmountPaise,
          category: combo.category,
          merchant: combo.merchant,
          spent_on: today,
        }),
      });

      if (!res.ok) throw new Error('Quick repeat failed');
      const data = await res.json();
      const realId = data.expense.id;

      setTodayExpenses((prev) => [data.expense, ...prev.filter((p) => p.id !== tempId)]);

      // Trigger 5-second Undo Toast
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoItem({ id: realId, name: `${combo.merchant} (${formatPaiseToRupees(combo.usualAmountPaise)})` });

      undoTimerRef.current = setTimeout(() => {
        setUndoItem(null);
      }, 5000);
    } catch {
      setTodayExpenses((prev) => prev.filter((p) => p.id !== tempId));
    }
  };

  // Undo Quick Repeat
  const handleUndo = async () => {
    if (!undoItem) return;
    const targetId = undoItem.id;
    setUndoItem(null);
    setTodayExpenses((prev) => prev.filter((e) => e.id !== targetId));

    try {
      await fetch(`/api/expenses/${targetId}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to undo:', err);
    }
  };

  // Day Closures
  const handleCloseDay = async (day: string, status: 'logged' | 'no_spend' | 'skipped') => {
    try {
      const res = await fetch('/api/day-closures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, status }),
      });

      if (res.ok) {
        if (day === today) {
          setTodayStatus(status);
          if (status === 'logged') {
            router.push('/review');
          }
        } else {
          setUnclosedPastDays((prev) => prev.filter((d) => d !== day));
          if (activeDate === day) {
            setActiveDate(today);
          }
        }
      }
    } catch (err) {
      console.error('Failed to close day:', err);
    }
  };

  // Edit Expense Amount handler
  const handleSaveEditAmount = async () => {
    if (!editingExpense) return;
    const paise = parseAmountShorthand(editAmountStr);
    if (!paise || paise <= 0) return;

    try {
      const res = await fetch(`/api/expenses/${editingExpense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_paise: paise }),
      });

      if (res.ok) {
        const data = await res.json();
        setTodayExpenses((prev) => prev.map((e) => (e.id === editingExpense.id ? data.expense : e)));
        setEditingExpense(null);
      }
    } catch (err) {
      console.error('Failed to update amount:', err);
    }
  };

  // Separate Discretionary vs Scheduled expenses for today
  const discretionaryExpenses = todayExpenses.filter(
    (e) => (e.kind ?? 'spend') === 'spend' && (e.source ?? 'manual') !== 'schedule'
  );
  const scheduledExpenses = todayExpenses.filter((e) => e.source === 'schedule');

  const discretionaryTotalPaise = discretionaryExpenses.reduce(
    (sum, e) => sum + e.amountPaise,
    0
  );

  return (
    <div className="min-h-screen bg-slate-950 pb-24 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-4">
        {/* Unclosed Past Days Banners */}
        {unclosedPastDays.length > 0 && (
          <div className="mb-4 space-y-2">
            {unclosedPastDays.map((pastDay) => (
              <div
                key={pastDay}
                className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3 backdrop-blur-md"
              >
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span>Unclosed: {formatDisplayDate(pastDay)}</span>
                  </div>
                  <span className="text-[10px] text-amber-400/80">
                    Nightly review missed for this day
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setActiveDate(pastDay);
                      amountInputRef.current?.focus();
                    }}
                    className="min-h-[36px] rounded-lg bg-amber-500/20 px-2.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30"
                  >
                    Add Entry
                  </button>
                  <button
                    onClick={() => handleCloseDay(pastDay, 'no_spend')}
                    className="min-h-[36px] rounded-lg bg-slate-800 px-2.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
                  >
                    No Spend
                  </button>
                  <button
                    onClick={() => handleCloseDay(pastDay, 'skipped')}
                    title="Skip (didn't track - excluded from learning baselines)"
                    className="min-h-[36px] rounded-lg border border-slate-700 px-2 text-xs font-medium text-slate-400 transition hover:text-white"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tonight's Summary Header */}
        <div className="mb-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-xl">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  {activeDate === today ? "Tonight's Entry" : `Entry for ${activeDate}`}
                </span>
                {todayStatus && activeDate === today && (
                  <span className="rounded-lg bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    Closed: {todayStatus}
                  </span>
                )}
                {activeDate !== today && (
                  <button
                    onClick={() => setActiveDate(today)}
                    className="text-[11px] font-semibold text-emerald-400 underline"
                  >
                    Back to Today
                  </button>
                )}
              </div>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
                {formatPaiseToRupees(discretionaryTotalPaise)}
              </h1>
              <span className="text-xs text-slate-400">
                Discretionary spend logged today ({discretionaryExpenses.length} entries)
              </span>
            </div>

            {/* Done for today & No spend today controls */}
            {activeDate === today && (
              <div className="flex flex-col gap-1.5 items-end">
                <button
                  onClick={() => handleCloseDay(today, 'logged')}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 text-xs font-black text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500 active:scale-95"
                >
                  <Check className="h-4 w-4" />
                  <span>Done for today</span>
                </button>
                <button
                  onClick={() => handleCloseDay(today, 'no_spend')}
                  className="text-[11px] font-semibold text-slate-400 hover:text-white transition"
                >
                  No spend today
                </button>
              </div>
            )}
          </div>

          {/* Today's Scheduled Read-Only Chips */}
          {scheduledExpenses.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-800/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                Fixed Scheduled Charges Today:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {scheduledExpenses.map((sc) => (
                  <span
                    key={sc.id}
                    className="inline-flex items-center gap-1 rounded-xl bg-purple-950/40 border border-purple-800/40 px-2.5 py-1 text-xs font-medium text-purple-300"
                  >
                    <Repeat className="h-3 w-3 text-purple-400" />
                    <span>{sc.merchant}: {formatPaiseToRupees(sc.amountPaise)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Undo Toast */}
        {undoItem && (
          <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-sm flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2 text-xs text-white">
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="truncate">Added {undoItem.name}</span>
            </div>
            <button
              onClick={handleUndo}
              className="flex min-h-[36px] items-center gap-1 rounded-xl bg-slate-800 px-3 text-xs font-bold text-amber-400 hover:bg-slate-700 active:scale-95"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Undo (5s)</span>
            </button>
          </div>
        )}

        {/* Quick-Repeat Row (Top 6 Combos) */}
        {quickRepeatCombos.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Flame className="h-3.5 w-3.5 text-amber-400" />
                <span>Quick-Repeat (1-Tap)</span>
              </span>
              <span className="text-[11px] text-slate-500">Learned from history</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {quickRepeatCombos.map((combo) => (
                <button
                  key={combo.key}
                  onClick={() => handleQuickRepeat(combo)}
                  className="flex items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-800 bg-slate-900/90 px-3.5 py-2.5 text-xs transition hover:border-emerald-500/50 hover:bg-slate-800 active:scale-95 shadow-md"
                >
                  <span className="font-bold text-white">{combo.merchant}</span>
                  <span className="rounded-lg bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.5 text-[11px] font-bold text-emerald-300">
                    {formatPaiseToRupees(combo.usualAmountPaise)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* FAST ENTRY FORM */}
        <section className="mb-6 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleFastSave} className="space-y-4">
            {/* Amount-First Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Amount (Accepts 250, 2.5k, 1.2L)
                </label>
                {/* One-Off Toggle */}
                <button
                  type="button"
                  onClick={() => setIsOneOff(!isOneOff)}
                  className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold transition ${
                    isOneOff
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Tag className="h-3 w-3" />
                  <span>{isOneOff ? 'One-off purchase' : 'Normal spend'}</span>
                </button>
              </div>

              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-500">
                  ₹
                </span>
                <input
                  ref={amountInputRef}
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  required
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0"
                  style={{ fontSize: '24px' }}
                  className="w-full rounded-2xl border-2 border-slate-800 bg-slate-950 py-3.5 pl-10 pr-4 font-black text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none transition"
                />
              </div>

              {errorMessage && (
                <p className="mt-1 text-xs font-medium text-rose-400">{errorMessage}</p>
              )}
            </div>

            {/* Category Chips (Ordered by user usage frequency) */}
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                Category
              </span>
              <div className="flex flex-wrap gap-1.5">
                {orderedCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`min-h-[40px] rounded-xl px-3 text-xs font-semibold transition active:scale-95 ${
                      selectedCategory === cat
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20 font-bold'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Merchant with History Autocomplete */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Merchant
                </label>
                <div className="relative">
                  <input
                    type="text"
                    list="merchants-list"
                    value={merchant}
                    onChange={(e) => handleMerchantChange(e.target.value)}
                    placeholder="e.g. Swiggy, Chaayos"
                    style={{ fontSize: '16px' }}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <datalist id="merchants-list">
                    {Array.from(merchantCategoryMap.keys()).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Dinner with team"
                  style={{ fontSize: '16px' }}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Fast Save Button */}
            <button
              type="submit"
              disabled={saving}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 text-sm font-black text-white shadow-xl shadow-emerald-950/50 transition hover:from-emerald-500 hover:to-teal-400 active:scale-95 disabled:opacity-50"
            >
              <Plus className="h-5 w-5" />
              <span>{saving ? 'Saving...' : 'Add Expense (Instant)'}</span>
            </button>
          </form>
        </section>

        {/* Today's Discretionary Entries List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Logged Entries Today
            </span>
            <span className="text-xs text-slate-500">
              Tap amount to edit
            </span>
          </div>

          {discretionaryExpenses.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
              No expenses entered yet today. Use the fast entry box above or tap a quick-repeat item.
            </div>
          ) : (
            <div className="space-y-2">
              {discretionaryExpenses.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/70 p-3.5 backdrop-blur-md"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">
                        {exp.merchant || exp.category}
                      </span>
                      {exp.oneOff && (
                        <span className="rounded bg-amber-950/60 border border-amber-800/40 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                          ONE-OFF
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span>{exp.category}</span>
                      {exp.note && <span>• {exp.note}</span>}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setEditingExpense(exp);
                      setEditAmountStr((exp.amountPaise / 100).toString());
                    }}
                    className="flex items-center gap-1 rounded-xl bg-slate-950/60 border border-slate-800/80 px-2.5 py-1.5 text-sm font-bold text-emerald-400 hover:border-emerald-500/50"
                  >
                    <span>{formatPaiseToRupees(exp.amountPaise)}</span>
                    <Edit2 className="h-3 w-3 text-slate-500 ml-1" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Edit Amount Modal */}
        {editingExpense && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
              <h3 className="font-bold text-sm text-white mb-1">
                Edit Amount: {editingExpense.merchant || editingExpense.category}
              </h3>
              <p className="text-xs text-slate-400 mb-3">Accepts shorthand (e.g. 350, 1.5k)</p>

              <input
                type="text"
                autoFocus
                inputMode="decimal"
                value={editAmountStr}
                onChange={(e) => setEditAmountStr(e.target.value)}
                style={{ fontSize: '18px' }}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none mb-4 font-bold"
              />

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditingExpense(null)}
                  className="min-h-[40px] px-3 font-semibold text-xs text-slate-400 hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEditAmount}
                  className="min-h-[40px] px-4 font-semibold text-xs text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg"
                >
                  Update Amount
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
