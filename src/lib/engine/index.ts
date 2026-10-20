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
 * Takes plain expense array and optional budgets/date.
 * Has NO network or database dependencies.
 */
export function analyzeExpenses(
  expenses: EngineExpense[],
  options?: EngineOptions
): EngineOutput {
  const now = options?.now || getKolkataToday();
  const budgets = options?.budgets;

  // 1. Learning state
  const learning = evaluateLearningState(expenses);

  // 2. Anomalies (only if learning is 'ready')
  const { transactionAnomalies, dailyAnomalies } = detectAnomalies(
    expenses,
    learning,
    now
  );

  // 3. Recurring detection
  const recurring = detectRecurring(expenses);

  // 4. Budget & month-end run rate
  const budgetRunRate = calculateBudgetRunRate(
    expenses,
    budgets,
    recurring,
    now
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
