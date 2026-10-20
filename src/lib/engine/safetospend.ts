import type {
  EngineExpense,
  EngineSchedule,
  SafeToSpendAllowance,
  AllowanceVerdict,
  Insight,
} from './types';
import { getDaysInMonth, addDays } from './math';
import { formatPaiseToRupees } from '../money';

export interface SafeToSpendResult {
  allowance: SafeToSpendAllowance | null;
  insight: Insight | null;
  insufficientReason?: string;
}

/**
 * Calculates monthly equivalent paise for a schedule.
 */
function getMonthlySchedulePaise(s: EngineSchedule, daysInMonth: number): number {
  switch (s.frequency) {
    case 'daily':
      return s.amountPaise * daysInMonth;
    case 'weekly':
      return Math.round(s.amountPaise * (daysInMonth / 7));
    case 'monthly':
      return s.amountPaise;
    case 'yearly':
      return Math.round(s.amountPaise / 12);
    default:
      return s.amountPaise;
  }
}

/**
 * Safe-to-Spend generator:
 * Income - commitments - savings target - discretionary spent so far = remaining.
 * Remaining / days left = daily allowance (flat & weekday-aware).
 */
export function calculateSafeToSpend(
  expenses: EngineExpense[],
  schedules: EngineSchedule[] = [],
  now: string,
  savingsTargetRate = 0.20
): SafeToSpendResult {
  const [yearStr, monthStr, dayStr] = now.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const currentDay = parseInt(dayStr, 10);
  const totalDaysInMonth = getDaysInMonth(year, month);
  const monthPrefix = `${yearStr}-${monthStr}`;

  // 1. Determine Income
  const activeIncomeSchedules = schedules.filter(
    (s) => s.kind === 'income' && s.active
  );

  let monthlyIncomePaise = 0;
  if (activeIncomeSchedules.length > 0) {
    for (const s of activeIncomeSchedules) {
      monthlyIncomePaise += getMonthlySchedulePaise(s, totalDaysInMonth);
    }
  } else {
    // Check trailing 3-month income (90 days)
    const ninetyDaysAgo = addDays(now, -90);
    const trailingIncomeExpenses = expenses.filter(
      (e) => e.kind === 'income' && e.spentOn >= ninetyDaysAgo && e.spentOn <= now
    );
    const totalTrailingIncome = trailingIncomeExpenses.reduce(
      (acc, e) => acc + e.amountPaise,
      0
    );
    if (totalTrailingIncome > 0) {
      monthlyIncomePaise = Math.round(totalTrailingIncome / 3);
    }
  }

  if (monthlyIncomePaise <= 0) {
    return {
      allowance: null,
      insight: null,
      insufficientReason: 'insufficient_data: No active income schedule or trailing 3-month income history found',
    };
  }

  // 2. Committed items due this month (non-income active schedules)
  const nonIncomeSchedules = schedules.filter(
    (s) => s.kind !== 'income' && s.active
  );
  let committedDuePaise = 0;
  for (const s of nonIncomeSchedules) {
    committedDuePaise += getMonthlySchedulePaise(s, totalDaysInMonth);
  }

  // 3. Savings target
  const savingsTargetPaise = Math.round(monthlyIncomePaise * savingsTargetRate);

  // 4. Discretionary spent so far this month
  const thisMonthExpenses = expenses.filter(
    (e) =>
      e.spentOn.startsWith(monthPrefix) &&
      e.spentOn <= now &&
      (e.kind === 'spend' || !e.kind) &&
      e.source !== 'schedule'
  );

  let discretionarySpentBeforeToday = 0;
  let todaySpentPaise = 0;

  for (const exp of thisMonthExpenses) {
    if (exp.spentOn === now) {
      todaySpentPaise += exp.amountPaise;
    } else {
      discretionarySpentBeforeToday += exp.amountPaise;
    }
  }

  const discretionarySpentSoFarPaise = discretionarySpentBeforeToday + todaySpentPaise;

  // 5. Remaining discretionary budget
  const remainingDiscretionaryBeforeToday =
    monthlyIncomePaise - committedDuePaise - savingsTargetPaise - discretionarySpentBeforeToday;
  const remainingDiscretionaryPaise = remainingDiscretionaryBeforeToday - todaySpentPaise;

  // 6. Days left
  const daysLeftInMonth = totalDaysInMonth - currentDay + 1; // including today
  const daysLeftTomorrow = Math.max(0, totalDaysInMonth - currentDay);

  const dailyAllowancePaise =
    daysLeftInMonth > 0
      ? Math.max(0, Math.round(remainingDiscretionaryBeforeToday / daysLeftInMonth))
      : 0;

  const tomorrowDailyAllowancePaise =
    daysLeftTomorrow > 0
      ? Math.max(0, Math.round(remainingDiscretionaryPaise / daysLeftTomorrow))
      : 0;

  // 7. Weekday profile calculation
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];

  const historicalDiscretionary = expenses.filter(
    (e) => (e.kind === 'spend' || !e.kind) && e.source !== 'schedule'
  );

  for (const e of historicalDiscretionary) {
    const [y, m, d] = e.spentOn.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    weekdayTotals[dayOfWeek] += e.amountPaise;
    weekdayCounts[dayOfWeek]++;
  }

  const weekdayAverages = weekdayTotals.map((tot, idx) =>
    weekdayCounts[idx] > 0 ? tot / weekdayCounts[idx] : 1
  );
  const meanWeekdaySpend =
    weekdayAverages.reduce((acc, v) => acc + v, 0) / 7 || 1;
  const weekdayWeights = weekdayAverages.map((v) => v / meanWeekdaySpend);

  // Compute weights for remaining days of this month (from today to month-end)
  let sumRemainingWeightsToday = 0;
  for (let d = currentDay; d <= totalDaysInMonth; d++) {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    sumRemainingWeightsToday += weekdayWeights[dayOfWeek];
  }

  const [ny, nm, nd] = now.split('-').map(Number);
  const todayDow = new Date(Date.UTC(ny, nm - 1, nd)).getUTCDay();
  const todayWeight = weekdayWeights[todayDow];

  const weekdayAwareAllowancePaise =
    sumRemainingWeightsToday > 0 && remainingDiscretionaryBeforeToday > 0
      ? Math.max(
          0,
          Math.round(
            remainingDiscretionaryBeforeToday * (todayWeight / sumRemainingWeightsToday)
          )
        )
      : dailyAllowancePaise;

  // Tomorrow weekday-aware allowance
  let sumRemainingWeightsTomorrow = 0;
  for (let d = currentDay + 1; d <= totalDaysInMonth; d++) {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    sumRemainingWeightsTomorrow += weekdayWeights[dayOfWeek];
  }

  const tomorrowDateStr = addDays(now, 1);
  const [ty, tm, td] = tomorrowDateStr.split('-').map(Number);
  const tomorrowDow = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
  const tomorrowWeight = weekdayWeights[tomorrowDow];

  const tomorrowWeekdayAllowancePaise =
    sumRemainingWeightsTomorrow > 0 && remainingDiscretionaryPaise > 0
      ? Math.max(
          0,
          Math.round(
            remainingDiscretionaryPaise * (tomorrowWeight / sumRemainingWeightsTomorrow)
          )
        )
      : tomorrowDailyAllowancePaise;

  // 8. Verdict
  let verdict: AllowanceVerdict = 'at';
  if (todaySpentPaise < dailyAllowancePaise * 0.95) {
    verdict = 'under';
  } else if (todaySpentPaise > dailyAllowancePaise * 1.05) {
    verdict = 'over';
  }

  const allowance: SafeToSpendAllowance = {
    dailyAllowancePaise,
    weekdayAwareAllowancePaise,
    todaySpentPaise,
    verdict,
    tomorrowDailyAllowancePaise,
    tomorrowWeekdayAllowancePaise,
    monthlyIncomePaise,
    committedDuePaise,
    savingsTargetPaise,
    discretionarySpentSoFarPaise,
    remainingDiscretionaryPaise,
    daysLeftInMonth,
  };

  const deltaFromAllowance = todaySpentPaise - dailyAllowancePaise;

  const insight: Insight = {
    id: `safe_to_spend:${now}`,
    type: 'safe_to_spend',
    title: `Today's Safe-to-Spend: ${formatPaiseToRupees(dailyAllowancePaise)} (${verdict})`,
    impactPaise: Math.abs(deltaFromAllowance),
    confidence: 0.95,
    actionable: true,
    firstSeen: now,
    severity: verdict === 'over' ? 'warning' : 'info',
    levers: [
      {
        id: 'pace_allowance',
        description: `Hold daily spend near ${formatPaiseToRupees(dailyAllowancePaise)} to protect ${formatPaiseToRupees(savingsTargetPaise)} savings target`,
        monthlySavingPaise: Math.max(0, deltaFromAllowance),
      },
    ],

    evidence: {
      monthlyIncomePaise,
      committedDuePaise,
      savingsTargetPaise,
      discretionarySpentSoFarPaise,
      remainingDiscretionaryPaise,
      dailyAllowancePaise,
      weekdayAwareAllowancePaise,
      todaySpentPaise,
      verdict,
      tomorrowDailyAllowancePaise,
      tomorrowWeekdayAllowancePaise,
      daysLeftInMonth,
    },
  };

  return { allowance, insight };
}
