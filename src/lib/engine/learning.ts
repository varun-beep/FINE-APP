import type { EngineExpense, OverallLearningState, CategoryLearningState } from './types';
import { EXPENSE_CATEGORIES } from '../validations';

const OVERALL_EXPENSE_THRESHOLD = 30;
const OVERALL_DAYS_THRESHOLD = 14;
const CATEGORY_EXPENSE_THRESHOLD = 8;

/**
 * Pure evaluation of the user's learning state.
 * Returns whether SpendCoach has gathered sufficient baseline data.
 */
export function evaluateLearningState(expenses: EngineExpense[]): OverallLearningState {
  const expenseCount = expenses.length;
  const distinctDays = new Set(expenses.map((e) => e.spentOn));
  const distinctDaysCount = distinctDays.size;

  const isOverallReady =
    expenseCount >= OVERALL_EXPENSE_THRESHOLD &&
    distinctDaysCount >= OVERALL_DAYS_THRESHOLD;

  // Aggregate per-category counts
  const categoryCounts: Record<string, number> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    categoryCounts[cat] = 0;
  }

  for (const exp of expenses) {
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
