import type { EngineExpense, EngineOptions, EngineOutput } from './types';
import { getKolkataToday } from '../date';
import { evaluateLearningState } from './learning';
import { detectAnomalies } from './anomalies';
import { detectRecurring } from './recurring';
import { calculateBudgetRunRate } from './runrate';
import { calculateTrends } from './trends';

export * from './types';
export * from './math';
export * from './learning';
export * from './anomalies';
export * from './recurring';
export * from './runrate';
export * from './trends';

/**
 * Pure learning engine entrypoint:
 * Takes plain expense array and optional budgets/date/schedules/closedDays.
 * Has NO network or database dependencies.
 */
export function analyzeExpenses(
  expenses: EngineExpense[],
  options?: EngineOptions
): EngineOutput {
  const now = options?.now || getKolkataToday();
  const budgets = options?.budgets;
  const schedules = options?.schedules;
  const closedDays = options?.closedDays;

  // 1. Learning state (counts only logged or no_spend closed days; excludes skipped days)
  const learning = evaluateLearningState(expenses, closedDays);

  // 2. Anomalies (only if learning is 'ready')
  const { transactionAnomalies, dailyAnomalies } = detectAnomalies(
    expenses,
    learning,
    now
  );

  // 3. Recurring detection
  const recurring = detectRecurring(expenses);

  // 4. Budget & month-end run rate (committed schedules for rest of month added as certain spend)
  const budgetRunRate = calculateBudgetRunRate(
    expenses,
    budgets,
    recurring,
    now,
    schedules
  );

  // 5. Trends
  const trends = calculateTrends(expenses, now);

  return {
    evaluatedAt: now,
    learning,
    transactionAnomalies,
    dailyAnomalies,
    recurring,
    budgetRunRate,
    trends,
  };
}
