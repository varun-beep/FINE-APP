import type { EngineOutput } from '@/lib/engine/types';
import type {
  DailyReviewSummaryPayload,
  CandidateInsightPayload,
  SafeToSpendAllowancePayload,
} from './types';
import { extractNumbersFromText } from './guardrail';

export interface PrivacyPayloadResult {
  payload: DailyReviewSummaryPayload;
  allowedNumbers: number[];
  candidateInsightIds: string[];
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
 *   trends, recurring charge names, anomaly ratios/categories, allowance,
 *   and ranked engine insights with evidence.
 */
export function buildDailyReviewSummaryPayload(
  output: EngineOutput,
  targetDate: string,
  last3ActionIds?: string[]
): PrivacyPayloadResult {
  const allowedNumbersSet = new Set<number>();

  // Helper to add numbers to allowed list
  function trackNumber(val: number | null | undefined): void {
    if (
      val !== null &&
      val !== undefined &&
      !Number.isNaN(val) &&
      Number.isFinite(val)
    ) {
      const absVal = Math.abs(val);
      allowedNumbersSet.add(absVal);
      allowedNumbersSet.add(Math.round(absVal));
      const intVal = Math.floor(absVal);
      if (intVal > 0) allowedNumbersSet.add(intVal);
    }
  }

  // 1. Overall Budget Aggregates
  const spentSoFarRupees = Math.round(output.budgetRunRate.spentSoFarPaise / 100);
  const monthlyLimitRupees = output.budgetRunRate.monthlyLimitPaise
    ? Math.round(output.budgetRunRate.monthlyLimitPaise / 100)
    : null;
  const projectedMonthEndRupees = Math.round(
    output.budgetRunRate.projectedMonthEndPaise / 100
  );
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
    const limitRupees = c.monthlyLimitPaise
      ? Math.round(c.monthlyLimitPaise / 100)
      : null;
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

  // 3. Flagged Anomalies
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

  // 5. Learning Numbers
  trackNumber(output.learning.expenseCount);
  trackNumber(output.learning.expenseThreshold);
  trackNumber(output.learning.distinctDaysCount);
  trackNumber(output.learning.distinctDaysThreshold);
  trackNumber(output.learning.expensesNeeded);
  trackNumber(output.learning.daysNeeded);

  // 6. Allowance Numbers & Payload
  let allowancePayload: SafeToSpendAllowancePayload | null = null;
  if (output.allowance) {
    const dailyAllowanceRupees = Math.round(output.allowance.dailyAllowancePaise / 100);
    const todaySpentRupees = Math.round(output.allowance.todaySpentPaise / 100);
    const remainingDiscretionaryRupees = Math.round(
      output.allowance.remainingDiscretionaryPaise / 100
    );
    const tomorrowDailyAllowanceRupees = Math.round(
      output.allowance.tomorrowDailyAllowancePaise / 100
    );
    const monthlyIncomeRupees = Math.round(output.allowance.monthlyIncomePaise / 100);
    const committedDueRupees = Math.round(output.allowance.committedDuePaise / 100);
    const savingsTargetRupees = Math.round(output.allowance.savingsTargetPaise / 100);

    trackNumber(dailyAllowanceRupees);
    trackNumber(todaySpentRupees);
    trackNumber(remainingDiscretionaryRupees);
    trackNumber(tomorrowDailyAllowanceRupees);
    trackNumber(monthlyIncomeRupees);
    trackNumber(committedDueRupees);
    trackNumber(savingsTargetRupees);
    trackNumber(output.allowance.daysLeftInMonth);

    // Difference between today spent and allowance
    trackNumber(Math.abs(todaySpentRupees - dailyAllowanceRupees));

    allowancePayload = {
      dailyAllowanceRupees,
      todaySpentRupees,
      remainingDiscretionaryRupees,
      verdict: output.allowance.verdict,
      tomorrowDailyAllowanceRupees,
      monthlyIncomeRupees,
      committedDueRupees,
      savingsTargetRupees,
      daysLeftInMonth: output.allowance.daysLeftInMonth,
    };
  }

  // 7. Ranked Candidate Insights (excluding safe_to_spend)
  const candidateInsightIds: string[] = [];
  const candidateInsights: CandidateInsightPayload[] = [];

  const candidateSource = output.insights || [];
  for (const ins of candidateSource) {
    if (ins.type === 'safe_to_spend') continue;

    candidateInsightIds.push(ins.id);
    const impactRupees = Math.round(ins.impactPaise / 100);
    trackNumber(impactRupees);
    trackNumber(Math.round(ins.confidence * 100));

    // Track numbers in insight evidence
    const cleanEvidence: Record<string, unknown> = {};
    if (ins.evidence) {
      for (const [k, v] of Object.entries(ins.evidence)) {
        if (typeof v === 'number') {
          trackNumber(v);
          // If in paise (e.g. >= 100), also track rupees
          if (v >= 100) {
            trackNumber(Math.round(v / 100));
          }
          cleanEvidence[k] = v;
        } else if (typeof v === 'string') {
          // Extract any numbers from string values in evidence
          const numsInStr = extractNumbersFromText(v);
          numsInStr.forEach(trackNumber);
          cleanEvidence[k] = v;
        } else if (typeof v === 'boolean') {
          cleanEvidence[k] = v;
        }
      }
    }

    // Levers
    const cleanLevers = (ins.levers || []).map((l) => {
      const savingRupees = Math.round(l.monthlySavingPaise / 100);
      trackNumber(savingRupees);

      // Extract numbers from lever description (e.g. "Limit food delivery to 3 orders/week")
      const descNumbers = extractNumbersFromText(l.description);
      descNumbers.forEach(trackNumber);

      return {
        lever_id: l.id,
        description: l.description,
        monthlySavingRupees: savingRupees,
      };
    });

    candidateInsights.push({
      insight_id: ins.id,
      type: ins.type,
      title: ins.title,
      impactRupees,
      confidence: ins.confidence,
      evidence: cleanEvidence,
      levers: cleanLevers,
    });
  }

  const payload: DailyReviewSummaryPayload = {
    evaluationDate: targetDate,
    learningStatus: output.learning.status,
    allowance: allowancePayload,
    candidateInsights,
    last3ActionIds,
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
    candidateInsightIds,
  };
}
