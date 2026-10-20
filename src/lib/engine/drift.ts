import type { EngineExpense, Insight } from './types';
import { median, addDays, getISOWeek, daysDifference } from './math';
import { formatPaiseToRupees } from '../money';

export interface CategoryDriftAnalysis {
  category: string;
  status: 'ready' | 'insufficient_data';
  reason?: string;
  insight?: Insight;
}

/**
 * Generator 2.c: DRIFT
 * Compares the last 4 weeks' weekly totals to the prior 8 weeks (medians of weekly totals).
 * Requires >= 8 weeks of data and >= 6 transactions in the 12-week window.
 * Reports percent change and monthly ₹ effect.
 */
export function analyzeCategoryDrift(
  expenses: EngineExpense[],
  now: string
): { insights: Insight[]; categoryAnalyses: CategoryDriftAnalysis[] } {
  const insights: Insight[] = [];
  const categoryAnalyses: CategoryDriftAnalysis[] = [];

  const twelveWeeksAgo = addDays(now, -84); // 12 weeks = 84 days

  // Filter to eligible discretionary expenses within the 12-week window

  const windowExpenses = expenses.filter(
    (e) =>
      e.spentOn >= twelveWeeksAgo &&
      e.spentOn <= now &&
      (e.kind === 'spend' || !e.kind) &&
      e.source !== 'schedule' &&
      !e.oneOff
  );

  // Group by category
  const byCategory: Record<string, EngineExpense[]> = {};
  for (const exp of windowExpenses) {
    if (!byCategory[exp.category]) {
      byCategory[exp.category] = [];
    }
    byCategory[exp.category].push(exp);
  }

  // Find overall earliest date in database for history span check
  let earliestDate = now;
  for (const exp of expenses) {
    if (exp.spentOn < earliestDate) {
      earliestDate = exp.spentOn;
    }
  }
  const totalWeeksOfHistory = Math.floor(daysDifference(now, earliestDate) / 7);

  for (const [category, catExpenses] of Object.entries(byCategory)) {
    // Check requirements: >= 8 weeks of data and >= 6 transactions
    if (totalWeeksOfHistory < 8 || catExpenses.length < 6) {
      categoryAnalyses.push({
        category,
        status: 'insufficient_data',
        reason: `Need at least 8 weeks of history and 6 transactions (have ${totalWeeksOfHistory} weeks, ${catExpenses.length} transactions)`,
      });
      continue;
    }

    // Bucket into 12 weekly totals (week 0 is most recent: [now-7, now], week 1 is [now-14, now-7], ...)
    const weeklyTotals: number[] = Array(12).fill(0);
    for (const exp of catExpenses) {
      const daysAgo = daysDifference(now, exp.spentOn);
      const weekIndex = Math.floor(daysAgo / 7);
      if (weekIndex >= 0 && weekIndex < 12) {
        weeklyTotals[weekIndex] += exp.amountPaise;
      }
    }

    // Last 4 weeks: index 0, 1, 2, 3
    const recentWeeklyTotals = weeklyTotals.slice(0, 4);
    // Prior 8 weeks: index 4, 5, ..., 11
    const priorWeeklyTotals = weeklyTotals.slice(4, 12);

    const recentWeeklyMedian = median(recentWeeklyTotals);
    const priorWeeklyMedian = median(priorWeeklyTotals);

    if (priorWeeklyMedian <= 0 && recentWeeklyMedian <= 0) {
      categoryAnalyses.push({
        category,
        status: 'ready',
      });
      continue;
    }

    const weeklyDiffPaise = recentWeeklyMedian - priorWeeklyMedian;
    const percentChange =
      priorWeeklyMedian > 0
        ? weeklyDiffPaise / priorWeeklyMedian
        : recentWeeklyMedian > 0
        ? 1.0
        : 0;

    // Monthly ₹ effect = weekly difference * 4.33
    const monthlyEffectPaise = Math.round(weeklyDiffPaise * 4.33);

    // Surface drift if significant: percentChange >= 20% (or <= -20%) and |monthlyEffect| >= ₹1,000
    const isDrift =
      Math.abs(percentChange) >= 0.20 && Math.abs(monthlyEffectPaise) >= 100000;

    if (isDrift && weeklyDiffPaise > 0) {
      const isoWeek = getISOWeek(now);
      const percentStr = Math.round(percentChange * 100);

      const insight: Insight = {
        id: `drift:${category}:${isoWeek}`,
        type: 'drift',
        title: `${category} spend drifting up ${percentStr}% (+${formatPaiseToRupees(monthlyEffectPaise)}/mo)`,
        impactPaise: monthlyEffectPaise,
        confidence: Math.min(1.0, 0.80 + (catExpenses.length / 50)),
        actionable: true,
        firstSeen: now,
        severity: percentChange >= 0.40 ? 'alert' : 'warning',
        levers: [
          {
            id: `curb_drift_${category.toLowerCase()}`,
            description: `Bring ${category} back to previous pace of ${formatPaiseToRupees(priorWeeklyMedian)}/week`,
            monthlySavingPaise: monthlyEffectPaise,
          },
        ],

        evidence: {
          category,
          recentWeeklyMedianPaise: recentWeeklyMedian,
          priorWeeklyMedianPaise: priorWeeklyMedian,
          percentChange: Math.round(percentChange * 1000) / 10,
          monthlyEffectPaise,
          transactionCount: catExpenses.length,
          weeksAnalyzed: 12,
        },
      };

      insights.push(insight);
      categoryAnalyses.push({
        category,
        status: 'ready',
        insight,
      });
    } else {
      categoryAnalyses.push({
        category,
        status: 'ready',
      });
    }
  }

  return { insights, categoryAnalyses };
}
