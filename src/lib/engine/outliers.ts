import type {
  EngineExpense,
  Insight,
  SilentFlag,
  InsightLogEntry,
} from './types';
import { median, medianAbsoluteDeviation, modifiedZScore } from './math';
import { formatPaiseToRupees } from '../money';

export interface OutlierAnalysisResult {
  insights: Insight[];
  silentFlags: SilentFlag[];
}

const LUMPY_CATEGORIES = new Set(['Health', 'Shopping', 'Travel']);

/**
 * Context-aware outlier generator:
 * - Uses modified z-score with category-specific variability (higher bar for lumpy categories like Health, Shopping, Travel).
 * - Detects duplicates, large one-offs, and habit spikes.
 * - Surfaces only if excess >= 5% of monthly discretionary budget OR (>= 2x median AND >= ₹500).
 * - Excludes one_off expenses and records sub-threshold anomalies as silent flags.
 */
export function detectContextAwareOutliers(
  expenses: EngineExpense[],
  now: string,
  options?: {
    monthlyDiscretionaryBudgetPaise?: number;
    insightLogs?: InsightLogEntry[];
  }
): OutlierAnalysisResult {
  const insights: Insight[] = [];
  const silentFlags: SilentFlag[] = [];

  // Feedback map
  const feedbackMap = new Map<string, string>();
  if (options?.insightLogs) {
    for (const log of options.insightLogs) {
      if (log.feedback) {
        feedbackMap.set(log.insightKey, log.feedback);
      }
    }
  }

  // Filter to eligible discretionary baseline expenses
  const eligibleExpenses = expenses.filter(
    (e) =>
      (e.kind === 'spend' || !e.kind) &&
      e.source !== 'schedule' &&
      !e.oneOff &&
      feedbackMap.get(`outlier:${e.id}`) !== 'planned'
  );

  // Group by category
  const byCategory: Record<string, EngineExpense[]> = {};
  for (const exp of eligibleExpenses) {
    if (!byCategory[exp.category]) {
      byCategory[exp.category] = [];
    }
    byCategory[exp.category].push(exp);
  }

  // Monthly discretionary budget floor (default to ₹40,000 if not provided)
  const monthlyDiscretionaryBudget =
    options?.monthlyDiscretionaryBudgetPaise && options.monthlyDiscretionaryBudgetPaise > 0
      ? options.monthlyDiscretionaryBudgetPaise
      : 4000000;

  // First pass: detect duplicates across all eligible expenses
  const duplicateCandidates = new Map<string, EngineExpense[]>();
  for (const exp of eligibleExpenses) {
    if (exp.merchant) {
      const normMerchant = exp.merchant.trim().toLowerCase();
      const dupKey = `${exp.spentOn}:${normMerchant}:${exp.amountPaise}`;
      if (!duplicateCandidates.has(dupKey)) {
        duplicateCandidates.set(dupKey, []);
      }
      duplicateCandidates.get(dupKey)!.push(exp);
    }
  }

  const duplicateExpenseIds = new Set<string>();
  for (const group of duplicateCandidates.values()) {
    if (group.length > 1) {

      // The second and subsequent entries on the same day are potential duplicates
      for (let i = 1; i < group.length; i++) {
        duplicateExpenseIds.add(group[i].id);
      }
    }
  }

  // Evaluate each category with >= 8 entries
  for (const [category, catExpenses] of Object.entries(byCategory)) {
    if (catExpenses.length < 8) {
      continue;
    }

    const amounts = catExpenses.map((e) => e.amountPaise);
    const catMedian = median(amounts);
    const catMad = medianAbsoluteDeviation(amounts, catMedian) || Math.max(1, Math.round(catMedian * 0.15));
    const variability = catMad / (catMedian || 1);

    const isLumpy = LUMPY_CATEGORIES.has(category) || variability >= 0.50;
    const zScoreThreshold = isLumpy ? 5.0 : 3.5;
    const multiplierThreshold = isLumpy ? 3.5 : 2.0;

    // Evaluate recent expenses (last 45 days)
    for (const exp of catExpenses) {
      const isDuplicate = duplicateExpenseIds.has(exp.id);
      const zScore = modifiedZScore(exp.amountPaise, catMedian, catMad);
      const ratioToMedian = catMedian > 0 ? exp.amountPaise / catMedian : 1;
      const excessPaise = exp.amountPaise - catMedian;

      const isStatisticalOutlier =
        isDuplicate ||
        (zScore >= zScoreThreshold && ratioToMedian >= multiplierThreshold);

      if (!isStatisticalOutlier) {
        continue;
      }

      // Classification
      let classification: 'possible_duplicate' | 'one_off_large' | 'habit_spike';
      if (isDuplicate) {
        classification = 'possible_duplicate';
      } else if (exp.amountPaise >= 1500000 || ratioToMedian >= 4.0) {
        classification = 'one_off_large';
      } else {
        classification = 'habit_spike';
      }

      // Check surfacing criteria
      const meetsExcessBudgetPct = excessPaise >= 0.05 * monthlyDiscretionaryBudget;
      const meetsFloorAndMultiplier = excessPaise >= 2 * catMedian && excessPaise >= 50000; // >= ₹500
      const shouldSurface = isDuplicate || meetsExcessBudgetPct || meetsFloorAndMultiplier;

      const evidence = {
        amountPaise: exp.amountPaise,
        categoryMedianPaise: catMedian,
        catMadPaise: catMad,
        excessPaise,
        zScore: Math.round(zScore * 100) / 100,
        ratioToMedian: Math.round(ratioToMedian * 10) / 10,
        classification,
        isDuplicate: classification === 'possible_duplicate',
        isLumpy,
        wasPlanned: false,
        category: exp.category,
        merchant: exp.merchant,
        spentOn: exp.spentOn,
      };


      if (!shouldSurface) {
        silentFlags.push({
          id: `silent:outlier:${exp.id}`,
          type: 'outlier',
          title: `${exp.merchant || exp.category} (${formatPaiseToRupees(exp.amountPaise)})`,
          reason: `Outlier in ${category} below 5% discretionary threshold (${formatPaiseToRupees(excessPaise)} excess)`,
          evidence,
        });
        continue;
      }

      let title = `Unusual spend in ${category}: ${formatPaiseToRupees(exp.amountPaise)}`;
      if (classification === 'possible_duplicate') {
        title = `Possible duplicate charge: ${formatPaiseToRupees(exp.amountPaise)} at ${exp.merchant || category}`;
      } else if (classification === 'one_off_large') {
        title = `Large one-off spend: ${formatPaiseToRupees(exp.amountPaise)} at ${exp.merchant || category}`;
      } else {
        title = `Habit spike in ${category}: ${formatPaiseToRupees(exp.amountPaise)} at ${exp.merchant || category}`;
      }

      insights.push({
        id: `outlier:${exp.id}`,
        type: 'outlier',
        title,
        impactPaise: classification === 'possible_duplicate' ? exp.amountPaise : excessPaise,
        confidence: Math.min(1.0, 0.75 + (zScore > 0 ? Math.min(0.2, zScore / 25) : 0.15)),
        actionable: true,
        expenseId: exp.id,
        firstSeen: exp.spentOn,
        severity: classification === 'possible_duplicate' || ratioToMedian >= 4.0 ? 'alert' : 'warning',
        levers: isDuplicate
          ? [
              {
                id: `delete_dup_${exp.id}`,
                description: `Delete duplicate ${formatPaiseToRupees(exp.amountPaise)} transaction`,
                monthlySavingPaise: exp.amountPaise,
              },
            ]
          : [
              {
                id: `mark_planned_${exp.id}`,
                description: 'Mark as planned one-off expense (removes from habit baselines)',
                monthlySavingPaise: 0,
              },
            ],

        evidence,
      });
    }
  }

  return { insights, silentFlags };
}
