import type { EngineExpense, RecurringItem } from './types';
import { median, daysDifference, addDays } from './math';

interface IntervalMatch {
  interval: 'weekly' | 'biweekly' | 'monthly';
  nominalDays: number;
}

/**
 * Normalises merchant or note string: lowercase and strip all non-letter characters (including digits and punctuation).
 */
export function normalizeMerchantKey(merchant?: string | null, note?: string | null): { key: string; label: string } | null {
  if (merchant && merchant.trim().length > 0) {
    const cleaned = merchant.toLowerCase().replace(/[^a-z]/g, '');
    if (cleaned.length >= 2) {
      return { key: cleaned, label: merchant.trim() };
    }
  }

  if (note && note.trim().length > 0) {
    const cleaned = note.toLowerCase().replace(/[^a-z]/g, '');
    if (cleaned.length >= 2) {
      return { key: cleaned, label: note.trim() };
    }
  }

  return null;
}

/**
 * Tests whether a sequence of consecutive day gaps matches one of:
 * - Weekly: 7 ± 1 days (6 to 8 days)
 * - Bi-weekly: 14 ± 2 days (12 to 16 days)
 * - Monthly: 30 ± 4 days (26 to 34 days)
 */
function classifyInterval(gaps: number[]): IntervalMatch | null {
  if (gaps.length === 0) return null;

  const isWeekly = gaps.every((g) => g >= 6 && g <= 8);
  if (isWeekly) {
    return { interval: 'weekly', nominalDays: 7 };
  }

  const isBiWeekly = gaps.every((g) => g >= 12 && g <= 16);
  if (isBiWeekly) {
    return { interval: 'biweekly', nominalDays: 14 };
  }

  const isMonthly = gaps.every((g) => g >= 26 && g <= 34);
  if (isMonthly) {
    return { interval: 'monthly', nominalDays: 30 };
  }

  return null;
}

/**
 * Detects recurring charges from expense transactions.
 */
export function detectRecurring(expenses: EngineExpense[]): RecurringItem[] {
  const groups = new Map<string, { label: string; items: EngineExpense[] }>();

  // 1. Group by normalised merchant or note
  for (const exp of expenses) {
    const normalized = normalizeMerchantKey(exp.merchant, exp.note);
    if (!normalized) continue;

    const existing = groups.get(normalized.key);
    if (existing) {
      existing.items.push(exp);
    } else {
      groups.set(normalized.key, { label: normalized.label, items: [exp] });
    }
  }

  const recurringItems: RecurringItem[] = [];

  for (const [key, group] of groups.entries()) {
    // Must have at least 3 occurrences
    if (group.items.length < 3) continue;

    // Sort chronologically ascending
    const sorted = [...group.items].sort((a, b) => a.spentOn.localeCompare(b.spentOn));

    // Check amount variance: all within ±10% of each other
    const amounts = sorted.map((e) => e.amountPaise);
    const medAmount = median(amounts);
    if (medAmount <= 0) continue;

    const amountsWithin10Percent = amounts.every(
      (amt) => Math.abs(amt - medAmount) / medAmount <= 0.10
    );
    if (!amountsWithin10Percent) continue;

    // Check intervals between consecutive dates
    const gaps: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = daysDifference(sorted[i + 1].spentOn, sorted[i].spentOn);
      gaps.push(gap);
    }

    const intervalMatch = classifyInterval(gaps);
    if (!intervalMatch) continue;

    const lastSpentOn = sorted[sorted.length - 1].spentOn;
    const nextExpectedDate = addDays(lastSpentOn, intervalMatch.nominalDays);

    let monthlyCostEstimatePaise = Math.round(medAmount);
    if (intervalMatch.interval === 'weekly') {
      monthlyCostEstimatePaise = Math.round((medAmount * 52) / 12);
    } else if (intervalMatch.interval === 'biweekly') {
      monthlyCostEstimatePaise = Math.round((medAmount * 26) / 12);
    }

    recurringItems.push({
      id: `rec-${key}`,
      key,
      merchantOrNote: group.label,
      category: sorted[sorted.length - 1].category,
      interval: intervalMatch.interval,
      intervalDays: intervalMatch.nominalDays,
      occurrenceCount: sorted.length,
      estimatedAmountPaise: Math.round(medAmount),
      monthlyCostEstimatePaise,
      lastSpentOn,
      nextExpectedDate,
    });
  }

  // Sort by highest monthly cost first
  return recurringItems.sort(
    (a, b) => b.monthlyCostEstimatePaise - a.monthlyCostEstimatePaise
  );
}
