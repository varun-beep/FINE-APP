import type { EngineExpense, EngineSchedule, Insight } from './types';
import { getDaysInMonth } from './math';


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
 * Generator 2.g: SAVINGS
 * - savings rate = (income − discretionary − non-investment commitments) / income
 * - investment total this month
 * - cumulative gold invested since schedule start
 * - projected month-end savings vs target
 */
export function analyzeSavings(
  expenses: EngineExpense[],
  schedules: EngineSchedule[],
  now: string,
  targetRate = 0.20
): Insight[] {
  const insights: Insight[] = [];
  const [yearStr, monthStr] = now.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = getDaysInMonth(year, month);
  const monthPrefix = `${yearStr}-${monthStr}`;

  // 1. Income
  const activeIncomeSchedules = schedules.filter((s) => s.kind === 'income' && s.active);
  let monthlyIncomePaise = 0;
  for (const s of activeIncomeSchedules) {
    monthlyIncomePaise += getMonthlySchedulePaise(s, daysInMonth);
  }

  if (monthlyIncomePaise <= 0) {
    return insights;
  }

  // 2. Non-investment commitments (subscriptions, bills, emi)
  const nonInvestmentSchedules = schedules.filter(
    (s) => s.active && s.kind !== 'income' && s.kind !== 'investment'
  );
  let nonInvestmentCommitmentsPaise = 0;
  for (const s of nonInvestmentSchedules) {
    nonInvestmentCommitmentsPaise += getMonthlySchedulePaise(s, daysInMonth);
  }

  // 3. Investment commitments (e.g. daily gold)
  const investmentSchedules = schedules.filter(
    (s) => s.active && s.kind === 'investment'
  );
  let investmentCommitmentsPaise = 0;
  for (const s of investmentSchedules) {
    investmentCommitmentsPaise += getMonthlySchedulePaise(s, daysInMonth);
  }

  // 4. Actual discretionary spend this month up to now
  const thisMonthExpenses = expenses.filter(
    (e) => e.spentOn.startsWith(monthPrefix) && e.spentOn <= now
  );

  let discretionarySpentSoFarPaise = 0;
  let investmentSpentThisMonthPaise = 0;

  for (const e of thisMonthExpenses) {
    if (e.kind === 'investment' || e.category === 'Investment') {
      investmentSpentThisMonthPaise += e.amountPaise;
    } else if ((e.kind === 'spend' || !e.kind) && e.source !== 'schedule') {
      discretionarySpentSoFarPaise += e.amountPaise;
    }
  }

  // 5. Cumulative gold invested
  let cumulativeGoldPaise = 0;
  for (const e of expenses) {
    const isGold =
      (e.merchant && e.merchant.toLowerCase().includes('gold')) ||
      (e.note && e.note.toLowerCase().includes('gold')) ||
      e.category === 'Investment';
    if (isGold) {
      cumulativeGoldPaise += e.amountPaise;
    }
  }

  // Savings rate calculation
  const netSavingsSoFarPaise =
    monthlyIncomePaise - discretionarySpentSoFarPaise - nonInvestmentCommitmentsPaise;
  const savingsRate = netSavingsSoFarPaise / monthlyIncomePaise;
  const savingsRatePercent = Math.round(savingsRate * 1000) / 10;
  const targetSavingsPaise = Math.round(monthlyIncomePaise * targetRate);

  const totalInvestmentMonthPaise = Math.max(
    investmentSpentThisMonthPaise,
    investmentCommitmentsPaise
  );

  insights.push({
    id: `savings:${yearStr}-${monthStr}`,
    type: 'savings',
    title: `Monthly Savings: ${savingsRatePercent}% of income (Target: ${Math.round(targetRate * 100)}%)`,
    impactPaise: Math.abs(netSavingsSoFarPaise - targetSavingsPaise),
    confidence: 0.95,
    actionable: false,
    firstSeen: now,
    severity: savingsRate < targetRate ? 'warning' : 'info',
    levers: [],
    evidence: {
      monthlyIncomePaise,
      discretionarySpentSoFarPaise,
      nonInvestmentCommitmentsPaise,
      investmentCommitmentsPaise,
      totalInvestmentMonthPaise,
      cumulativeGoldPaise,
      netSavingsSoFarPaise,
      targetSavingsPaise,
      savingsRatePercent,
      targetRatePercent: Math.round(targetRate * 100),
    },
  });

  return insights;
}
