import type { EngineExpense, OverallTrends, CategoryTrend } from './types';
import { addDays, getDaysInMonth } from './math';
import { EXPENSE_CATEGORIES } from '../validations';

/**
 * Calculates spending trends:
 * - Last 7 days vs previous 7 days
 * - Current month to date vs previous month to date
 */
export function calculateTrends(
  expenses: EngineExpense[],
  now: string
): OverallTrends {
  // 1. Last 7 days: [now - 6, now]
  const last7Start = addDays(now, -6);
  const last7End = now;

  // 2. Previous 7 days: [now - 13, now - 7]
  const prev7Start = addDays(now, -13);
  const prev7End = addDays(now, -7);

  // 3. Current month to date: [YYYY-MM-01, now]
  const [curYStr, curMStr, curDStr] = now.split('-');
  const curY = parseInt(curYStr, 10);
  const curM = parseInt(curMStr, 10);
  const curDay = parseInt(curDStr, 10);

  const curMtdStart = `${curYStr}-${curMStr}-01`;
  const curMtdEnd = now;

  // 4. Previous month to date:
  let prevY = curY;
  let prevM = curM - 1;
  if (prevM === 0) {
    prevM = 12;
    prevY -= 1;
  }
  const prevMStr = String(prevM).padStart(2, '0');
  const prevYStr = String(prevY);
  const prevMonthTotalDays = getDaysInMonth(prevY, prevM);
  const prevDayCapped = Math.min(curDay, prevMonthTotalDays);

  const prevMtdStart = `${prevYStr}-${prevMStr}-01`;
  const prevMtdEnd = `${prevYStr}-${prevMStr}-${String(prevDayCapped).padStart(2, '0')}`;

  function computePercentChange(current: number, previous: number): number | null {
    if (previous === 0) {
      return current > 0 ? null : 0;
    }
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  function sumExpenses(list: EngineExpense[], start: string, end: string): number {
    return list
      .filter((e) => e.spentOn >= start && e.spentOn <= end)
      .reduce((sum, e) => sum + e.amountPaise, 0);
  }

  // Calculate overall trends
  const overallLast7 = sumExpenses(expenses, last7Start, last7End);
  const overallPrev7 = sumExpenses(expenses, prev7Start, prev7End);
  const overallCurMtd = sumExpenses(expenses, curMtdStart, curMtdEnd);
  const overallPrevMtd = sumExpenses(expenses, prevMtdStart, prevMtdEnd);

  // Calculate per-category trends
  const categoryTrends: CategoryTrend[] = [];

  for (const cat of EXPENSE_CATEGORIES) {
    const catExpenses = expenses.filter((e) => e.category === cat);
    const catLast7 = sumExpenses(catExpenses, last7Start, last7End);
    const catPrev7 = sumExpenses(catExpenses, prev7Start, prev7End);
    const catCurMtd = sumExpenses(catExpenses, curMtdStart, curMtdEnd);
    const catPrevMtd = sumExpenses(catExpenses, prevMtdStart, prevMtdEnd);

    categoryTrends.push({
      category: cat,
      last7DaysPaise: catLast7,
      prev7DaysPaise: catPrev7,
      weekOverWeekPercent: computePercentChange(catLast7, catPrev7),
      currentMonthToDatePaise: catCurMtd,
      prevMonthToDatePaise: catPrevMtd,
      monthOverMonthPercent: computePercentChange(catCurMtd, catPrevMtd),
    });
  }

  return {
    last7DaysPaise: overallLast7,
    prev7DaysPaise: overallPrev7,
    weekOverWeekPercent: computePercentChange(overallLast7, overallPrev7),
    currentMonthToDatePaise: overallCurMtd,
    prevMonthToDatePaise: overallPrevMtd,
    monthOverMonthPercent: computePercentChange(overallCurMtd, overallPrevMtd),
    categories: categoryTrends,
  };
}
