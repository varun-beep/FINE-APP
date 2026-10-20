import type { EngineExpense, EngineDayClosure, CoverageReport } from './types';
import { daysDifference } from './math';

/**
 * Computes coverage metrics and honesty reasons.
 * Tells the caller exactly how much data is ready vs still learning.
 */
export function evaluateCoverage(
  expenses: EngineExpense[],
  closedDays: EngineDayClosure[] = [],
  now: string
): CoverageReport {
  // Count closed days (logged or no_spend)
  const validClosedDays = closedDays.filter(
    (c) => c.status === 'logged' || c.status === 'no_spend'
  );
  const daysClosed = validClosedDays.length;

  // Find earliest date
  let earliestDate = now;
  for (const exp of expenses) {
    if (exp.spentOn < earliestDate) {
      earliestDate = exp.spentOn;
    }
  }
  for (const c of closedDays) {
    if (c.day < earliestDate) {
      earliestDate = c.day;
    }
  }

  const spanDays = Math.max(0, daysDifference(now, earliestDate));
  const weeksOfHistory = Math.floor(spanDays / 7);

  // Category counts (discretionary spend only)
  const categoryCounts: Record<string, number> = {};
  for (const exp of expenses) {
    if (exp.kind === 'spend' || !exp.kind) {
      categoryCounts[exp.category] = (categoryCounts[exp.category] || 0) + 1;
    }
  }

  const categoriesReady: string[] = [];
  const categoriesLearning: string[] = [];
  const reasons: string[] = [];

  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count >= 8) {
      categoriesReady.push(cat);
    } else {
      categoriesLearning.push(cat);
      reasons.push(`${cat} has ${count}/8 entries needed for a reliable baseline`);
    }
  }

  if (daysClosed < 14) {
    reasons.push(`Need ${14 - daysClosed} more closed days (have ${daysClosed}/14) for habit baseline`);
  }
  if (weeksOfHistory < 8) {
    reasons.push(`Need ${8 - weeksOfHistory} more weeks of history (have ${weeksOfHistory}/8) for trend drift detection`);
  }

  return {
    daysClosed,
    weeksOfHistory,
    categoriesReady,
    categoriesLearning,
    reasons,
  };
}
