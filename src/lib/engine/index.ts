import type {
  EngineExpense,
  EngineOptions,
  EngineOutput,
  Insight,
  SilentFlag,
  MonthEndProjection,
} from './types';
import { getKolkataToday } from '../date';
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
  const closedDays = options?.closedDays || [];
  const insightLogs = options?.insightLogs || [];

  // 1. Learning state (counts only logged or no_spend closed days; excludes skipped days)
  const learning = evaluateLearningState(expenses, closedDays);

  // 2. Coverage report (honesty: what is ready vs what data is missing)
  const coverage = evaluateCoverage(expenses, closedDays, now);

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
  // No outlier/drift/behaviour/leak insights until coverage thresholds are met;
  // before that return only safe_to_spend and a clear "still learning: needs X more closed days".
  const isLearning =
    learning.status === 'learning' ||
    (closedDays.length > 0 && coverage.daysClosed < 14) ||
    learning.expenseCount < 30 ||
    learning.distinctDaysCount < 14;

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

    for (const ins of outlierResult.insights) {
      if (ins.expenseId) flaggedOutlierIds.add(ins.expenseId);
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

    // 2.c DRIFT (4 weeks vs prior 8 weeks medians)
    const driftResult = analyzeCategoryDrift(expenses, now, { outlierExpenseIds: flaggedOutlierIds });
    candidateInsights.push(...driftResult.insights);

    // 2.d BEHAVIOUR (payday surge, weekend ratio, merchant concentration)
    const behaviourInsights = analyzeBehaviour(expenses, schedules, now, { outlierExpenseIds: flaggedOutlierIds });
    candidateInsights.push(...behaviourInsights);

    // 2.e SMALL_LEAKS (>= 8 purchases in 30 days, median < ₹300, >= 3% of discretionary)
    const leakInsights = detectSmallLeaks(expenses, now, { outlierExpenseIds: flaggedOutlierIds });
    candidateInsights.push(...leakInsights);
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

  return {
    evaluatedAt: now,
    coverage,
    allowance,
    projection,
    insights: isLearning && safeToSpendInsight ? [safeToSpendInsight] : topInsights,
    silentFlags,
    allRankedInsights,
    learning,
    transactionAnomalies: isLearning ? [] : transactionAnomalies,
    dailyAnomalies: isLearning ? [] : dailyAnomalies,
    recurring,
    budgetRunRate,
    trends,
  };
}
