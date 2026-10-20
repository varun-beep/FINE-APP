import type {
  EngineExpense,
  OverallLearningState,
  TransactionAnomaly,
  DailyTotalAnomaly,
} from './types';
import {
  median,
  medianAbsoluteDeviation,
  modifiedZScore,
  addDays,
  getWeekdayName,
} from './math';

const TRANSACTION_WINDOW_DAYS = 90;
const DAILY_WINDOW_DAYS = 56; // 8 weeks
const MIN_WEEKDAY_POINTS = 4;

/**
 * Evaluates individual transaction anomalies and daily total anomalies.
 * If overall status is 'learning', returns empty arrays.
 * Excludes kind != 'spend', source == 'schedule', and one_off == true from baselines.
 */
export function detectAnomalies(
  expenses: EngineExpense[],
  learning: OverallLearningState,
  now: string
): {
  transactionAnomalies: TransactionAnomaly[];
  dailyAnomalies: DailyTotalAnomaly[];
} {
  if (learning.status === 'learning') {
    return { transactionAnomalies: [], dailyAnomalies: [] };
  }

  const transactionAnomalies = detectTransactionAnomalies(expenses, learning, now);
  const dailyAnomalies = detectDailyAnomalies(expenses, now);

  return { transactionAnomalies, dailyAnomalies };
}

function detectTransactionAnomalies(
  expenses: EngineExpense[],
  learning: OverallLearningState,
  now: string
): TransactionAnomaly[] {
  const anomalies: TransactionAnomaly[] = [];
  const minDate = addDays(now, -TRANSACTION_WINDOW_DAYS);

  // Consider all expenses within trailing 90 days of now
  const pool = expenses.filter((e) => e.spentOn >= minDate && e.spentOn <= now);

  // Eligible candidates and baseline pool:
  // EXCLUDE kind != 'spend', source == 'schedule', and one_off == true
  const baselinePool = pool.filter(
    (e) =>
      (e.kind ?? 'spend') === 'spend' &&
      (e.source ?? 'manual') !== 'schedule' &&
      !e.oneOff
  );

  for (const exp of baselinePool) {
    const isCategoryReady = learning.categories[exp.category]?.status === 'ready';

    // Baseline pool EXCLUDING the transaction being evaluated
    const baselineExpenses = baselinePool.filter((other) => other.id !== exp.id);

    let baselineAmounts: number[];
    let baselineType: 'category' | 'overall';

    if (isCategoryReady) {
      baselineAmounts = baselineExpenses
        .filter((other) => other.category === exp.category)
        .map((e) => e.amountPaise);
      baselineType = 'category';
    } else {
      // Fall back to all-spend baseline if category is still learning
      baselineAmounts = baselineExpenses.map((e) => e.amountPaise);
      baselineType = 'overall';
    }

    if (baselineAmounts.length === 0) continue;

    const med = median(baselineAmounts);
    const mad = medianAbsoluteDeviation(baselineAmounts, med);

    const ratioToMedian = med > 0 ? Math.round((exp.amountPaise / med) * 10) / 10 : 0;
    let isAnomaly = false;
    let score = 0;

    if (mad > 0) {
      score = Math.round(modifiedZScore(exp.amountPaise, med, mad) * 100) / 100;
      isAnomaly = score > 3.5 && exp.amountPaise > 1.5 * med;
    } else {
      // Fallback when MAD is 0 (all or most baseline values identical)
      isAnomaly = exp.amountPaise > 3 * med;
      score = med > 0 ? Math.round(((exp.amountPaise - med) / med) * 100) / 100 : 0;
    }

    if (isAnomaly) {
      const scopeLabel = baselineType === 'category' ? `${exp.category} spend` : 'overall spend';
      const reason = `${ratioToMedian}x your usual ${scopeLabel}`;

      anomalies.push({
        expenseId: exp.id,
        amountPaise: exp.amountPaise,
        category: exp.category,
        spentOn: exp.spentOn,
        merchant: exp.merchant,
        note: exp.note,
        score,
        medianPaise: Math.round(med),
        madPaise: Math.round(mad),
        ratioToMedian,
        baselineType,
        reason,
      });
    }
  }

  // Sort newest first, then highest score
  return anomalies.sort((a, b) => {
    if (b.spentOn !== a.spentOn) return b.spentOn.localeCompare(a.spentOn);
    return b.score - a.score;
  });
}

function detectDailyAnomalies(
  expenses: EngineExpense[],
  now: string
): DailyTotalAnomaly[] {
  const anomalies: DailyTotalAnomaly[] = [];
  const minDate = addDays(now, -DAILY_WINDOW_DAYS);

  // Group daily totals (only discretionary spend; exclude kind != 'spend' and source == 'schedule')
  // Note: one-offs still count in the day's total!
  const dailyTotals = new Map<string, number>();

  // Baseline totals: exclude one-offs from baselines
  const dailyBaselineTotals = new Map<string, number>();

  for (const exp of expenses) {
    if (exp.spentOn >= minDate && exp.spentOn <= now) {
      const isDiscretionary =
        (exp.kind ?? 'spend') === 'spend' &&
        (exp.source ?? 'manual') !== 'schedule';

      if (isDiscretionary) {
        // One-offs still count in daily totals
        dailyTotals.set(
          exp.spentOn,
          (dailyTotals.get(exp.spentOn) || 0) + exp.amountPaise
        );

        // But one-offs are excluded from baseline calculations
        if (!exp.oneOff) {
          dailyBaselineTotals.set(
            exp.spentOn,
            (dailyBaselineTotals.get(exp.spentOn) || 0) + exp.amountPaise
          );
        }
      }
    }
  }

  const allDates = Array.from(dailyTotals.keys()).sort();

  for (const dateStr of allDates) {
    const totalPaise = dailyTotals.get(dateStr) || 0;
    const weekday = getWeekdayName(dateStr);

    // Weekday baseline history in trailing 8 weeks EXCLUDING the day being evaluated
    const weekdayHistory: number[] = [];
    const allDaysHistory: number[] = [];

    for (const otherDate of allDates) {
      if (otherDate === dateStr) continue;

      const baselineVal = dailyBaselineTotals.get(otherDate) || 0;
      allDaysHistory.push(baselineVal);
      if (getWeekdayName(otherDate) === weekday) {
        weekdayHistory.push(baselineVal);
      }
    }

    let baseline: number[];
    let baselineType: 'weekday' | 'all_days';

    if (weekdayHistory.length >= MIN_WEEKDAY_POINTS) {
      baseline = weekdayHistory;
      baselineType = 'weekday';
    } else {
      baseline = allDaysHistory;
      baselineType = 'all_days';
    }

    if (baseline.length === 0) continue;

    const med = median(baseline);
    const mad = medianAbsoluteDeviation(baseline, med);
    const ratioToMedian = med > 0 ? Math.round((totalPaise / med) * 10) / 10 : 0;

    let isAnomaly = false;
    let score = 0;

    if (mad > 0) {
      score = Math.round(modifiedZScore(totalPaise, med, mad) * 100) / 100;
      isAnomaly = score > 3.5 && totalPaise > 1.5 * med;
    } else {
      isAnomaly = totalPaise > 3 * med;
      score = med > 0 ? Math.round(((totalPaise - med) / med) * 100) / 100 : 0;
    }

    if (isAnomaly) {
      const label = baselineType === 'weekday' ? `${weekday} spend` : 'daily spend';
      const reason = `${ratioToMedian}x your usual ${label}`;

      anomalies.push({
        date: dateStr,
        weekday,
        totalPaise,
        medianPaise: Math.round(med),
        score,
        ratioToMedian,
        baselineType,
        dataPointsUsed: baseline.length,
        reason,
      });
    }
  }

  return anomalies.sort((a, b) => b.date.localeCompare(a.date));
}
