import type { EngineExpense, Insight } from './types';
import { median, addDays, getISOWeek, daysDifference } from './math';
import { formatPaiseToRupees } from '../money';

export interface DriftDriver {
  merchant: string;
  rupeesAddedPaise: number;
  recentWeeklyAvgPaise: number;
  baselineWeeklyAvgPaise: number;
}

export interface CategoryDriftAnalysis {
  category: string;
  status: 'ready' | 'insufficient_data';
  reason?: string;
  insight?: Insight;
}

/**
 * Generator 2.c: DRIFT
 * Compares the last 4 weeks' weekly totals to the prior 8 weeks (medians of weekly totals).
 * Excludes expenses flagged as possible_duplicate or outlier from the drift windows.
 * Adds drivers to drift evidence: top 2 merchants by rupees added in recent window vs baseline average.
 */
export function analyzeCategoryDrift(
  expenses: EngineExpense[],
  now: string,
  options?: {
    outlierExpenseIds?: Set<string>;
    duplicateExpenseIds?: Set<string>;
    excludedExpenseIds?: Set<string>;
  }
): { insights: Insight[]; categoryAnalyses: CategoryDriftAnalysis[] } {
  const insights: Insight[] = [];
  const categoryAnalyses: CategoryDriftAnalysis[] = [];

  const twelveWeeksAgo = addDays(now, -84); // 12 weeks = 84 days
  const excludedIds = new Set<string>();
  if (options?.outlierExpenseIds) {
    for (const id of options.outlierExpenseIds) excludedIds.add(id);
  }
  if (options?.duplicateExpenseIds) {
    for (const id of options.duplicateExpenseIds) excludedIds.add(id);
  }
  if (options?.excludedExpenseIds) {
    for (const id of options.excludedExpenseIds) excludedIds.add(id);
  }

  // Filter to eligible discretionary expenses within the 12-week window
  // Exclude one_off rows, schedule-posted rows, non-spend kinds, outliers, and duplicates
  const windowExpenses = expenses.filter(
    (e) =>
      e.spentOn >= twelveWeeksAgo &&
      e.spentOn <= now &&
      (e.kind === 'spend' || !e.kind) &&
      e.source !== 'schedule' &&
      !e.scheduleId &&
      !e.oneOff &&
      !excludedIds.has(e.id)
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
    const merchantRecentSpend = new Map<string, number>();
    const merchantBaselineSpend = new Map<string, number>();

    for (const exp of catExpenses) {
      const daysAgo = daysDifference(now, exp.spentOn);
      const weekIndex = Math.floor(daysAgo / 7);
      if (weekIndex >= 0 && weekIndex < 12) {
        weeklyTotals[weekIndex] += exp.amountPaise;
      }

      const mKey = (exp.merchant && exp.merchant.trim().length > 0) ? exp.merchant.trim() : 'Uncategorized';
      if (daysAgo >= 0 && daysAgo < 28) {
        merchantRecentSpend.set(mKey, (merchantRecentSpend.get(mKey) || 0) + exp.amountPaise);
      } else if (daysAgo >= 28 && daysAgo < 84) {
        merchantBaselineSpend.set(mKey, (merchantBaselineSpend.get(mKey) || 0) + exp.amountPaise);
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

    // Compute drivers: top 2 merchants by rupees added in recent window vs baseline average
    const allMerchants = new Set([...merchantRecentSpend.keys(), ...merchantBaselineSpend.keys()]);
    const driverList: DriftDriver[] = [];

    for (const m of allMerchants) {
      const recentTotal = merchantRecentSpend.get(m) || 0;
      const baselineTotal = merchantBaselineSpend.get(m) || 0;
      const recentWeeklyAvg = recentTotal / 4;
      const baselineWeeklyAvg = baselineTotal / 8;
      const diffWeekly = Math.round(recentWeeklyAvg - baselineWeeklyAvg);
      if (diffWeekly > 0) {
        driverList.push({
          merchant: m,
          rupeesAddedPaise: diffWeekly,
          recentWeeklyAvgPaise: Math.round(recentWeeklyAvg),
          baselineWeeklyAvgPaise: Math.round(baselineWeeklyAvg),
        });
      }
    }

    driverList.sort((a, b) => b.rupeesAddedPaise - a.rupeesAddedPaise);
    const top2Drivers = driverList.slice(0, 2);

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
          recentWeeklyTotalsPaise: recentWeeklyTotals,
          priorWeeklyTotalsPaise: priorWeeklyTotals,
          recentWeeklyMedianPaise: recentWeeklyMedian,
          priorWeeklyMedianPaise: priorWeeklyMedian,
          percentChange: Math.round(percentChange * 1000) / 10,
          monthlyEffectPaise,
          drivers: top2Drivers,
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
