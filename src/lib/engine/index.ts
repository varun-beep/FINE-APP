import type { EngineExpense, EngineOptions, EngineOutput, Insight, SilentFlag } from './types';
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

  // Monthly discretionary budget baseline
  const monthlyDiscretionaryBudget = allowance
    ? allowance.monthlyIncomePaise - allowance.committedDuePaise - allowance.savingsTargetPaise
    : 4000000;

  // 2.b OUTLIER (context-aware: lumpy vs steady, duplicates, large one-offs, habit spikes)
  const outlierResult = detectContextAwareOutliers(expenses, now, {
    monthlyDiscretionaryBudgetPaise: monthlyDiscretionaryBudget,
    insightLogs,
  });
  candidateInsights.push(...outlierResult.insights);
  silentFlags.push(...outlierResult.silentFlags);

  // 2.c DRIFT (4 weeks vs prior 8 weeks medians)
  const driftResult = analyzeCategoryDrift(expenses, now);
  candidateInsights.push(...driftResult.insights);

  // 2.d BEHAVIOUR (payday surge, weekend ratio, merchant concentration)
  const behaviourInsights = analyzeBehaviour(expenses, schedules, now);
  candidateInsights.push(...behaviourInsights);

  // 2.e SMALL_LEAKS (>= 8 purchases in 30 days, median < ₹300, >= 3% of discretionary)
  const leakInsights = detectSmallLeaks(expenses, now);
  candidateInsights.push(...leakInsights);

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
  if (schedules.length > 0) {
    const projectionInsight = calculateMonthEndProjection(expenses, schedules, now);
    if (projectionInsight) {
      candidateInsights.push(projectionInsight);
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
    insights: topInsights,
    silentFlags,
    allRankedInsights,
    learning,
    transactionAnomalies,
    dailyAnomalies,
    recurring,
    budgetRunRate,
    trends,
  };
}
