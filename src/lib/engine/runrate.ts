import type {
  EngineExpense,
  EngineBudget,
  EngineSchedule,
  RecurringItem,
  OverallBudgetRunRate,
  CategoryBudgetRunRate,
  BudgetStatus,
} from './types';
import { getDaysInMonth } from './math';
import { dueDates } from '../schedules';
import { EXPENSE_CATEGORIES } from '../validations';

/**
 * Calculates current month spent-so-far, projected month-end, and budget statuses.
 * Committed items due for the rest of the month are added as certain spend, not extrapolated.
 */
export function calculateBudgetRunRate(
  expenses: EngineExpense[],
  budgets: EngineBudget[] | undefined,
  recurring: RecurringItem[],
  now: string,
  schedules?: EngineSchedule[]
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

  // Filter expenses strictly belonging to the current month up to 'now' (only spend, not investment or income)
  const currentMonthExpenses = expenses.filter(
    (e) =>
      e.spentOn.startsWith(currentMonthPrefix) &&
      e.spentOn <= now &&
      (e.kind ?? 'spend') === 'spend'
  );

  // Precompute committed items due for rest of month from schedules
  const committedUpcomingByCat = new Map<string, number>();
  let totalCommittedUpcoming = 0;

  if (schedules && schedules.length > 0) {
    const activeSpendSchedules = schedules.filter(
      (s) => s.active && s.kind !== 'investment' && s.kind !== 'income'
    );

    for (const sched of activeSpendSchedules) {
      const dates = dueDates(sched, now, monthEndDate);
      const cost = dates.length * sched.amountPaise;
      committedUpcomingByCat.set(
        sched.category,
        (committedUpcomingByCat.get(sched.category) || 0) + cost
      );
      totalCommittedUpcoming += cost;
    }
  }

  // Helper to compute category projection
  const computeProjection = (
    catExpenses: EngineExpense[],
    committedUpcoming: number
  ) => {
    const spentSoFar = catExpenses.reduce((sum, e) => sum + e.amountPaise, 0);

    // Identify fixed schedule expenses already billed in current month
    const scheduledSpentSoFar = catExpenses
      .filter((e) => e.source === 'schedule')
      .reduce((sum, e) => sum + e.amountPaise, 0);

    // Discretionary spend is linearly extrapolated
    const discretionarySpent = Math.max(0, spentSoFar - scheduledSpentSoFar);
    const discretionaryProjected = (discretionarySpent * totalDaysInMonth) / elapsedDays;

    // Committed items due for the rest of the month are added as certain spend, not extrapolated!
    const projectedMonthEnd = Math.round(
      discretionaryProjected + scheduledSpentSoFar + committedUpcoming
    );

    return { spentSoFar, projectedMonthEnd };
  };

  // Evaluate per-category
  const categoryResults: CategoryBudgetRunRate[] = [];

  for (const cat of EXPENSE_CATEGORIES) {
    const catExpenses = currentMonthExpenses.filter((e) => e.category === cat);
    const catCommitted = committedUpcomingByCat.get(cat) || 0;

    const { spentSoFar, projectedMonthEnd } = computeProjection(
      catExpenses,
      catCommitted
    );
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
    computeProjection(currentMonthExpenses, totalCommittedUpcoming);

  const totalBudgetLimit =
    budgets && budgets.length > 0
      ? budgets.reduce((sum, b) => sum + b.monthlyLimitPaise, 0)
      : null;

  let overallStatus: BudgetStatus = 'on_track';
  let overallPercentageUsed: number | null = null;
  let overallProjectedPercentage: number | null = null;

  if (totalBudgetLimit && totalBudgetLimit > 0) {
    overallPercentageUsed = Math.round((overallSpent / totalBudgetLimit) * 100);
    overallProjectedPercentage = Math.round(
      (overallProjected / totalBudgetLimit) * 100
    );

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
