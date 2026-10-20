'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ShieldAlert,
  ArrowRight,
  PiggyBank,
  Briefcase,
  AlertCircle,
  Clock,
} from 'lucide-react';
import type { DailyReviewResult } from '@/lib/llm/types';

export default function ReviewPage() {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [review, setReview] = useState<DailyReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastDates, setPastDates] = useState<string[]>([]);

  const fetchReview = useCallback(async (date?: string, isRegen = false) => {
    try {
      if (isRegen) {
        setRegenerating(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const res = await fetch('/api/daily-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: date || undefined,
          regenerate: isRegen,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to fetch review');
      }

      const data: DailyReviewResult = await res.json();
      setReview(data);
      if (data.date) {
        setSelectedDate(data.date);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, []);

  // Fetch past review dates for the history selector
  const fetchPastDates = useCallback(async () => {
    try {
      const res = await fetch('/api/expenses');
      if (res.ok) {
        const data = await res.json();
        if (data?.expenses && Array.isArray(data.expenses)) {
          const uniqueDates = Array.from(
            new Set<string>(data.expenses.map((e: { spentOn: string }) => e.spentOn))
          )
            .sort()
            .reverse()
            .slice(0, 7);
          setPastDates(uniqueDates);
        }
      }
    } catch {
      // Non-critical, fallback to current date only
    }
  }, []);

  useEffect(() => {
    fetchReview();
    fetchPastDates();
  }, [fetchReview, fetchPastDates]);

  const handleRegenerate = () => {
    if (regenerating || !review?.canRegenerate) return;
    fetchReview(selectedDate, true);
  };

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    fetchReview(date, false);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 shadow-md shadow-emerald-500/20">
              <Sparkles className="h-5 w-5 fill-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Daily Review</h1>
              <p className="text-xs text-slate-400">AI financial coach powered by your engine data</p>
            </div>
          </div>

          {/* Regenerate Button */}
          {review && !review.isLearning && (
            <button
              onClick={handleRegenerate}
              disabled={regenerating || !review.canRegenerate}
              title={
                review.canRegenerate
                  ? `Regenerate advice (${5 - review.regenerationCount} left today)`
                  : 'Daily regeneration limit reached (5/5)'
              }
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow transition active:scale-95 ${
                review.canRegenerate
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30'
                  : 'cursor-not-allowed bg-slate-800/40 text-slate-500 ring-1 ring-slate-800'
              }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{regenerating ? 'Thinking...' : 'Regenerate'}</span>
              <span className="ml-1 rounded-full bg-slate-900/60 px-1.5 py-0.2 text-[10px] text-slate-400">
                {5 - (review?.regenerationCount || 0)} left
              </span>
            </button>
          )}
        </div>

        {/* Date Selector Chips */}
        {pastDates.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 text-xs no-scrollbar">
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <Calendar className="h-3 w-3" />
            </span>
            {pastDates.map((d) => (
              <button
                key={d}
                onClick={() => handleSelectDate(d)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  selectedDate === d
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                {d === pastDates[0] ? `Today (${d})` : d}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-2xl bg-slate-800/50 p-5 ring-1 ring-slate-700/40" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="h-40 animate-pulse rounded-2xl bg-slate-800/40 p-4 ring-1 ring-slate-700/30" />
            <div className="h-40 animate-pulse rounded-2xl bg-slate-800/40 p-4 ring-1 ring-slate-700/30" />
          </div>
          <div className="h-28 animate-pulse rounded-2xl bg-slate-800/40 p-4 ring-1 ring-slate-700/30" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 text-rose-300">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5 text-rose-400" />
            <span>Could not load review</span>
          </div>
          <p className="mt-1 text-xs text-rose-300/80">{error}</p>
          <button
            onClick={() => fetchReview(selectedDate)}
            className="mt-3 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
          >
            Retry
          </button>
        </div>
      ) : review ? (
        <div className="space-y-4">
          {/* Main Card */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900/70 p-5 shadow-xl backdrop-blur-md">
            {/* Top Bar with Mood and Source Badge */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400">Date: {review.date}</span>
                {/* Mood Tag */}
                {review.advice.mood && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                      review.advice.mood === 'good'
                        ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                        : review.advice.mood === 'ok'
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
                        : 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/30'
                    }`}
                  >
                    Mood: {review.advice.mood}
                  </span>
                )}
              </div>

              {/* Source Badge */}
              {review.isLearning ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-[11px] font-medium text-blue-300 ring-1 ring-blue-500/30">
                  <Clock className="h-3 w-3" />
                  Learning Phase
                </span>
              ) : review.source === 'fallback' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/40">
                  <ShieldAlert className="h-3 w-3 text-amber-400" />
                  Fallback Advice
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-teal-300 ring-1 ring-teal-500/30">
                  <Sparkles className="h-3 w-3 text-teal-400" />
                  AI Generated
                </span>
              )}
            </div>

            {/* Headline */}
            <div className="mt-4">
              <h2 className="text-lg font-bold leading-snug text-white sm:text-xl">
                {review.advice.headline}
              </h2>
            </div>

            {/* Learning Progress (if learning) */}
            {review.isLearning && review.learningProgress && (
              <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-950/20 p-4">
                <div className="flex items-center justify-between text-xs text-blue-200">
                  <span>Expenses: {review.learningProgress.expenseCount} / {review.learningProgress.expenseThreshold}</span>
                  <span>Days: {review.learningProgress.distinctDaysCount} / {review.learningProgress.distinctDaysThreshold}</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-950">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-teal-400 transition-all duration-500"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((review.learningProgress.expenseCount / review.learningProgress.expenseThreshold +
                            review.learningProgress.distinctDaysCount /
                              review.learningProgress.distinctDaysThreshold) /
                            2) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-blue-300/90">
                  Need {review.learningProgress.expensesNeeded} more entries across{' '}
                  {review.learningProgress.daysNeeded} more days before anomaly flagging unlocks.
                </p>
              </div>
            )}

            {/* Action Tomorrow Highlight Box */}
            <div className="mt-5 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-slate-900/60 to-slate-950 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                <ArrowRight className="h-4 w-4" />
                <span>Tomorrow&apos;s One Action</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-emerald-100">
                {review.advice.action_tomorrow}
              </p>
            </div>
          </div>

          {/* Grid: Went Well vs Watch Out */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Went Well */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Went Well</span>
              </div>
              <ul className="mt-3 space-y-2.5 text-xs text-slate-300">
                {review.advice.went_well.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Watch Out */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                <span>Watch Out</span>
              </div>
              {review.advice.watch_out.length === 0 ? (
                <p className="mt-3 text-xs italic text-slate-500">
                  No critical spending warnings or budget overruns detected.
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5 text-xs text-slate-300">
                  {review.advice.watch_out.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Grid: Saving Ideas vs Earning Ideas */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Saving Ideas */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 text-xs font-bold uppercase tracking-wider text-teal-400">
                <PiggyBank className="h-4 w-4 text-teal-400" />
                <span>Saving Ideas</span>
              </div>
              <ul className="mt-3 space-y-2.5 text-xs text-slate-300">
                {review.advice.saving_ideas.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Earning Ideas */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 text-xs font-bold uppercase tracking-wider text-indigo-400">
                <Briefcase className="h-4 w-4 text-indigo-400" />
                <span>Earning Ideas</span>
              </div>
              {review.advice.earning_ideas.length === 0 ? (
                <p className="mt-3 text-xs italic text-slate-500">
                  No additional side-income ideas needed for this period.
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5 text-xs text-slate-300">
                  {review.advice.earning_ideas.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Disclaimer Footer */}
          <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-center">
            <p className="text-[11px] text-slate-500">{review.disclaimer}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
