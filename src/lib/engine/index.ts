import type {
  EngineExpense,
  EngineOptions,
  EngineOutput,
  Insight,
  SilentFlag,
  MonthEndProjection,
} from './types';
import { getKolkataToday } from '../date';
import { formatPaiseToRupees } from '../money';
import { evaluateLearningState } from './learning';
import { detectAnomalies } from './anomalies';
import { detectRecurring } from './recurring';
import { calculateBudgetRunRate } from './runrate';
import { calculateTrends } from './trends';
import { evaluateCoverage } from './coverage';
import { calculateSafeToSpend } from './safetospend';
import { detectContextAwareOutliers } from './outliers';
import { analyzeCategoryDrift } from './drift';
import { analyzeBehaviour } from './behaviour';
import { detectSmallLeaks } from './smallleaks';
import { analyzeCommitmentLoad } from './commitments';
import { analyzeSavings } from './savings';
import { calculateMonthEndProjection } from './projection';
import { generateExperimentProgressInsights } from './experiments';
import { rankAndFilterInsights } from './ranking';

export * from './types';
export * from './math';
export * from './learning';
export * from './anomalies';
export * from './recurring';
export * from './runrate';
export * from './trends';
export * from './coverage';
export * from './safetospend';
export * from './outliers';
export * from './drift';
export * from './behaviour';
export * from './smallleaks';
export * from './commitments';
export * from './savings';
export * from './projection';
export * from './experiments';
export * from './ranking';

/**
 * Pure coach brain engine entrypoint:
 * Takes plain expense array and optional budgets/date/schedules/closedDays/insightLogs.
 * Has NO network or database dependencies.
 */
export function analyzeExpenses(
  expenses: EngineExpense[],
  options?: EngineOptions
): EngineOutput {
  const now = options?.now || getKolkataToday();
  const budgets = options?.budgets || [];
  const schedules = options?.schedules || [];
  const closedDays = options?.closedDays;
  const insightLogs = options?.insightLogs || [];

  // 1. Learning state (counts only logged or no_spend closed days; excludes skipped days)
  const learning = evaluateLearningState(expenses, closedDays);

  // 2. Coverage report (honesty: what is ready vs what data is missing)
  const coverage = evaluateCoverage(expenses, closedDays || [], now);

  // 3. Backward-compatible legacy anomaly, recurring, budget, and trend modules
  const { transactionAnomalies, dailyAnomalies } = detectAnomalies(
    expenses,
    learning,
    now
  );
  const recurring = detectRecurring(expenses);
  const budgetRunRate = calculateBudgetRunRate(
    expenses,
    budgets,
    recurring,
    now,
    schedules
  );
  const trends = calculateTrends(expenses, now);

  // ==========================================
  // COACH BRAIN GENERATORS
  // ==========================================
  const candidateInsights: Insight[] = [];
  const silentFlags: SilentFlag[] = [];

  // 2.a SAFE_TO_SPEND
  const { allowance, insight: safeToSpendInsight } = calculateSafeToSpend(
    expenses,
    schedules,
    now,
    options?.savingsTargetRate
  );
  if (safeToSpendInsight) {
    candidateInsights.push(safeToSpendInsight);
  }

  // Learning gate check:
  // No outlier/drift/behaviour/leak insights until BOTH conditions are met:
  //   1. coverage.daysClosed >= 14 (user has explicitly closed at least 14 days)
  //   2. learning.expenseCount >= 30 (enough discretionary expenses logged)
  // NOTE: We removed the old guard `closedDays.length > 0 &&` that was a bug:
  //   when no day_closures existed at all, daysClosed was 0 but the gate was bypassed.
  const daysClosedCount =
    options?.closedDays !== undefined
      ? coverage.daysClosed
      : learning.distinctDaysCount;

  const gateReasons: string[] = [];
  if (daysClosedCount < 14) {
    gateReasons.push(`still learning: needs ${14 - daysClosedCount} more closed days (have ${daysClosedCount}/14)`);
  }
  if (learning.expenseCount < 30) {
    gateReasons.push(`still learning: needs ${30 - learning.expenseCount} more expenses (have ${learning.expenseCount}/30)`);
  }
  const isLearning = gateReasons.length > 0;

  // Monthly discretionary budget baseline
  const monthlyDiscretionaryBudget = allowance
    ? allowance.monthlyIncomePaise - allowance.committedDuePaise - allowance.savingsTargetPaise
    : 4000000;

  // Outlier detection (only if ready)
  const flaggedOutlierIds = new Set<string>();
  if (!isLearning) {
    // 2.b OUTLIER (context-aware: lumpy vs steady, duplicates, large one-offs, habit spikes)
    const outlierResult = detectContextAwareOutliers(expenses, now, {
      monthlyDiscretionaryBudgetPaise: monthlyDiscretionaryBudget,
      insightLogs,
    });
    candidateInsights.push(...outlierResult.insights);
    silentFlags.push(...outlierResult.silentFlags);

    const flaggedDuplicateIds = new Set<string>();

    for (const ins of outlierResult.insights) {
      if (ins.expenseId) {
        flaggedOutlierIds.add(ins.expenseId);
        const ev = ins.evidence as Record<string, unknown> | undefined;
        if (ev?.classification === 'possible_duplicate' || ev?.isDuplicate || ins.id.includes('duplicate')) {
          flaggedDuplicateIds.add(ins.expenseId);
        }
      }
      const ev = ins.evidence as Record<string, unknown> | undefined;
      if (typeof ev?.expenseId === 'string') flaggedOutlierIds.add(ev.expenseId);
    }
    for (const flag of outlierResult.silentFlags) {
      const ev = flag.evidence as Record<string, unknown> | undefined;
      if (typeof ev?.expenseId === 'string') flaggedOutlierIds.add(ev.expenseId);
      if (flag.id.startsWith('silent:outlier:')) {
        flaggedOutlierIds.add(flag.id.replace('silent:outlier:', ''));
      }
    }

    // 2.c DRIFT (4 weeks vs prior 8 weeks medians; excludes duplicates and outliers)
    const driftResult = analyzeCategoryDrift(expenses, now, {
      outlierExpenseIds: flaggedOutlierIds,
      duplicateExpenseIds: flaggedDuplicateIds,
    });

    // 2.d BEHAVIOUR (payday surge, weekend ratio, merchant concentration)
    const behaviourInsights = analyzeBehaviour(expenses, schedules, now, { outlierExpenseIds: flaggedOutlierIds });

    // 2.e SMALL_LEAKS (>= 8 purchases in 30 days, median < ₹300, >= 3% of discretionary)
    const leakInsights = detectSmallLeaks(expenses, now, { outlierExpenseIds: flaggedOutlierIds });

    // 4.c DRIFT & SMALL LEAK DEDUPLICATION:
    // If one small-leak merchant explains >= 50% of a category drift, show ONE card
    // (the drift, naming the driver) instead of both. The duplicate-charge card always stays separate.
    const suppressedLeakIds = new Set<string>();
    for (const driftIns of driftResult.insights) {
      const driftEv = driftIns.evidence as Record<string, unknown> | undefined;
      const driftCategory = (driftEv?.category as string) || '';
      const driftImpact = driftIns.impactPaise;
      const drivers = (driftEv?.drivers as Array<{ merchant: string; rupeesAddedPaise: number }>) || [];

      for (const leakIns of leakInsights) {
        const leakEv = leakIns.evidence as Record<string, unknown> | undefined;
        const leakMerchant = (leakEv?.merchant as string) || (leakEv?.target as string) || '';
        const leakCategory = (leakEv?.category as string) || '';
        const leakImpact = leakIns.impactPaise;

        const matchesCategory = leakCategory.toLowerCase() === driftCategory.toLowerCase();
        const matchingDriver = drivers.find(
          (d) => d.merchant.toLowerCase() === leakMerchant.toLowerCase()
        );

        if ((matchesCategory || matchingDriver) && driftImpact > 0) {
          const explainsGte50 =
            leakImpact >= 0.50 * driftImpact ||
            (matchingDriver && matchingDriver.rupeesAddedPaise >= 0.50 * ((driftEv?.monthlyEffectPaise as number) / 4.33));

          if (explainsGte50) {
            driftIns.title = `${driftCategory} spend drifting up ${driftEv?.percentChange}% (+${formatPaiseToRupees(driftImpact)}/mo) driven by ${leakMerchant}`;
            suppressedLeakIds.add(leakIns.id);
          }
        }
      }
    }

    const activeLeakInsights = leakInsights.filter((l) => !suppressedLeakIds.has(l.id));

    candidateInsights.push(...driftResult.insights);
    candidateInsights.push(...behaviourInsights);
    candidateInsights.push(...activeLeakInsights);
  }

  // 2.f COMMITMENT_LOAD (share of income, subscription overlap without judgement)
  if (schedules.length > 0) {
    const commitmentInsights = analyzeCommitmentLoad(schedules, now);
    candidateInsights.push(...commitmentInsights);
  }

  // 2.g SAVINGS (savings rate, investment totals, gold tracking)
  if (schedules.length > 0) {
    const savingsInsights = analyzeSavings(
      expenses,
      schedules,
      now,
      options?.savingsTargetRate
    );
    candidateInsights.push(...savingsInsights);
  }

  // 2.h PROJECTION (90th percentile capped pace + known commitments)
  // PROJECTION is not a ranked insight: return it as a separate field (like allowance) and never let it take a top-3 slot.
  let projection: MonthEndProjection | null = null;
  if (schedules.length > 0) {
    const projectionInsight = calculateMonthEndProjection(expenses, schedules, now);
    if (projectionInsight && projectionInsight.evidence) {
      const ev = projectionInsight.evidence as Record<string, number>;
      projection = {
        totalProjectedPaise: ev.totalProjectedPaise ?? projectionInsight.impactPaise,
        lowPaise: ev.lowPaise ?? Math.round(projectionInsight.impactPaise * 0.92),
        highPaise: ev.highPaise ?? Math.round(projectionInsight.impactPaise * 1.12),
        spentSoFarThisMonthPaise: ev.spentSoFarThisMonthPaise ?? 0,
        committedKnownRestOfMonthPaise: ev.committedKnownRestOfMonthPaise ?? 0,
        projectedDiscretionaryRemainingPaise: ev.projectedDiscretionaryRemainingPaise ?? 0,
        cappedP90Paise: ev.cappedP90Paise ?? 0,
        daysRemaining: ev.daysRemaining ?? 0,
        title: projectionInsight.title,
      };
    }
  }

  // 2.i EXPERIMENT_PROGRESS (closed-loop progress & completed savings)
  if (options?.experiments && options.experiments.length > 0) {
    const experimentInsights = generateExperimentProgressInsights(
      options.experiments,
      expenses,
      now
    );
    candidateInsights.push(...experimentInsights);
  }

  // ==========================================
  // 3. RANKING & MEMORY
  // ==========================================
  const { topInsights, allRankedInsights } = rankAndFilterInsights(
    candidateInsights,
    {
      now,
      monthlyIncomePaise: allowance?.monthlyIncomePaise,
      insightLogs,
    }
  );

  const learningInsight: Insight | null = isLearning
    ? {
        id: 'learning:gate',
        type: 'safe_to_spend',
        title: gateReasons.join('; '),
        evidence: {
          daysClosed: daysClosedCount,
          daysNeeded: Math.max(0, 14 - daysClosedCount),
          expenseCount: learning.expenseCount,
          expensesNeeded: Math.max(0, 30 - learning.expenseCount),
          isLearning: true,
        },
        impactPaise: 0,
        confidence: 1.0,
        actionable: false,
        levers: [],
        firstSeen: now,
        severity: 'info',
      }
    : null;

  return {
    evaluatedAt: now,
    coverage,
    allowance,
    projection,
    insights: isLearning
      ? [
          ...(safeToSpendInsight ? [safeToSpendInsight] : []),
          ...(learningInsight ? [learningInsight] : []),
        ]
      : topInsights,
    silentFlags,
    allRankedInsights,
    learning,
    // Expose gate state for the debug script and tests
    isLearning,
    gateReasons,
    transactionAnomalies: isLearning ? [] : transactionAnomalies,
    dailyAnomalies: isLearning ? [] : dailyAnomalies,
    recurring,
    budgetRunRate,
    trends,
  };
}
