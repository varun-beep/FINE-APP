import type { EngineExpense, EngineSchedule, Insight } from './types';
import { addDays } from './math';
import { formatPaiseToRupees } from '../money';


/**
 * Generator 2.d: BEHAVIOUR
 * Analyzes spending patterns:
 * 1. Payday effect: spend in the 5 days after income day vs the rest of the month.
 * 2. Weekday vs Weekend spend ratio.
 * 3. Merchant concentration within categories.
 */
export function analyzeBehaviour(
  expenses: EngineExpense[],
  schedules: EngineSchedule[] = [],
  now: string,
  options?: { outlierExpenseIds?: Set<string> }
): Insight[] {
  const insights: Insight[] = [];
  const ninetyDaysAgo = addDays(now, -90);
  const outlierIds = options?.outlierExpenseIds;

  const eligibleExpenses = expenses.filter(
    (e) =>
      e.spentOn >= ninetyDaysAgo &&
      e.spentOn <= now &&
      (e.kind === 'spend' || !e.kind) &&
      e.source !== 'schedule' &&
      !e.scheduleId &&
      !e.oneOff &&
      (!outlierIds || !outlierIds.has(e.id))
  );

  if (eligibleExpenses.length < 15) {
    return insights;
  }

  const [yearStr, monthStr] = now.split('-');

  // 1. Payday Effect
  // Determine income day of month (default to 1st if unknown)
  let incomeDayOfMonth = 1;
  const incomeSchedule = schedules.find((s) => s.kind === 'income' && s.active);
  if (incomeSchedule) {
    const [, , dStr] = incomeSchedule.anchorDate.split('-');
    incomeDayOfMonth = parseInt(dStr, 10);
  } else {
    const incomeExpense = expenses.find((e) => e.kind === 'income');
    if (incomeExpense) {
      const [, , dStr] = incomeExpense.spentOn.split('-');
      incomeDayOfMonth = parseInt(dStr, 10);
    }
  }

  // Group days into Payday window (5 days: day to day+4) vs Rest of month
  let paydaySpendTotal = 0;
  let paydayDaysCount = 0;
  let restSpendTotal = 0;
  let restDaysCount = 0;

  // Track unique calendar days
  const dayTotals = new Map<string, number>();
  for (const exp of eligibleExpenses) {
    dayTotals.set(exp.spentOn, (dayTotals.get(exp.spentOn) || 0) + exp.amountPaise);
  }

  for (const [dayStr, totalPaise] of dayTotals.entries()) {
    const [, , d] = dayStr.split('-').map(Number);
    // Is within [incomeDayOfMonth, incomeDayOfMonth + 4] (handling month boundaries)
    const diff = (d - incomeDayOfMonth + 31) % 31;
    if (diff >= 0 && diff < 5) {
      paydaySpendTotal += totalPaise;
      paydayDaysCount++;
    } else {
      restSpendTotal += totalPaise;
      restDaysCount++;
    }
  }

  if (paydayDaysCount >= 3 && restDaysCount >= 10) {
    const paydayDailyAvg = paydaySpendTotal / paydayDaysCount;
    const restDailyAvg = restSpendTotal / restDaysCount;

    if (restDailyAvg > 0 && paydayDailyAvg >= 1.5 * restDailyAvg) {
      const surgeMultiplier = Math.round((paydayDailyAvg / restDailyAvg) * 10) / 10;
      const excessInWindowPaise = Math.round((paydayDailyAvg - restDailyAvg) * 5);

      if (excessInWindowPaise >= 100000) {
        // >= ₹1,000 excess
        insights.push({
          id: `behaviour:payday_surge:${yearStr}-${monthStr}`,
          type: 'behaviour',
          title: `Payday Surge: ${surgeMultiplier}x higher spend in the 5 days after salary`,
          impactPaise: excessInWindowPaise,
          confidence: Math.min(1.0, 0.75 + (paydayDaysCount / 20)),
          actionable: true,
          firstSeen: now,
          severity: surgeMultiplier >= 2.0 ? 'warning' : 'info',
          levers: [
            {
              id: 'pace_payday_window',
              description: `Pace discretionary spend during post-salary week (potential saving ~${formatPaiseToRupees(excessInWindowPaise)}/mo)`,
              monthlySavingPaise: excessInWindowPaise,
            },
          ],
          evidence: {
            incomeDayOfMonth,
            paydayDailyAvgPaise: Math.round(paydayDailyAvg),
            restDailyAvgPaise: Math.round(restDailyAvg),
            surgeMultiplier,
            excessInWindowPaise,
            paydayDaysCount,
            restDaysCount,
          },
        });
      }
    }
  }

  // 2. Weekday vs Weekend spend
  let weekendTotal = 0;
  let weekendDays = 0;
  let weekdayTotal = 0;
  let weekdayDays = 0;

  for (const [dayStr, totalPaise] of dayTotals.entries()) {
    const [y, m, d] = dayStr.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 0 || dow === 6) {
      weekendTotal += totalPaise;
      weekendDays++;
    } else {
      weekdayTotal += totalPaise;
      weekdayDays++;
    }
  }

  if (weekendDays >= 4 && weekdayDays >= 10) {
    const weekendDailyAvg = weekendTotal / weekendDays;
    const weekdayDailyAvg = weekdayTotal / weekdayDays;

    if (weekdayDailyAvg > 0 && weekendDailyAvg >= 1.8 * weekdayDailyAvg) {
      const ratio = Math.round((weekendDailyAvg / weekdayDailyAvg) * 10) / 10;
      const monthlyWeekendExcessPaise = Math.round((weekendDailyAvg - weekdayDailyAvg) * 8);

      if (monthlyWeekendExcessPaise >= 150000) {
        insights.push({
          id: `behaviour:weekend_surge:${yearStr}-${monthStr}`,
          type: 'behaviour',
          title: `Weekend Spending: ${ratio}x higher than weekdays (+${formatPaiseToRupees(monthlyWeekendExcessPaise)}/mo)`,
          impactPaise: monthlyWeekendExcessPaise,
          confidence: 0.85,
          actionable: true,
          firstSeen: now,
          severity: 'info',

          levers: [
            {
              id: 'cap_weekend_spend',
              description: 'Set a weekend leisure allowance to reduce spikes',
              monthlySavingPaise: Math.round(monthlyWeekendExcessPaise * 0.4),
            },
          ],
          evidence: {
            weekendDailyAvgPaise: Math.round(weekendDailyAvg),
            weekdayDailyAvgPaise: Math.round(weekdayDailyAvg),
            ratio,
            monthlyWeekendExcessPaise,
            weekendDays,
            weekdayDays,
          },
        });
      }
    }
  }

  // 3. Merchant Concentration within Category
  const totalDiscretionarySpend = eligibleExpenses.reduce((sum, e) => sum + e.amountPaise, 0);

  const byCategory: Record<string, EngineExpense[]> = {};
  for (const exp of eligibleExpenses) {
    if (!byCategory[exp.category]) {
      byCategory[exp.category] = [];
    }
    byCategory[exp.category].push(exp);
  }

  for (const [category, catExpenses] of Object.entries(byCategory)) {
    // Threshold 1: At least 10 transactions in this category
    if (catExpenses.length < 10) continue;

    const merchantTotals = new Map<string, number>();
    let catTotal = 0;

    for (const exp of catExpenses) {
      if (exp.merchant) {
        const m = exp.merchant.trim();
        merchantTotals.set(m, (merchantTotals.get(m) || 0) + exp.amountPaise);
      }
      catTotal += exp.amountPaise;
    }

    if (catTotal <= 0) continue;

    // Threshold 2: Category must have at least 3 distinct merchants
    if (merchantTotals.size < 3) continue;

    // Threshold 3: Category must account for at least 5% of discretionary spend
    if (totalDiscretionarySpend > 0 && catTotal < 0.05 * totalDiscretionarySpend) continue;

    let topMerchant = '';
    let topSpend = 0;
    for (const [m, spend] of merchantTotals.entries()) {
      if (spend > topSpend) {
        topSpend = spend;
        topMerchant = m;
      }
    }

    const share = topSpend / catTotal;
    if (share >= 0.65 && topSpend >= 100000) {
      const sharePct = Math.round(share * 100);
      insights.push({
        id: `behaviour:concentration:${category}:${topMerchant}`,
        type: 'behaviour',
        title: `${topMerchant} accounts for ${sharePct}% of your ${category} spend`,
        impactPaise: Math.round(topSpend * 0.15),
        confidence: 0.9,
        actionable: false,
        firstSeen: now,
        severity: 'info',
        levers: [],
        evidence: {
          category,
          topMerchant,
          topMerchantSpendPaise: topSpend,
          categoryTotalSpendPaise: catTotal,
          sharePercent: sharePct,
        },
      });
    }
  }

  return insights;
}
