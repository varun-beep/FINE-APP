import type { EngineExpense, Insight } from './types';
import { addDays, median } from './math';
import { formatPaiseToRupees } from '../money';

/**
 * Generator 2.e: SMALL_LEAKS
 * Detects frequent low-ticket micro-spends:
 * - Merchants or categories with >= 8 purchases in 30 days and a median under ₹300 (30,000 paise).
 * - Reports count, monthly total, and annualised total.
 * - Surfaces only if monthly total >= 3% of total discretionary spend.
 */
export function detectSmallLeaks(
  expenses: EngineExpense[],
  now: string,
  options?: { outlierExpenseIds?: Set<string> }
): Insight[] {
  const insights: Insight[] = [];
  const thirtyDaysAgo = addDays(now, -30);
  const outlierIds = options?.outlierExpenseIds;

  // Filter discretionary expenses in the last 30 days
  const recentExpenses = expenses.filter(
    (e) =>
      e.spentOn >= thirtyDaysAgo &&
      e.spentOn <= now &&
      (e.kind === 'spend' || !e.kind) &&
      e.source !== 'schedule' &&
      !e.scheduleId &&
      !e.oneOff &&
      (!outlierIds || !outlierIds.has(e.id))
  );

  if (recentExpenses.length === 0) {
    return insights;
  }

  // Total discretionary spend in 30 days
  const totalDiscretionary30d = recentExpenses.reduce(
    (acc, e) => acc + e.amountPaise,
    0
  );

  if (totalDiscretionary30d <= 0) {
    return insights;
  }

  // Group by merchant (or category if no merchant)
  const groups = new Map<string, EngineExpense[]>();
  for (const exp of recentExpenses) {
    const key = exp.merchant ? exp.merchant.trim() : exp.category;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(exp);
  }

  const [yearStr, monthStr] = now.split('-');

  for (const [key, items] of groups.entries()) {
    // Check >= 8 purchases in 30 days
    if (items.length < 8) {
      continue;
    }

    const amounts = items.map((e) => e.amountPaise);
    const med = median(amounts);

    // Median must be under ₹300 (30,000 paise)
    if (med >= 30000) {
      continue;
    }

    const count = items.length;
    const monthlyTotalPaise = amounts.reduce((acc, a) => acc + a, 0);
    const annualisedTotalPaise = monthlyTotalPaise * 12;

    // Must be >= 3% of total discretionary spend
    const shareOfDiscretionary = monthlyTotalPaise / totalDiscretionary30d;
    if (shareOfDiscretionary < 0.03) {
      continue;
    }

    const sharePercent = Math.round(shareOfDiscretionary * 1000) / 10;
    const halvedSavingsMonthly = Math.round(monthlyTotalPaise / 2);

    insights.push({
      id: `small_leaks:${key}:${yearStr}-${monthStr}`,
      type: 'small_leaks',
      title: `Frequent micro-spend: ${count} transactions at ${key} (${formatPaiseToRupees(monthlyTotalPaise)}/mo)`,
      impactPaise: monthlyTotalPaise,
      confidence: 0.9,
      actionable: true,
      firstSeen: now,
      severity: annualisedTotalPaise >= 2500000 ? 'warning' : 'info',
      levers: [
        {
          id: `halve_leak_${key.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          description: `Halve visits to ${key} (saves ~${formatPaiseToRupees(halvedSavingsMonthly)}/mo, ${formatPaiseToRupees(halvedSavingsMonthly * 12)}/yr)`,
          monthlySavingPaise: halvedSavingsMonthly,
        },
      ],

      evidence: {
        target: key,
        count,
        medianPaise: med,
        monthlyTotalPaise,
        annualisedTotalPaise,
        totalDiscretionary30dPaise: totalDiscretionary30d,
        shareOfDiscretionaryPercent: sharePercent,
      },
    });
  }

  return insights;
}
