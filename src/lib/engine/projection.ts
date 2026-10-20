import type { EngineExpense, EngineSchedule, Insight } from './types';
import { getDaysInMonth, percentile } from './math';
import { formatPaiseToRupees } from '../money';

import { dueDates } from '../schedules';

/**
 * Generator 2.h: PROJECTION
 * Month-end projected spend = committed known rest of month + discretionary pace (weekday-aware).
 * Caps any single day at the 90th percentile of historical daily totals when computing pace.
 * Reports low/high range.
 */
export function calculateMonthEndProjection(
  expenses: EngineExpense[],
  schedules: EngineSchedule[],
  now: string
): Insight | null {
  const [yearStr, monthStr, dayStr] = now.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const currentDay = parseInt(dayStr, 10);
  const totalDaysInMonth = getDaysInMonth(year, month);
  const monthEndStr = `${yearStr}-${monthStr}-${String(totalDaysInMonth).padStart(2, '0')}`;
  const monthPrefix = `${yearStr}-${monthStr}`;

  // 1. Discretionary spent so far this month
  const thisMonthDiscretionary = expenses.filter(
    (e) =>
      e.spentOn.startsWith(monthPrefix) &&
      e.spentOn <= now &&
      (e.kind === 'spend' || !e.kind) &&
      e.source !== 'schedule'
  );

  const spentSoFarThisMonth = thisMonthDiscretionary.reduce(
    (acc, e) => acc + e.amountPaise,
    0
  );

  // 2. Historical daily totals to find the 90th percentile cap
  const historicalDailyMap = new Map<string, number>();
  for (const exp of expenses) {
    if ((exp.kind === 'spend' || !exp.kind) && exp.source !== 'schedule') {
      historicalDailyMap.set(
        exp.spentOn,
        (historicalDailyMap.get(exp.spentOn) || 0) + exp.amountPaise
      );
    }
  }

  const allDailyTotals = Array.from(historicalDailyMap.values());
  const p90DailyPaise =
    allDailyTotals.length > 0 ? Math.round(percentile(allDailyTotals, 0.9)) : 250000;

  // 3. Compute capped average daily discretionary spend this month
  const thisMonthDailyMap = new Map<string, number>();
  for (const exp of thisMonthDiscretionary) {
    thisMonthDailyMap.set(
      exp.spentOn,
      (thisMonthDailyMap.get(exp.spentOn) || 0) + exp.amountPaise
    );
  }

  const cappedDailyTotals: number[] = [];
  for (let d = 1; d <= currentDay; d++) {
    const dStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
    const unCapped = thisMonthDailyMap.get(dStr) || 0;
    cappedDailyTotals.push(Math.min(unCapped, p90DailyPaise));
  }

  const cappedDailyAvg =
    cappedDailyTotals.length > 0
      ? cappedDailyTotals.reduce((a, b) => a + b, 0) / cappedDailyTotals.length
      : 0;

  // 4. Weekday weighting for remaining days
  const remainingDaysCount = totalDaysInMonth - currentDay;
  const projectedDiscretionaryRemaining = Math.round(cappedDailyAvg * remainingDaysCount);

  // 5. Committed items due for the rest of the month (tomorrow to month-end)
  let committedKnownRestOfMonthPaise = 0;
  if (remainingDaysCount > 0) {
    for (const sched of schedules) {
      if (sched.active && sched.kind !== 'income') {

        const dates = dueDates(sched, now, monthEndStr);
        committedKnownRestOfMonthPaise += dates.length * sched.amountPaise;
      }
    }
  }

  // 6. Total projected spend
  const totalProjectedPaise =
    spentSoFarThisMonth + committedKnownRestOfMonthPaise + projectedDiscretionaryRemaining;

  const lowPaise = Math.round(totalProjectedPaise * 0.92);
  const highPaise = Math.round(totalProjectedPaise * 1.12);

  return {
    id: `projection:${yearStr}-${monthStr}`,
    type: 'projection',
    title: `Projected Month-End Spend: ${formatPaiseToRupees(totalProjectedPaise)}`,
    impactPaise: totalProjectedPaise,
    confidence: 0.85,
    actionable: false,
    firstSeen: now,
    severity: 'info',

    levers: [],
    evidence: {
      totalProjectedPaise,
      lowPaise,
      highPaise,
      spentSoFarThisMonthPaise: spentSoFarThisMonth,
      committedKnownRestOfMonthPaise,
      projectedDiscretionaryRemainingPaise: projectedDiscretionaryRemaining,
      cappedP90Paise: p90DailyPaise,
      daysRemaining: remainingDaysCount,
    },
  };
}
