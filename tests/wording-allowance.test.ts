import { describe, it, expect } from 'vitest';
import { calculateSafeToSpend } from '@/lib/engine/safetospend';
import { generateFallbackAdvice } from '@/lib/llm/fallback';
import type { EngineExpense, EngineSchedule, EngineOutput } from '@/lib/engine/types';

describe('A5. Wording: User-Facing Allowance & Review Strings', () => {
  const salarySchedule: EngineSchedule = {
    id: 'salary',
    name: 'Salary',
    kind: 'income',
    category: 'Income',
    amountPaise: 10000000, // ₹1,00,000 monthly
    frequency: 'monthly',
    anchorDate: '2026-10-01',
    startDate: '2026-01-01',
    active: true,
  };

  const rentSchedule: EngineSchedule = {
    id: 'rent',
    name: 'Rent',
    kind: 'bill',
    category: 'Housing',
    amountPaise: 2000000, // ₹20,000
    frequency: 'monthly',
    anchorDate: '2026-10-01',
    startDate: '2026-01-01',
    active: true,
  };

  // Scenario 1: Positive allowance
  it('Scenario 1: positive allowance produces clean readable strings without (over) or zero allowance', () => {
    const expenses: EngineExpense[] = [
      { id: 'exp-1', amountPaise: 1000000, category: 'Food', spentOn: '2026-10-05', kind: 'spend' },
    ];
    const s2s = calculateSafeToSpend(expenses, [salarySchedule, rentSchedule], '2026-10-15', 0.20);
    expect(s2s.insight).toBeDefined();
    expect(s2s.insight!.title).not.toContain('₹0.00 (over)');
    expect(s2s.insight!.title).not.toContain('allowance of ₹0.00');
    expect(s2s.insight!.title).toContain("Today's Safe-to-Spend:");

    const review = generateFallbackAdvice({
      allowance: s2s.allowance,
      insights: [s2s.insight!],
    } as unknown as EngineOutput);
    expect(review.verdict).not.toContain('₹0.00 (over)');
    expect(review.verdict).not.toContain('allowance of ₹0.00');
    expect(review.one_action_tomorrow).not.toContain('allowance of ₹0.00');
  });

  // Scenario 2: Zero allowance remaining on the last day
  it('Scenario 2: zero allowance remaining on the last day handles cleanly without "₹0.00 (over)"', () => {
    // Budget: Income (100k) - Rent (20k) - Savings (20k) = 60k
    // Spent exactly 60k on last day (2026-10-31)
    const expenses: EngineExpense[] = [
      { id: 'exp-1', amountPaise: 6000000, category: 'Shopping', spentOn: '2026-10-31', kind: 'spend' },
    ];
    const s2s = calculateSafeToSpend(expenses, [salarySchedule, rentSchedule], '2026-10-31', 0.20);
    expect(s2s.insight).toBeDefined();
    expect(s2s.insight!.title).not.toContain('₹0.00 (over)');
    expect(s2s.insight!.title).not.toContain('allowance of ₹0.00');

    const review = generateFallbackAdvice({
      allowance: s2s.allowance,
      insights: [s2s.insight!],
    } as unknown as EngineOutput);
    expect(review.verdict).not.toContain('₹0.00 (over)');
    expect(review.verdict).not.toContain('allowance of ₹0.00');
  });

  // Scenario 3: Negative remaining midway through the month
  it('Scenario 3: negative remaining midway through the month states discretionary budget is used up with ₹X over', () => {
    // Budget: 60k. Spent: 75k on Oct 15 -> 15k over
    const expenses: EngineExpense[] = [
      { id: 'exp-1', amountPaise: 7500000, category: 'Shopping', spentOn: '2026-10-15', kind: 'spend' },
    ];
    const s2s = calculateSafeToSpend(expenses, [salarySchedule, rentSchedule], '2026-10-15', 0.20);
    expect(s2s.insight).toBeDefined();
    expect(s2s.insight!.title).toContain("This month's discretionary budget is used up; you are ₹15,000.00 over");
    expect(s2s.insight!.title).not.toContain('₹0.00 (over)');
    expect(s2s.insight!.title).not.toContain('allowance of ₹0.00');

    const review = generateFallbackAdvice({
      allowance: s2s.allowance,
      insights: [s2s.insight!],
    } as unknown as EngineOutput);
    expect(review.verdict).toContain("This month's discretionary budget is used up; you are ₹15,000.00 over.");
    expect(review.verdict).not.toContain('allowance of ₹0.00');
    expect(review.one_action_tomorrow).toContain('recover the ₹15,000.00 discretionary deficit');
  });

  // Scenario 4: Negative remaining on day 1
  it('Scenario 4: negative remaining on day 1 states discretionary budget is used up with ₹X over', () => {
    // Budget: 60k. Spent: 80k on Oct 01 -> 20k over
    const expenses: EngineExpense[] = [
      { id: 'exp-1', amountPaise: 8000000, category: 'Shopping', spentOn: '2026-10-01', kind: 'spend' },
    ];
    const s2s = calculateSafeToSpend(expenses, [salarySchedule, rentSchedule], '2026-10-01', 0.20);
    expect(s2s.insight).toBeDefined();
    expect(s2s.insight!.title).toContain("This month's discretionary budget is used up; you are ₹20,000.00 over");
    expect(s2s.insight!.title).not.toContain('₹0.00 (over)');

    const review = generateFallbackAdvice({
      allowance: s2s.allowance,
      insights: [s2s.insight!],
    } as unknown as EngineOutput);
    expect(review.verdict).toContain("This month's discretionary budget is used up; you are ₹20,000.00 over.");
    expect(review.verdict).not.toContain('allowance of ₹0.00');
    expect(review.one_action_tomorrow).toContain('recover the ₹20,000.00 discretionary deficit');
  });
});
