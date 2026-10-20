import type { EngineSchedule, Insight } from './types';
import { getDaysInMonth } from './math';
import { formatPaiseToRupees } from '../money';

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
 * Generator 2.f: COMMITMENT_LOAD
 * - Committed as % of income
 * - Subscription total and its share
 * - Overlap when >= 3 subscriptions exist in Entertainment / Subscriptions: report totals only, NO JUDGEMENT.
 */
export function analyzeCommitmentLoad(
  schedules: EngineSchedule[],
  now: string
): Insight[] {
  const insights: Insight[] = [];
  const activeSchedules = schedules.filter((s) => s.active);

  if (activeSchedules.length === 0) {
    return insights;
  }

  const [yearStr, monthStr] = now.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = getDaysInMonth(year, month);

  // Income
  const incomeSchedules = activeSchedules.filter((s) => s.kind === 'income');
  let monthlyIncomePaise = 0;
  for (const s of incomeSchedules) {
    monthlyIncomePaise += getMonthlySchedulePaise(s, daysInMonth);
  }

  // Non-income commitments
  const committedSchedules = activeSchedules.filter((s) => s.kind !== 'income');
  let totalCommittedMonthlyPaise = 0;
  let totalSubscriptionsMonthlyPaise = 0;

  for (const s of committedSchedules) {
    const monthlyPaise = getMonthlySchedulePaise(s, daysInMonth);
    totalCommittedMonthlyPaise += monthlyPaise;
    if (s.kind === 'subscription' || s.category === 'Subscriptions') {
      totalSubscriptionsMonthlyPaise += monthlyPaise;
    }
  }

  const committedSharePercent =
    monthlyIncomePaise > 0
      ? Math.round((totalCommittedMonthlyPaise / monthlyIncomePaise) * 1000) / 10
      : null;

  const subscriptionsSharePercent =
    monthlyIncomePaise > 0
      ? Math.round((totalSubscriptionsMonthlyPaise / monthlyIncomePaise) * 1000) / 10
      : null;

  // Entertainment / OTT overlap
  const entertainmentSubs = activeSchedules.filter(
    (s) =>
      s.kind === 'subscription' ||
      s.category === 'Entertainment' ||
      s.category === 'Subscriptions'
  );

  if (entertainmentSubs.length >= 3) {
    let entTotalPaise = 0;
    const names: string[] = [];
    for (const sub of entertainmentSubs) {
      entTotalPaise += getMonthlySchedulePaise(sub, daysInMonth);
      names.push(sub.name);
    }

    insights.push({
      id: `commitment_load:entertainment_overlap:${yearStr}-${monthStr}`,
      type: 'commitment_load',
      title: `${entertainmentSubs.length} active subscription services (${formatPaiseToRupees(entTotalPaise)}/mo)`,
      impactPaise: entTotalPaise,
      confidence: 1.0,
      actionable: false,
      firstSeen: now,
      severity: 'info',

      levers: [],
      evidence: {
        count: entertainmentSubs.length,
        totalMonthlyPaise: entTotalPaise,
        names: names.join(', '),
        committedShareOfIncomePercent: committedSharePercent,
        subscriptionsShareOfIncomePercent: subscriptionsSharePercent,
      },
    });
  }

  return insights;
}
