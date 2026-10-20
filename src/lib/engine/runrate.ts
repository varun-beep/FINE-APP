import type {
  EngineExpense,
  EngineBudget,
  RecurringItem,
  OverallBudgetRunRate,
  CategoryBudgetRunRate,
  BudgetStatus,
} from './types';
import { getDaysInMonth } from './math';
import { normalizeMerchantKey } from './recurring';
import { EXPENSE_CATEGORIES } from '../validations';

/**
 * Calculates current month spent-so-far, projected month-end (linear run rate blended with recurring),
 * and budget statuses for all categories and overall.
 */
export function calculateBudgetRunRate(
  expenses: EngineExpense[],
  budgets: EngineBudget[] | undefined,
  recurring: RecurringItem[],
  now: string
): OverallBudgetRunRate {
  const [yearStr, monthStr, dayStr] = now.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const totalDaysInMonth = getDaysInMonth(year, month);
  const elapsedDays = Math.max(1, Math.min(day, totalDaysInMonth));
  const currentMonthPrefix = `${yearStr}-${monthStr}`;
  const monthEndDate = `${currentMonthPrefix}-${String(totalDaysInMonth).padStart(2, '0')}`;

  const budgetMap = new Map<string, number>();
  if (budgets) {
    for (const b of budgets) {
      budgetMap.set(b.category, b.monthlyLimitPaise);
    }
  }

  // Filter expenses strictly belonging to the current month up to 'now'
  const currentMonthExpenses = expenses.filter(
    (e) => e.spentOn.startsWith(currentMonthPrefix) && e.spentOn <= now
  );

  // Group recurring items by category
  const recurringByKey = new Map<string, RecurringItem>();
  for (const r of recurring) {
    recurringByKey.set(r.key, r);
  }

  // Helper to compute category projection
  const computeProjection = (
    catExpenses: EngineExpense[],
    catRecurring: RecurringItem[]
  ) => {
    const spentSoFar = catExpenses.reduce((sum, e) => sum + e.amountPaise, 0);

    // Identify recurring expenses already billed in current month
    let recurringSpentSoFar = 0;
    const billedRecurringKeys = new Set<string>();

    for (const e of catExpenses) {
      const norm = normalizeMerchantKey(e.merchant, e.note);
      if (norm && recurringByKey.has(norm.key)) {
        recurringSpentSoFar += e.amountPaise;
        billedRecurringKeys.add(norm.key);
      }
    }

    // Identify upcoming recurring items expected before month-end
    let upcomingRecurringExpected = 0;
    for (const r of catRecurring) {
      // Check if next expected date falls between now and month-end
      if (r.nextExpectedDate > now && r.nextExpectedDate <= monthEndDate) {
        upcomingRecurringExpected += r.estimatedAmountPaise;
      }
    }

    // Discretionary spend projected linearly
    const discretionarySpent = Math.max(0, spentSoFar - recurringSpentSoFar);
    const discretionaryProjected = (discretionarySpent * totalDaysInMonth) / elapsedDays;

    const projectedMonthEnd = Math.round(
      discretionaryProjected + recurringSpentSoFar + upcomingRecurringExpected
    );

    return { spentSoFar, projectedMonthEnd };
  };

  // Evaluate per-category
  const categoryResults: CategoryBudgetRunRate[] = [];

  for (const cat of EXPENSE_CATEGORIES) {
    const catExpenses = currentMonthExpenses.filter((e) => e.category === cat);
    const catRecurring = recurring.filter((r) => r.category === cat);

    const { spentSoFar, projectedMonthEnd } = computeProjection(catExpenses, catRecurring);
    const limit = budgetMap.get(cat) ?? null;

    let budgetStatus: BudgetStatus = 'on_track';
    let percentageUsed: number | null = null;
    let projectedPercentage: number | null = null;

    if (limit && limit > 0) {
      percentageUsed = Math.round((spentSoFar / limit) * 100);
      projectedPercentage = Math.round((projectedMonthEnd / limit) * 100);

      if (spentSoFar > limit || projectedMonthEnd > limit) {
        budgetStatus = 'over';
      } else if (projectedMonthEnd > 0.85 * limit) {
        budgetStatus = 'warning';
      } else {
        budgetStatus = 'on_track';
      }
    }

    categoryResults.push({
      category: cat,
      spentSoFarPaise: spentSoFar,
      projectedMonthEndPaise: projectedMonthEnd,
      monthlyLimitPaise: limit,
      budgetStatus,
      percentageUsed,
      projectedPercentage,
    });
  }

  // Evaluate overall
  const { spentSoFar: overallSpent, projectedMonthEnd: overallProjected } =
    computeProjection(currentMonthExpenses, recurring);

  const totalBudgetLimit = budgets && budgets.length > 0
    ? budgets.reduce((sum, b) => sum + b.monthlyLimitPaise, 0)
    : null;

  let overallStatus: BudgetStatus = 'on_track';
  let overallPercentageUsed: number | null = null;
  let overallProjectedPercentage: number | null = null;

  if (totalBudgetLimit && totalBudgetLimit > 0) {
    overallPercentageUsed = Math.round((overallSpent / totalBudgetLimit) * 100);
    overallProjectedPercentage = Math.round((overallProjected / totalBudgetLimit) * 100);

    if (overallSpent > totalBudgetLimit || overallProjected > totalBudgetLimit) {
      overallStatus = 'over';
    } else if (overallProjected > 0.85 * totalBudgetLimit) {
      overallStatus = 'warning';
    } else {
      overallStatus = 'on_track';
    }
  }

  return {
    spentSoFarPaise: overallSpent,
    projectedMonthEndPaise: overallProjected,
    monthlyLimitPaise: totalBudgetLimit,
    budgetStatus: overallStatus,
    percentageUsed: overallPercentageUsed,
    projectedPercentage: overallProjectedPercentage,
    categories: categoryResults,
  };
}
