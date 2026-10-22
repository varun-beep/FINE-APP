'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/Navbar';
import { formatPaise, parseRupeesToPaise, paiseToDecimalString } from '@/lib/money';
import type { EngineOutput } from '@/lib/engine/types';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Clock,
  EyeOff,
  Sliders,
  DollarSign,
  X,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';


export default function InsightsPage() {
  const [data, setData] = useState<EngineOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [showNoise, setShowNoise] = useState(false);
  const [showCoverageReasons, setShowCoverageReasons] = useState(false);
  const [showBudgets, setShowBudgets] = useState(false);
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [savingCategory, setSavingCategory] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const fetchInsights = useCallback(async (fresh = false) => {
    try {
      const url = fresh ? '/api/insights?fresh=true' : '/api/insights';
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setData(json);

        // Report seen insights to increment times_shown ONLY on client render
        const renderedIds = (json.insights || [])
          .map((i: { id: string }) => i.id)
          .filter((id: string) => !id.startsWith('safe_to_spend'));
        if (renderedIds.length > 0) {
          fetch('/api/insights/seen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: renderedIds }),
          }).catch((e) => console.warn('Failed to record seen insights', e));
        }

        // Populate budget input values
        if (json.budgetRunRate?.categories) {
          const inputs: Record<string, string> = {};
          for (const cat of json.budgetRunRate.categories) {
            inputs[cat.category] = cat.monthlyLimitPaise
              ? paiseToDecimalString(cat.monthlyLimitPaise)
              : '';
          }
          setBudgetInputs(inputs);
        }
      }
    } catch (err) {
      console.error('Failed to load insights:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handleFeedback = async (
    insightId: string,
    feedback: 'not_now' | 'not_useful' | 'planned',
    expenseId?: string
  ) => {
    setFeedbackPending(insightId);
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insightId,
          feedback,
          expenseId,
        }),
      });

      if (res.ok) {
        // Refresh insights immediately
        await fetchInsights(true);
      }
    } catch (err) {
      console.error('Failed to submit insight feedback:', err);
    } finally {
      setFeedbackPending(null);
    }
  };

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
        <main className="flex-1 px-4 py-6 space-y-4 max-w-2xl mx-auto w-full">
          <div className="glass-card h-32 animate-pulse rounded-3xl" />
          <div className="glass-card h-44 animate-pulse rounded-3xl" />
          <div className="glass-card h-48 animate-pulse rounded-3xl" />
        </main>
      </div>
    );
  }

  const allowance = data?.allowance;
  const coverage = data?.coverage;
  const nonSafeInsights = (data?.insights || []).filter((i) => i.type !== 'safe_to_spend');
  const silentFlags = data?.silentFlags || [];

  return (
    <div className="flex min-h-screen flex-col pb-20">
      <Navbar />

      <main className="flex-1 px-4 py-6 space-y-6 max-w-2xl mx-auto w-full">
        {/* Header & Refresh */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-indigo-400" />
              Coach Brain
            </h1>
            <p className="text-xs text-white/60">
              Ranked, high-signal financial intelligence & safe-to-spend
            </p>
          </div>
          <button
            onClick={() => {
              setRefreshing(true);
              fetchInsights(true);
            }}
            disabled={refreshing}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-white/70"
            title="Refresh Analysis"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Coverage Strip */}
        {coverage && (
          <div className="glass-card p-3 rounded-2xl flex flex-col gap-2 text-xs text-white/70">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium text-white/90">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Data Confidence: {coverage.daysClosed} days closed • {coverage.weeksOfHistory} weeks history
              </span>
              {coverage.reasons.length > 0 && (
                <button
                  onClick={() => setShowCoverageReasons(!showCoverageReasons)}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
                >
                  {showCoverageReasons ? 'Hide details' : 'View details'}
                  {showCoverageReasons ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>

            {showCoverageReasons && coverage.reasons.length > 0 && (
              <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-white/60">
                {coverage.reasons.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-indigo-400" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 1. Safe-to-Spend Allowance Card (Top) */}
        {allowance ? (
          <div className="glass-card p-5 rounded-3xl relative overflow-hidden border border-indigo-500/20 bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-slate-900/60 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider font-semibold text-indigo-300 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" />
                Tonight&apos;s Safe-to-Spend
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  allowance.verdict === 'under'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : allowance.verdict === 'over'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}
              >
                {allowance.verdict === 'under'
                  ? 'Under Pace'
                  : allowance.verdict === 'over'
                  ? 'Over Pace'
                  : 'On Track'}
              </span>
            </div>

            <div className="flex items-baseline justify-between mb-4">
              <div>
                <div className="text-3xl font-extrabold text-white tracking-tight">
                  {formatPaise(allowance.dailyAllowancePaise)}
                  <span className="text-xs text-white/50 font-normal ml-1">/ day</span>
                </div>
                <div className="text-xs text-white/60 mt-0.5">
                  Today&apos;s spend: <span className="font-semibold text-white">{formatPaise(allowance.todaySpentPaise)}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-white/50">Tomorrow&apos;s Allowance</div>
                <div className="text-base font-bold text-indigo-300">
                  {formatPaise(allowance.tomorrowDailyAllowancePaise)}
                </div>
                {allowance.tomorrowWeekdayAllowancePaise !== allowance.tomorrowDailyAllowancePaise && (
                  <div className="text-[10px] text-white/50">
                    Weekday-weighted: {formatPaise(allowance.tomorrowWeekdayAllowancePaise)}
                  </div>
                )}
              </div>
            </div>

            {/* Budget Breakdown Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-white/10 text-xs">
              <div className="bg-black/20 p-2 rounded-xl">
                <div className="text-white/40 text-[10px]">Income</div>
                <div className="font-semibold text-white">{formatPaise(allowance.monthlyIncomePaise)}</div>
              </div>
              <div className="bg-black/20 p-2 rounded-xl">
                <div className="text-white/40 text-[10px]">Fixed Commitments</div>
                <div className="font-semibold text-rose-300">-{formatPaise(allowance.committedDuePaise)}</div>
              </div>
              <div className="bg-black/20 p-2 rounded-xl">
                <div className="text-white/40 text-[10px]">20% Savings Target</div>
                <div className="font-semibold text-emerald-300">-{formatPaise(allowance.savingsTargetPaise)}</div>
              </div>
              <div className="bg-black/20 p-2 rounded-xl">
                <div className="text-white/40 text-[10px]">Discretionary Left</div>
                <div className="font-semibold text-indigo-200">
                  {formatPaise(allowance.remainingDiscretionaryPaise)} ({allowance.daysLeftInMonth}d)
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-card p-5 rounded-3xl text-center text-white/60 text-xs">
            Add an income schedule on <a href="/commitments" className="text-indigo-400 underline">Commitments</a> to unlock your automated Safe-to-Spend daily allowance.
          </div>
        )}

        {/* 2. Ranked Insights Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/70">
              Ranked Coach Insights
            </h2>
            <span className="text-xs text-white/40">
              {nonSafeInsights.length} surfacing
            </span>
          </div>

          {nonSafeInsights.length === 0 ? (
            <div className="glass-card p-8 rounded-3xl text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h3 className="font-semibold text-white">Nothing notable today</h3>
              <p className="text-xs text-white/60 max-w-sm mx-auto">
                Your spending is smooth and running within normal baselines. No uncharacteristic spikes or drift detected. Silence is a valid answer.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {nonSafeInsights.map((insight, idx) => (
                <div
                  key={insight.id}
                  className="glass-card p-5 rounded-3xl relative overflow-hidden space-y-3.5 border border-white/10 hover:border-white/20 transition-all"
                >
                  {/* Top Bar: Rank, Title, Severity Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/80 font-bold text-xs flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-white leading-snug">
                          {insight.title}
                        </h3>
                        <div className="text-[11px] text-white/50 capitalize mt-0.5">
                          {insight.type.replace('_', ' ')} • Est. Impact: {formatPaise(insight.impactPaise)}/mo
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        insight.severity === 'alert'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : insight.severity === 'warning'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      }`}
                    >
                      {insight.severity.toUpperCase()}
                    </span>
                  </div>

                  {/* Structured Evidence Chips */}
                  <div className="bg-black/25 p-3 rounded-2xl flex flex-wrap gap-2 text-[11px] text-white/80">
                    {Object.entries(insight.evidence || {}).map(([k, v]) => {
                      if (v === null || v === undefined || typeof v === 'object') return null;
                      const label = k.replace(/Paise$/, '').replace(/([A-Z])/g, ' $1');
                      const displayVal = k.toLowerCase().includes('paise')
                        ? formatPaise(Number(v))
                        : String(v);

                      return (
                        <span
                          key={k}
                          className="bg-white/5 px-2 py-1 rounded-lg border border-white/5"
                        >
                          <span className="text-white/40 capitalize">{label}: </span>
                          <span className="font-medium text-white">{displayVal}</span>
                        </span>
                      );
                    })}
                  </div>

                  {/* Levers Box (Actionable Steps) */}
                  {insight.levers && insight.levers.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1">
                        <Sliders className="w-3 h-3" />
                        Actionable Levers:
                      </div>
                      <div className="space-y-1">
                        {insight.levers.map((lever) => (
                          <div
                            key={lever.id}
                            className="bg-indigo-950/30 border border-indigo-500/20 p-2.5 rounded-xl text-xs flex items-center justify-between"
                          >
                            <span className="text-white/90">{lever.description}</span>
                            {lever.monthlySavingPaise > 0 && (
                              <span className="font-semibold text-emerald-400 text-xs ml-2 flex-shrink-0">
                                Save ~{formatPaise(lever.monthlySavingPaise)}/mo
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Per-card Memory & Feedback Controls */}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-white/40">Is this helpful?</span>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleFeedback(insight.id, 'not_now')}
                        disabled={feedbackPending === insight.id}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 active:scale-95 text-white/60 transition-all flex items-center gap-1"
                        title="Dismiss for 3 days"
                      >
                        <Clock className="w-3 h-3" />
                        Not now
                      </button>

                      <button
                        onClick={() => handleFeedback(insight.id, 'not_useful')}
                        disabled={feedbackPending === insight.id}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 active:scale-95 text-white/60 transition-all flex items-center gap-1"
                        title="Dismiss permanently"
                      >
                        <X className="w-3 h-3" />
                        Not useful
                      </button>

                      {/* Planned button for outliers / spikes */}
                      {(insight.type === 'outlier' || insight.expenseId) && (
                        <button
                          onClick={() =>
                            handleFeedback(insight.id, 'planned', insight.expenseId)
                          }
                          disabled={feedbackPending === insight.id}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 active:scale-95 transition-all flex items-center gap-1"
                          title="Mark as planned one-off expense (removes from baselines)"
                        >
                          <BookmarkCheck className="w-3 h-3 text-indigo-300" />
                          Planned One-Off
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Filtered Noise / Silent Flags (Collapsible) */}
        {silentFlags.length > 0 && (
          <div className="glass-card p-4 rounded-3xl text-xs space-y-2 border border-white/5">
            <button
              onClick={() => setShowNoise(!showNoise)}
              className="w-full flex items-center justify-between text-white/60 hover:text-white"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <EyeOff className="w-3.5 h-3.5 text-white/40" />
                Filtered Outlier Noise ({silentFlags.length} items stayed silent)
              </span>
              {showNoise ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showNoise && (
              <div className="pt-2 border-t border-white/5 space-y-2">
                <p className="text-[11px] text-white/40">
                  These items were statistical variations but stayed silent because they did not meet the ₹500 floor or 5% budget threshold.
                </p>
                <div className="space-y-1.5">
                  {silentFlags.map((flag) => (
                    <div
                      key={flag.id}
                      className="bg-black/20 p-2.5 rounded-xl flex items-center justify-between text-white/70"
                    >
                      <span className="font-medium text-white/90">{flag.title}</span>
                      <span className="text-[10px] text-white/40">{flag.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. Category Budgets Drawer / Section */}
        <div className="glass-card p-4 rounded-3xl text-xs space-y-3 border border-white/5">
          <button
            onClick={() => setShowBudgets(!showBudgets)}
            className="w-full flex items-center justify-between text-white/70 hover:text-white font-medium"
          >
            <span className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              Manage Category Monthly Budgets
            </span>
            {showBudgets ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showBudgets && data?.budgetRunRate?.categories && (
            <div className="pt-2 border-t border-white/5 space-y-2.5">
              {data.budgetRunRate.categories.map((cat) => (
                <div
                  key={cat.category}
                  className="flex items-center justify-between gap-3 bg-black/20 p-2.5 rounded-xl"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-white">{cat.category}</div>
                    <div className="text-[10px] text-white/50">
                      Spent: {formatPaise(cat.spentSoFarPaise)} • Projected: {formatPaise(cat.projectedMonthEndPaise)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 text-xs">
                        ₹
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={budgetInputs[cat.category] || ''}
                        onChange={(e) =>
                          setBudgetInputs({
                            ...budgetInputs,
                            [cat.category]: e.target.value,
                          })
                        }
                        placeholder="Limit"
                        className="w-24 pl-6 pr-2 py-1 text-xs bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-400 text-right"
                      />
                    </div>
                    <button
                      onClick={() => handleSaveBudget(cat.category)}
                      disabled={savingCategory === cat.category}
                      className="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 text-xs font-medium"
                    >
                      {saveSuccess === cat.category ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
