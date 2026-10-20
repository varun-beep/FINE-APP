import type { EngineOutput } from '@/lib/engine/types';
import type { DailyReviewSummaryPayload } from './types';

export interface PrivacyPayloadResult {
  payload: DailyReviewSummaryPayload;
  allowedNumbers: number[];
}

/**
 * Builds a privacy-preserving summary for the LLM.
 *
 * CRITICAL PRIVACY GUARANTEES:
 * - NEVER sends transaction notes.
 * - NEVER sends exact timestamps.
 * - NEVER sends raw transaction lists or individual non-anomalous items.
 * - Merchant names are strictly truncated to 30 characters.
 * - Only includes high-level aggregates: totals, category totals, budget statuses,
 *   trends, recurring charge names, anomaly ratios/categories, and learning state.
 */
export function buildDailyReviewSummaryPayload(
  output: EngineOutput,
  targetDate: string
): PrivacyPayloadResult {
  const allowedNumbersSet = new Set<number>();

  // Helper to add numbers to allowed list
  function trackNumber(val: number | null | undefined): void {
    if (val !== null && val !== undefined && !Number.isNaN(val) && Number.isFinite(val)) {
      allowedNumbersSet.add(Math.abs(val));
      allowedNumbersSet.add(Math.round(Math.abs(val)));
      // Also track whole integer if float
      const intVal = Math.floor(Math.abs(val));
      if (intVal > 0) allowedNumbersSet.add(intVal);
    }
  }

  // 1. Overall Budget Aggregates
  const spentSoFarRupees = Math.round(output.budgetRunRate.spentSoFarPaise / 100);
  const monthlyLimitRupees = output.budgetRunRate.monthlyLimitPaise
    ? Math.round(output.budgetRunRate.monthlyLimitPaise / 100)
    : null;
  const projectedMonthEndRupees = Math.round(output.budgetRunRate.projectedMonthEndPaise / 100);
  const percentageUsed = output.budgetRunRate.percentageUsed;

  trackNumber(spentSoFarRupees);
  trackNumber(monthlyLimitRupees);
  trackNumber(projectedMonthEndRupees);
  trackNumber(percentageUsed);
  trackNumber(output.budgetRunRate.projectedPercentage);

  // 2. Category Aggregates & Trends
  const trendMap = new Map(output.trends.categories.map((t) => [t.category, t]));

  const categories = output.budgetRunRate.categories.map((c) => {
    const trend = trendMap.get(c.category);
    const spentRupees = Math.round(c.spentSoFarPaise / 100);
    const limitRupees = c.monthlyLimitPaise ? Math.round(c.monthlyLimitPaise / 100) : null;
    const projectedRupees = Math.round(c.projectedMonthEndPaise / 100);

    trackNumber(spentRupees);
    trackNumber(limitRupees);
    trackNumber(projectedRupees);
    trackNumber(c.percentageUsed);
    trackNumber(c.projectedPercentage);
    if (trend) {
      trackNumber(trend.weekOverWeekPercent);
      trackNumber(trend.monthOverMonthPercent);
    }

    return {
      category: c.category,
      spentSoFarRupees: spentRupees,
      monthlyLimitRupees: limitRupees,
      projectedMonthEndRupees: projectedRupees,
      budgetStatus: c.budgetStatus,
      trend7dPctChange: trend?.weekOverWeekPercent ?? null,
      trendMtdPctChange: trend?.monthOverMonthPercent ?? null,
    };
  });

  // Track pairwise sums of active categories
  const activeCategoryAmounts = categories
    .map((c) => c.spentSoFarRupees)
    .filter((a) => a > 0);
  for (let i = 0; i < activeCategoryAmounts.length; i++) {
    for (let j = i + 1; j < activeCategoryAmounts.length; j++) {
      trackNumber(activeCategoryAmounts[i] + activeCategoryAmounts[j]);
    }
  }

  // 3. Flagged Anomalies (Ratios & Categories ONLY, no notes or timestamps)
  const flaggedAnomalies = output.transactionAnomalies.map((a) => {
    const amountRupees = Math.round(a.amountPaise / 100);
    trackNumber(amountRupees);
    trackNumber(a.ratioToMedian);
    trackNumber(Math.round(a.medianPaise / 100));

    return {
      category: a.category,
      ratioToMedian: a.ratioToMedian,
      reason: a.reason,
      amountRupees,
    };
  });

  // 4. Recurring Charges (Merchant text truncated to 30 chars, no user notes)
  const recurringCharges = output.recurring.map((r) => {
    const cleanMerchant = (r.merchantOrNote || 'Unknown').slice(0, 30);
    const estRupees = Math.round(r.estimatedAmountPaise / 100);
    const monthlyRupees = Math.round(r.monthlyCostEstimatePaise / 100);

    trackNumber(estRupees);
    trackNumber(monthlyRupees);
    trackNumber(r.occurrenceCount);
    trackNumber(r.intervalDays);

    return {
      merchant: cleanMerchant,
      interval: r.interval,
      estimatedRupees: estRupees,
      monthlyCostRupees: monthlyRupees,
    };
  });

  // 5. Learning numbers
  trackNumber(output.learning.expenseCount);
  trackNumber(output.learning.expenseThreshold);
  trackNumber(output.learning.distinctDaysCount);
  trackNumber(output.learning.distinctDaysThreshold);
  trackNumber(output.learning.expensesNeeded);
  trackNumber(output.learning.daysNeeded);

  const payload: DailyReviewSummaryPayload = {
    evaluationDate: targetDate,
    learningStatus: output.learning.status,
    overallBudget: {
      spentSoFarRupees,
      monthlyLimitRupees,
      projectedMonthEndRupees,
      budgetStatus: output.budgetRunRate.budgetStatus,
      percentageUsed,
    },
    categories,
    flaggedAnomalies,
    recurringCharges,
  };

  return {
    payload,
    allowedNumbers: Array.from(allowedNumbersSet),
  };
}
