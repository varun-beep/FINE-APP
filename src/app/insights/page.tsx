'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/Navbar';
import { formatPaise, parseRupeesToPaise, paiseToDecimalString } from '@/lib/money';
import { formatDisplayDate } from '@/lib/date';
import { CategoryBadge } from '@/components/CategoryBadge';
import { EXPENSE_CATEGORIES } from '@/lib/validations';
import type { EngineOutput } from '@/lib/engine/types';
import {
  Sparkles,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Calendar,
  CheckCircle2,
  PieChart,
  Save,
  Clock,
} from 'lucide-react';

export default function InsightsPage() {
  const [data, setData] = useState<EngineOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [savingCategory, setSavingCategory] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch('/api/insights');
      if (res.ok) {
        const json: EngineOutput = await res.json();
        setData(json);

        // Populate budget input values
        const inputs: Record<string, string> = {};
        for (const cat of json.budgetRunRate.categories) {
          inputs[cat.category] = cat.monthlyLimitPaise
            ? paiseToDecimalString(cat.monthlyLimitPaise)
            : '';
        }
        setBudgetInputs(inputs);
      }
    } catch (err) {
      console.error('Failed to load insights:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handleSaveBudget = async (category: string) => {
    const rawVal = budgetInputs[category]?.trim();
    if (!rawVal) return;

    let paise: number;
    try {
      paise = parseRupeesToPaise(rawVal);
      if (paise < 0) return;
    } catch {
      return;
    }

    setSavingCategory(category);
    try {
      const res = await fetch('/api/budgets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          monthly_limit_paise: paise,
        }),
      });

      if (res.ok) {
        setSaveSuccess(category);
        setTimeout(() => setSaveSuccess(null), 2500);
        fetchInsights();
      }
    } catch (err) {
      console.error('Failed to save budget:', err);
    } finally {
      setSavingCategory(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col pb-16">
        <Navbar />
        <main className="flex-1 px-4 py-6 space-y-4">
          <div className="glass-card h-28 animate-pulse rounded-3xl" />
          <div className="glass-card h-40 animate-pulse rounded-3xl" />
          <div className="glass-card h-52 animate-pulse rounded-3xl" />
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col pb-16">
        <Navbar />
        <main className="flex-1 px-4 py-12 text-center text-slate-400">
          <p>No insights available yet. Log expenses to train SpendCoach.</p>
        </main>
      </div>
    );
  }

  const { learning, transactionAnomalies, dailyAnomalies, recurring, budgetRunRate, trends } = data;

  // Learning progress calculations
  const expProgress = Math.min(100, Math.round((learning.expenseCount / learning.expenseThreshold) * 100));
  const dayProgress = Math.min(100, Math.round((learning.distinctDaysCount / learning.distinctDaysThreshold) * 100));
  const overallProgress = learning.status === 'ready' ? 100 : Math.round((expProgress + dayProgress) / 2);

  return (
    <div className="flex min-h-screen flex-col pb-20">
      <Navbar />

      <main className="flex-1 px-4 py-4 space-y-6">
        {/* 1. Learning State Progress Banner */}
        <section className="glass-panel relative overflow-hidden rounded-3xl p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Engine Status
              </h2>
            </div>
            <span
              className={`rounded-lg px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                learning.status === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40'
                  : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40'
              }`}
            >
              {learning.status === 'ready' ? 'Active' : 'Learning'}
            </span>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-medium">
              <span>Baseline Confidence</span>
              <span className="font-bold text-white">{overallProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          {learning.status === 'learning' ? (
            <p className="mt-3 text-xs text-slate-400 leading-relaxed">
              SpendCoach is observing your habits. Needs{' '}
              <strong className="text-amber-300 font-semibold">{learning.expensesNeeded} more expenses</strong>{' '}
              and{' '}
              <strong className="text-amber-300 font-semibold">{learning.daysNeeded} more days</strong> of data
              before anomaly detection activates.
            </p>
          ) : (
            <p className="mt-3 text-xs text-emerald-400/90 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Personal baseline established. Anomaly alerts active.</span>
            </p>
          )}
        </section>

        {/* 2. Detected Transaction Anomalies */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <span>Anomalies Flagged</span>
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              {transactionAnomalies.length} found
            </span>
          </div>

          {transactionAnomalies.length === 0 ? (
            <div className="glass-panel flex flex-col items-center justify-center rounded-2xl py-8 text-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-400 mb-1.5" />
              <p className="text-xs font-semibold text-slate-300">No unusual spending detected</p>
              <p className="text-[11px] text-slate-500 mt-0.5">All transactions align with your historical median.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactionAnomalies.map((a) => (
                <div
                  key={a.expenseId}
                  className="glass-card relative overflow-hidden rounded-2xl p-4 border-l-4 border-l-amber-400"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <CategoryBadge category={a.category} size="sm" />
                        <span className="text-xs text-slate-400">{formatDisplayDate(a.spentOn)}</span>
                      </div>
                      {a.merchant && (
                        <p className="text-xs font-semibold text-white mt-1">{a.merchant}</p>
                      )}
                      <p className="text-xs font-medium text-amber-300 mt-1">{a.reason}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-amber-400">
                        {formatPaise(a.amountPaise)}
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        Median: {formatPaise(a.medianPaise)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Daily Total Anomalies (if any) */}
        {dailyAnomalies.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
              Unusual Daily Spikes
            </h3>
            <div className="space-y-2">
              {dailyAnomalies.map((da) => (
                <div key={da.date} className="glass-card rounded-2xl p-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white">{formatDisplayDate(da.date)}</span>
                    <p className="text-xs text-amber-300 mt-0.5">{da.reason}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-amber-400">{formatPaise(da.totalPaise)}</span>
                    <span className="block text-[10px] text-slate-500">Median: {formatPaise(da.medianPaise)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 4. Recurring Charges */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4 text-emerald-400" />
              <span>Recurring Subscriptions</span>
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              {recurring.length} active
            </span>
          </div>

          {recurring.length === 0 ? (
            <div className="glass-panel flex flex-col items-center justify-center rounded-2xl py-8 text-center">
              <Clock className="h-7 w-7 text-slate-600 mb-1.5" />
              <p className="text-xs font-semibold text-slate-300">No recurring items identified</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Identifies weekly/monthly patterns after 3 occurrences.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recurring.map((item) => (
                <div key={item.id} className="glass-card rounded-2xl p-3.5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{item.merchantOrNote}</span>
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 capitalize">
                        {item.interval}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                      <Calendar className="h-3 w-3 text-slate-500" />
                      <span>Next: {formatDisplayDate(item.nextExpectedDate)}</span>
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-white">
                      {formatPaise(item.estimatedAmountPaise)}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      ~{formatPaise(item.monthlyCostEstimatePaise)}/mo
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. Month-End Run-Rate & Budget Status */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1 flex items-center gap-1.5">
            <PieChart className="h-4 w-4 text-emerald-400" />
            <span>Monthly Run-Rate & Budgets</span>
          </h3>

          <div className="glass-panel rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Projected Month-End
                </span>
                <h4 className="text-2xl font-black text-white mt-0.5">
                  {formatPaise(budgetRunRate.projectedMonthEndPaise)}
                </h4>
                <span className="text-xs text-slate-400">
                  Spent so far: {formatPaise(budgetRunRate.spentSoFarPaise)}
                </span>
              </div>

              <span
                className={`rounded-xl px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                  budgetRunRate.budgetStatus === 'over'
                    ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/30'
                    : budgetRunRate.budgetStatus === 'warning'
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                }`}
              >
                {budgetRunRate.budgetStatus.replace('_', ' ')}
              </span>
            </div>

            {/* Category Run-Rate Progress Bars */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              {budgetRunRate.categories.map((c) => {
                if (c.spentSoFarPaise === 0 && !c.monthlyLimitPaise) return null;
                return (
                  <div key={c.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-white">{c.category}</span>
                      <span className="text-slate-400">
                        {formatPaise(c.spentSoFarPaise)}{' '}
                        {c.monthlyLimitPaise ? `/ ${formatPaise(c.monthlyLimitPaise)}` : ''}
                      </span>
                    </div>

                    {c.monthlyLimitPaise && c.monthlyLimitPaise > 0 ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${
                            c.budgetStatus === 'over'
                              ? 'bg-rose-500'
                              : c.budgetStatus === 'warning'
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          }`}
                          style={{
                            width: `${Math.min(100, (c.spentSoFarPaise / c.monthlyLimitPaise) * 100)}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 6. Spending Trends (WoW and MoM) */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span>Spending Trends</span>
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card rounded-2xl p-4">
              <span className="text-[11px] font-medium text-slate-400">Last 7 Days vs Prior</span>
              <div className="flex items-center gap-1.5 mt-1.5">
                {trends.weekOverWeekPercent !== null && trends.weekOverWeekPercent > 0 ? (
                  <TrendingUp className="h-4 w-4 text-rose-400 shrink-0" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-emerald-400 shrink-0" />
                )}
                <span className="text-lg font-bold text-white">
                  {trends.weekOverWeekPercent !== null
                    ? `${trends.weekOverWeekPercent > 0 ? '+' : ''}${trends.weekOverWeekPercent}%`
                    : 'N/A'}
                </span>
              </div>
              <span className="block text-[10px] text-slate-500 mt-0.5">
                {formatPaise(trends.last7DaysPaise)} vs {formatPaise(trends.prev7DaysPaise)}
              </span>
            </div>

            <div className="glass-card rounded-2xl p-4">
              <span className="text-[11px] font-medium text-slate-400">Month-to-Date vs Prior</span>
              <div className="flex items-center gap-1.5 mt-1.5">
                {trends.monthOverMonthPercent !== null && trends.monthOverMonthPercent > 0 ? (
                  <TrendingUp className="h-4 w-4 text-rose-400 shrink-0" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-emerald-400 shrink-0" />
                )}
                <span className="text-lg font-bold text-white">
                  {trends.monthOverMonthPercent !== null
                    ? `${trends.monthOverMonthPercent > 0 ? '+' : ''}${trends.monthOverMonthPercent}%`
                    : 'N/A'}
                </span>
              </div>
              <span className="block text-[10px] text-slate-500 mt-0.5">
                {formatPaise(trends.currentMonthToDatePaise)} vs {formatPaise(trends.prevMonthToDatePaise)}
              </span>
            </div>
          </div>
        </section>

        {/* 7. Category Budget Settings */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Manage Monthly Budgets
            </h3>
            <span className="text-[11px] text-slate-500">₹ per month</span>
          </div>

          <div className="glass-panel rounded-3xl p-4 divide-y divide-slate-800/80">
            {EXPENSE_CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <CategoryBadge category={cat} size="sm" showLabel={true} />
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex items-center">
                    <span className="absolute left-2.5 text-xs text-slate-500">₹</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      placeholder="0.00"
                      value={budgetInputs[cat] || ''}
                      onChange={(e) =>
                        setBudgetInputs({
                          ...budgetInputs,
                          [cat]: e.target.value.replace(/[^0-9.]/g, ''),
                        })
                      }
                      className="w-24 rounded-xl border border-slate-800 bg-slate-900/90 py-1.5 pl-6 pr-2 text-right text-xs font-bold text-white outline-none focus:border-emerald-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSaveBudget(cat)}
                    disabled={savingCategory === cat}
                    className={`flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl transition ${
                      saveSuccess === cat
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                    }`}
                    title="Save budget"
                  >
                    {saveSuccess === cat ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
