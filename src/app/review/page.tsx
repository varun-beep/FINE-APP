'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ArrowRight,
  TrendingUp,
  Clock,
  FlaskConical,
  Trophy,
  Check,
  CalendarDays,
  Target,
  PiggyBank,
  Briefcase,
  HelpCircle,
} from 'lucide-react';
import type {
  DailyReviewResult,
  WeeklyReviewResult,
  MonthlyReviewResult,
} from '@/lib/llm/types';

type ReviewTab = 'daily' | 'weekly' | 'monthly';

export default function ReviewPage() {
  const [tab, setTab] = useState<ReviewTab>('daily');
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Daily State
  const [dailyReview, setDailyReview] = useState<DailyReviewResult | null>(null);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [errorDaily, setErrorDaily] = useState<string | null>(null);
  const [pastDates, setPastDates] = useState<string[]>([]);

  // Weekly State
  const [weeklyReview, setWeeklyReview] = useState<WeeklyReviewResult | null>(null);
  const [loadingWeekly, setLoadingWeekly] = useState(false);
  const [errorWeekly, setErrorWeekly] = useState<string | null>(null);

  // Monthly State
  const [monthlyReview, setMonthlyReview] = useState<MonthlyReviewResult | null>(null);
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [errorMonthly, setErrorMonthly] = useState<string | null>(null);

  // Experiment Action State
  const [experimentToast, setExperimentToast] = useState<string | null>(null);
  const [acceptingExp, setAcceptingExp] = useState(false);

  // Feedback State
  const [feedbackSent, setFeedbackSent] = useState<Record<string, string>>({});

  // 1. Fetch Daily Review (with polling support if review generation is in-flight)
  const fetchDailyReview = useCallback(async (date?: string, isRegen = false) => {
    try {
      if (isRegen) {
        setRegenerating(true);
      } else {
        setLoadingDaily(true);
      }
      setErrorDaily(null);

      let attempts = 0;
      let data: DailyReviewResult | null = null;

      while (attempts < 20) {
        attempts++;
        const res = await fetch('/api/daily-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: date || undefined,
            regenerate: isRegen,
          }),
        });

        if (res.status === 202) {
          // Still generating in background, wait and poll
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.message || 'Failed to fetch review');
        }

        const json = await res.json();
        if (json.status === 'generating') {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }

        data = json as DailyReviewResult;
        break;
      }

      if (!data) {
        throw new Error('Review generation timed out. Please try again.');
      }

      setDailyReview(data);
      if (data.date) {
        setSelectedDate(data.date);
      }

      // Report seen insights to increment times_shown ONLY on client render
      const seenIds: string[] = [];
      if (data.advice?.insights) {
        for (const ins of data.advice.insights) {
          if (ins.insight_id && !ins.insight_id.startsWith('safe_to_spend')) {
            seenIds.push(ins.insight_id);
          }
        }
      }
      if (seenIds.length > 0) {
        fetch('/api/insights/seen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: seenIds }),
        }).catch((e) => console.warn('Failed to record seen insights from review', e));
      }
    } catch (err) {
      setErrorDaily((err as Error).message);
    } finally {
      setLoadingDaily(false);
      setRegenerating(false);
    }
  }, []);

  // 2. Fetch Weekly Review
  const fetchWeeklyReview = useCallback(async (date?: string) => {
    try {
      setLoadingWeekly(true);
      setErrorWeekly(null);
      const url = date ? `/api/reviews/weekly?date=${date}` : '/api/reviews/weekly';
      const res = await fetch(url);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to fetch weekly review');
      }
      const data: WeeklyReviewResult = await res.json();
      setWeeklyReview(data);
    } catch (err) {
      setErrorWeekly((err as Error).message);
    } finally {
      setLoadingWeekly(false);
    }
  }, []);

  // 3. Fetch Monthly Review
  const fetchMonthlyReview = useCallback(async (date?: string) => {
    try {
      setLoadingMonthly(true);
      setErrorMonthly(null);
      const url = date ? `/api/reviews/monthly?date=${date}` : '/api/reviews/monthly';
      const res = await fetch(url);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to fetch monthly review');
      }
      const data: MonthlyReviewResult = await res.json();
      setMonthlyReview(data);
    } catch (err) {
      setErrorMonthly((err as Error).message);
    } finally {
      setLoadingMonthly(false);
    }
  }, []);

  // Fetch past review dates
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
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchDailyReview();
    fetchPastDates();
  }, [fetchDailyReview, fetchPastDates]);

  // Tab switch handler
  const handleTabChange = (newTab: ReviewTab) => {
    setTab(newTab);
    if (newTab === 'weekly' && !weeklyReview && !loadingWeekly) {
      fetchWeeklyReview();
    } else if (newTab === 'monthly' && !monthlyReview && !loadingMonthly) {
      fetchMonthlyReview();
    }
  };

  const handleRegenerate = () => {
    if (regenerating || !dailyReview?.canRegenerate) return;
    fetchDailyReview(selectedDate, true);
  };

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    fetchDailyReview(date, false);
  };

  // Accept Lever as Experiment
  const handleAcceptExperiment = async (
    leverId?: string,
    category?: string,
    description?: string,
    target?: string,
    baseline?: number
  ) => {
    try {
      setAcceptingExp(true);
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leverId: leverId || 'lever:custom',
          category: category || 'Discretionary',
          target: target || description || 'Limit spend for 4 weeks',
          baseline: baseline || 200000,
          durationWeeks: 4,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setExperimentToast(data.message || 'Failed to start experiment');
      } else {
        setExperimentToast('Experiment active! Tracking progress over the next 4 weeks.');
      }
    } catch (err) {
      setExperimentToast((err as Error).message);
    } finally {
      setAcceptingExp(false);
      setTimeout(() => setExperimentToast(null), 4000);
    }
  };

  // Feedback on Insight
  const handleFeedback = async (
    insightKey: string,
    feedback: 'not_useful' | 'already_know' | 'planned'
  ) => {
    try {
      setFeedbackSent((prev) => ({ ...prev, [insightKey]: feedback }));
      await fetch('/api/insights/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightKey, feedback }),
      });
    } catch {
      // Non-critical
    }
  };

  return (
    <div className="space-y-5 pb-24 max-w-xl mx-auto px-4 pt-2">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 shadow-md shadow-emerald-500/20">
              <Sparkles className="h-5 w-5 fill-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white">SpendCoach Review</h1>
              <p className="text-xs text-slate-400">Ranked financial coaching powered by engine evidence</p>
            </div>
          </div>

          {/* Regenerate Button (Daily tab only) */}
          {tab === 'daily' && dailyReview && !dailyReview.isLearning && (
            <button
              onClick={handleRegenerate}
              disabled={regenerating || !dailyReview.canRegenerate}
              title={
                dailyReview.canRegenerate
                  ? `Regenerate advice (${5 - dailyReview.regenerationCount} left today)`
                  : 'Daily regeneration limit reached (5/5)'
              }
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow transition active:scale-95 ${
                dailyReview.canRegenerate
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30'
                  : 'cursor-not-allowed bg-slate-800/40 text-slate-500 ring-1 ring-slate-800'
              }`}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  regenerating ? 'animate-spin text-emerald-400 motion-reduce:animate-none' : ''
                }`}
              />
              <span>{regenerating ? 'Thinking...' : 'Regenerate'}</span>
              <span className="ml-1 rounded-full bg-slate-900/60 px-1.5 py-0.2 text-[10px] text-slate-400">
                {5 - (dailyReview?.regenerationCount || 0)} left
              </span>
            </button>
          )}
        </div>

        {/* Tab Switcher: Daily | Weekly | Monthly */}
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-900/90 p-1 border border-slate-800/80">
          <button
            onClick={() => handleTabChange('daily')}
            className={`min-h-[38px] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              tab === 'daily'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Daily</span>
          </button>
          <button
            onClick={() => handleTabChange('weekly')}
            className={`min-h-[38px] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              tab === 'weekly'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span>Weekly</span>
          </button>
          <button
            onClick={() => handleTabChange('monthly')}
            className={`min-h-[38px] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              tab === 'monthly'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            <span>Monthly</span>
          </button>
        </div>

        {/* Date Selector Chips (Daily Tab) */}
        {tab === 'daily' && pastDates.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 text-xs no-scrollbar">
            <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
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

      {/* Experiment Toast Notification */}
      {experimentToast && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-3.5 text-xs text-emerald-200 shadow-xl backdrop-blur-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{experimentToast}</span>
          </div>
          <button
            onClick={() => setExperimentToast(null)}
            className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 1: DAILY REVIEW                                     */}
      {/* Strict Order: Verdict -> Win -> Insights -> Action      */}
      {/* ======================================================== */}
      {tab === 'daily' && (
        <>
          {loadingDaily ? (
            <div className="space-y-4">
              <div className="rounded-3xl border border-emerald-500/30 bg-slate-900/90 p-8 text-center backdrop-blur-xl shadow-xl">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                  <RefreshCw className="h-7 w-7 animate-spin text-emerald-400 motion-reduce:animate-none" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-white tracking-tight">Generating your review...</h3>
                <p className="mt-1.5 text-xs text-slate-400 max-w-xs mx-auto">
                  Synthesizing today&apos;s spending, budget status, and financial levers.
                </p>
              </div>
              <div className="h-28 rounded-2xl bg-slate-800/40 p-5 ring-1 ring-slate-700/40 animate-pulse motion-reduce:animate-none" />
              <div className="h-20 rounded-2xl bg-slate-800/30 p-4 ring-1 ring-slate-700/30 animate-pulse motion-reduce:animate-none" />
            </div>
          ) : errorDaily ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 text-rose-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
                <span>Could not load daily review</span>
              </div>
              <p className="mt-1 text-xs text-rose-300/80">{errorDaily}</p>
              <button
                onClick={() => fetchDailyReview(selectedDate)}
                className="mt-3 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
              >
                Retry
              </button>
            </div>
          ) : dailyReview ? (
            <div className="space-y-4">
              {/* Learning Mode Empty State Card */}
              {dailyReview.isLearning && dailyReview.learningProgress && (
                <div className="rounded-3xl border border-blue-500/40 bg-blue-950/20 p-5 backdrop-blur-md">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400">
                    <Clock className="h-4 w-4" />
                    <span>Learning Mode Active</span>
                  </div>
                  <h2 className="mt-2 text-base font-bold text-white">
                    Establishing your personal spending baseline
                  </h2>
                  <p className="mt-1 text-xs text-blue-200/90 leading-relaxed">
                    Need {dailyReview.learningProgress.expensesNeeded} more entries across{' '}
                    {dailyReview.learningProgress.daysNeeded} more days before anomaly flagging and custom levers unlock.
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-900/80 p-3 border border-blue-900/40">
                      <span className="text-[11px] text-slate-400 block">Logged Entries</span>
                      <span className="text-lg font-black text-white">
                        {dailyReview.learningProgress.expenseCount} / {dailyReview.learningProgress.expenseThreshold}
                      </span>
                    </div>
                    <div className="rounded-xl bg-slate-900/80 p-3 border border-blue-900/40">
                      <span className="text-[11px] text-slate-400 block">Distinct Days</span>
                      <span className="text-lg font-black text-white">
                        {dailyReview.learningProgress.distinctDaysCount} / {dailyReview.learningProgress.distinctDaysThreshold}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 1. VERDICT CARD */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <span className="text-xs font-medium text-slate-400">Date: {dailyReview.date}</span>
                  <div className="flex items-center gap-1.5">
                    {dailyReview.advice.mood && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          dailyReview.advice.mood === 'celebratory' || dailyReview.advice.mood === 'good'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : dailyReview.advice.mood === 'direct'
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : dailyReview.advice.mood === 'cautious' || dailyReview.advice.mood === 'careful'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {dailyReview.advice.mood}
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        dailyReview.source === 'llm'
                          ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {dailyReview.source === 'llm' ? 'AI Review' : 'Engine Fallback'}
                    </span>
                  </div>
                </div>

                <div className="mt-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                    Verdict
                  </span>
                  <h2 className="text-lg font-black leading-snug text-white sm:text-xl">
                    {dailyReview.advice.verdict}
                  </h2>
                </div>

                <div className="mt-3 text-xs leading-relaxed text-slate-300">
                  <span className="font-semibold text-slate-400">Why it matters: </span>
                  <span>{dailyReview.advice.why_it_matters}</span>
                </div>
              </div>

              {/* 2. WIN CARD (Genuinely good, null if nothing is true) */}
              {dailyReview.advice.win && (
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-slate-900 p-4 backdrop-blur-md">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                    <Trophy className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Today&apos;s Win</span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-emerald-100">
                    {dailyReview.advice.win}
                  </p>
                </div>
              )}

              {/* 3. RANKED INSIGHTS (<= 3, from supplied engine candidate list) */}
              <div className="space-y-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1 block">
                  Ranked Engine Insights ({dailyReview.advice.insights?.length || 0})
                </span>

                {(!dailyReview.advice.insights || dailyReview.advice.insights.length === 0) ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center">
                    <p className="text-xs text-slate-400 italic">
                      Nothing notable today; all category spending is tracking comfortably within expected parameters.
                    </p>
                  </div>
                ) : (
                  dailyReview.advice.insights.map((ins, idx) => {
                    const isFeedbackGiven = feedbackSent[ins.insight_id];
                    return (
                      <div
                        key={ins.insight_id || idx}
                        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur-sm transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                              Insight #{idx + 1}
                            </span>
                            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-200">
                              {ins.narrative}
                            </p>
                          </div>
                        </div>

                        {/* Feedback learning buttons: Not useful / Already know / Planned */}
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="text-slate-500">Coach feedback:</span>
                          {isFeedbackGiven ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              <span>Feedback noted ({isFeedbackGiven})</span>
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleFeedback(ins.insight_id, 'not_useful')}
                                className="rounded-lg bg-slate-800 px-2 py-1 text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 transition"
                              >
                                Not useful
                              </button>
                              <button
                                onClick={() => handleFeedback(ins.insight_id, 'already_know')}
                                className="rounded-lg bg-slate-800 px-2 py-1 text-slate-400 hover:text-amber-300 hover:bg-amber-950/30 transition"
                              >
                                Already know
                              </button>
                              <button
                                onClick={() => handleFeedback(ins.insight_id, 'planned')}
                                className="rounded-lg bg-slate-800 px-2 py-1 text-slate-400 hover:text-teal-300 hover:bg-teal-950/30 transition"
                              >
                                Planned
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 4. ONE ACTION TOMORROW (WITH ACCEPT AS EXPERIMENT BUTTON) */}
              <div className="rounded-3xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/50 via-slate-900 to-slate-950 p-5 shadow-xl backdrop-blur-md">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                  <ArrowRight className="h-4 w-4" />
                  <span>One Action Tomorrow</span>
                </div>
                <p className="mt-2 text-sm font-bold text-white leading-relaxed">
                  {dailyReview.advice.one_action_tomorrow}
                </p>

                {/* Accept as Experiment CTA */}
                <div className="mt-4 pt-3 border-t border-emerald-500/20 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">
                    Turn this recommendation into a 4-week goal:
                  </span>
                  <button
                    onClick={() =>
                      handleAcceptExperiment(
                        dailyReview.advice.insights?.[0]?.lever_id,
                        'Discretionary',
                        dailyReview.advice.one_action_tomorrow
                      )
                    }
                    disabled={acceptingExp}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-xs font-black text-slate-950 shadow-md transition hover:bg-emerald-400 active:scale-95 disabled:opacity-50"
                  >
                    <FlaskConical className="h-3.5 w-3.5" />
                    <span>{acceptingExp ? 'Starting...' : 'Accept as experiment'}</span>
                  </button>
                </div>
              </div>

              {/* Disclaimer Footer */}
              <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-center">
                <p className="text-[11px] text-slate-500">{dailyReview.disclaimer}</p>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* ======================================================== */}
      {/* TAB 2: WEEKLY REVIEW (Sunday 9 AM IST)                  */}
      {/* Spend vs prior weeks, best/worst trend, savings rate, exp */}
      {/* ======================================================== */}
      {tab === 'weekly' && (
        <>
          {loadingWeekly ? (
            <div className="space-y-4">
              <div className="h-32 rounded-2xl bg-slate-800/50 p-5 animate-pulse motion-reduce:animate-none" />
              <div className="h-36 rounded-2xl bg-slate-800/40 p-4 animate-pulse motion-reduce:animate-none" />
              <div className="h-28 rounded-2xl bg-slate-800/40 p-4 animate-pulse motion-reduce:animate-none" />
            </div>
          ) : errorWeekly ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 text-rose-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
                <span>Could not load weekly review</span>
              </div>
              <p className="mt-1 text-xs text-rose-300/80">{errorWeekly}</p>
              <button
                onClick={() => fetchWeeklyReview()}
                className="mt-3 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
              >
                Retry
              </button>
            </div>
          ) : weeklyReview ? (
            <div className="space-y-4">
              {/* Verdict Card */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <span className="text-xs font-medium text-slate-400">
                    Week ending {weeklyReview.date}
                  </span>
                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30">
                    Weekly Review
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-black text-white leading-snug">
                  {weeklyReview.advice.verdict}
                </h2>
                <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                  {weeklyReview.advice.spend_vs_prior_weeks}
                </p>
              </div>

              {/* Trends Grid: Best vs Worst */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>Best Category Trend</span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {weeklyReview.advice.best_category_trend}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                    <TrendingUp className="h-4 w-4 text-amber-400" />
                    <span>Watch Category Trend</span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {weeklyReview.advice.worst_category_trend}
                  </p>
                </div>
              </div>

              {/* Savings Rate Card */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-teal-400 uppercase tracking-wider mb-2">
                  <PiggyBank className="h-4 w-4 text-teal-400" />
                  <span>Weekly Savings Rate</span>
                </div>
                <p className="text-xs font-semibold text-slate-200 leading-relaxed">
                  {weeklyReview.advice.savings_rate}
                </p>
              </div>

              {/* Experiment Suggestion with Accept Button */}
              {weeklyReview.advice.experiment_suggestion && (
                <div className="rounded-3xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-950 p-5 shadow-xl">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                    <FlaskConical className="h-4 w-4" />
                    <span>Suggested 4-Week Experiment</span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-white">
                    {weeklyReview.advice.experiment_suggestion.description}
                  </h3>
                  <p className="mt-1 text-xs text-slate-300">
                    Category: {weeklyReview.advice.experiment_suggestion.category} • Target:{' '}
                    {weeklyReview.advice.experiment_suggestion.target}
                  </p>

                  <div className="mt-4 pt-3 border-t border-emerald-500/20 flex justify-end">
                    <button
                      onClick={() =>
                        handleAcceptExperiment(
                          weeklyReview.advice.experiment_suggestion.lever_id,
                          weeklyReview.advice.experiment_suggestion.category,
                          weeklyReview.advice.experiment_suggestion.description,
                          weeklyReview.advice.experiment_suggestion.target,
                          weeklyReview.advice.experiment_suggestion.baseline_paise
                        )
                      }
                      disabled={acceptingExp}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-black text-slate-950 shadow-md transition hover:bg-emerald-400 active:scale-95 disabled:opacity-50"
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                      <span>{acceptingExp ? 'Starting...' : 'Accept as experiment'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Earning Ideas (Exclusive to Weekly Review) */}
              {weeklyReview.advice.earning_ideas && weeklyReview.advice.earning_ideas.length > 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">
                    <Briefcase className="h-4 w-4 text-indigo-400" />
                    <span>Earning & Decluttering Ideas</span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {weeklyReview.advice.earning_ideas.map((idea, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                        <span>{idea}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Disclaimer Footer */}
              <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-center">
                <p className="text-[11px] text-slate-500">{weeklyReview.disclaimer}</p>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* ======================================================== */}
      {/* TAB 3: MONTHLY REVIEW (1st 9 AM IST)                     */}
      {/* Income vs spend vs invested, savings rate, commitments,  */}
      {/* top 3 learnings, budget adjustment suggestion            */}
      {/* ======================================================== */}
      {tab === 'monthly' && (
        <>
          {loadingMonthly ? (
            <div className="space-y-4">
              <div className="h-32 rounded-2xl bg-slate-800/50 p-5 animate-pulse motion-reduce:animate-none" />
              <div className="h-36 rounded-2xl bg-slate-800/40 p-4 animate-pulse motion-reduce:animate-none" />
              <div className="h-28 rounded-2xl bg-slate-800/40 p-4 animate-pulse motion-reduce:animate-none" />
            </div>
          ) : errorMonthly ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 text-rose-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
                <span>Could not load monthly review</span>
              </div>
              <p className="mt-1 text-xs text-rose-300/80">{errorMonthly}</p>
              <button
                onClick={() => fetchMonthlyReview()}
                className="mt-3 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
              >
                Retry
              </button>
            </div>
          ) : monthlyReview ? (
            <div className="space-y-4">
              {/* Verdict Card */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <span className="text-xs font-medium text-slate-400">
                    Month of {monthlyReview.date.slice(0, 7)}
                  </span>
                  <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[10px] font-bold text-indigo-300 border border-indigo-500/30">
                    Monthly Review
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-black text-white leading-snug">
                  {monthlyReview.advice.verdict}
                </h2>
                <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                  {monthlyReview.advice.income_vs_spend_vs_invested}
                </p>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-teal-400 uppercase tracking-wider mb-2">
                    <Target className="h-4 w-4 text-teal-400" />
                    <span>Savings Rate vs Target</span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {monthlyReview.advice.savings_rate_vs_target}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">
                    <CheckCircle2 className="h-4 w-4 text-purple-400" />
                    <span>Fixed Commitments</span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {monthlyReview.advice.commitments_total}
                  </p>
                </div>
              </div>

              {/* Top 3 Learnings */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2.5">
                  <Trophy className="h-4 w-4 text-emerald-400" />
                  <span>Top 3 Learnings from Engine</span>
                </div>
                <ul className="space-y-2 text-xs text-slate-200">
                  {monthlyReview.advice.top_learnings.map((learning, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                      <span className="leading-relaxed">{learning}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Budget Adjustment Suggestion */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                  <HelpCircle className="h-4 w-4 text-amber-400" />
                  <span>Engine Budget Adjustment</span>
                </div>
                <p className="text-xs font-medium text-slate-200 leading-relaxed">
                  {monthlyReview.advice.budget_adjustment_suggestion}
                </p>
              </div>

              {/* Grounded Saving or Earning Idea */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-teal-400 uppercase tracking-wider mb-2">
                  <PiggyBank className="h-4 w-4 text-teal-400" />
                  <span>Data-Grounded Recommendation</span>
                </div>
                <p className="text-xs font-medium text-slate-200 leading-relaxed">
                  {monthlyReview.advice.saving_or_earning_idea}
                </p>
              </div>

              {/* Disclaimer Footer */}
              <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-center">
                <p className="text-[11px] text-slate-500">{monthlyReview.disclaimer}</p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
