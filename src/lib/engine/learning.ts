import type {
  EngineExpense,
  EngineDayClosure,
  OverallLearningState,
  CategoryLearningState,
} from './types';
import { EXPENSE_CATEGORIES } from '../validations';

const OVERALL_EXPENSE_THRESHOLD = 30;
const OVERALL_DAYS_THRESHOLD = 14;
const CATEGORY_EXPENSE_THRESHOLD = 8;

/**
 * Pure evaluation of the user's learning state.
 * Returns whether SpendCoach has gathered sufficient baseline data.
 * Rules:
 * - Learning thresholds count only closed days with status 'logged' or 'no_spend' (skipped days excluded).
 * - Excludes non-spend and schedule rows from discretionary learning counts.
 */
export function evaluateLearningState(
  expenses: EngineExpense[],
  closedDays?: EngineDayClosure[]
): OverallLearningState {
  // Discretionary spend expenses only
  const discretionaryExpenses = expenses.filter(
    (e) => (e.kind ?? 'spend') === 'spend' && (e.source ?? 'manual') !== 'schedule'
  );
  const expenseCount = discretionaryExpenses.length;

  let distinctDaysCount: number;
  if (closedDays !== undefined) {
    // Only count days closed with 'logged' or 'no_spend'; 'skipped' days are excluded!
    const validClosedDays = closedDays.filter(
      (d) => d.status === 'logged' || d.status === 'no_spend'
    );
    distinctDaysCount = new Set(validClosedDays.map((d) => d.day)).size;
  } else {
    // Fallback when closures are not supplied (e.g. legacy/isolated unit tests)
    distinctDaysCount = new Set(discretionaryExpenses.map((e) => e.spentOn)).size;
  }


  const isOverallReady =
    expenseCount >= OVERALL_EXPENSE_THRESHOLD &&
    distinctDaysCount >= OVERALL_DAYS_THRESHOLD;

  // Aggregate per-category counts
  const categoryCounts: Record<string, number> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    categoryCounts[cat] = 0;
  }

  for (const exp of discretionaryExpenses) {
    categoryCounts[exp.category] = (categoryCounts[exp.category] || 0) + 1;
  }

  const categories: Record<string, CategoryLearningState> = {};
  for (const [cat, count] of Object.entries(categoryCounts)) {
    const isCatReady = count >= CATEGORY_EXPENSE_THRESHOLD;
    categories[cat] = {
      category: cat,
      status: isCatReady ? 'ready' : 'learning',
      expenseCount: count,
      threshold: CATEGORY_EXPENSE_THRESHOLD,
      expensesNeeded: Math.max(0, CATEGORY_EXPENSE_THRESHOLD - count),
    };
  }

  return {
    status: isOverallReady ? 'ready' : 'learning',
    expenseCount,
    distinctDaysCount,
    expenseThreshold: OVERALL_EXPENSE_THRESHOLD,
    distinctDaysThreshold: OVERALL_DAYS_THRESHOLD,
    expensesNeeded: Math.max(0, OVERALL_EXPENSE_THRESHOLD - expenseCount),
    daysNeeded: Math.max(0, OVERALL_DAYS_THRESHOLD - distinctDaysCount),
    categories,
  };
}
