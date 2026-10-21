import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDailyReview, computeDailyReviewInputHash } from '@/lib/llm/service';
import type { EngineOutput } from '@/lib/engine/types';

// Mock DB and engine output
const mockReviewsTable: Record<string, any> = {};
let mockEngineOutput: EngineOutput;

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const entry = mockReviewsTable['daily:2026-10-20'];
            return entry ? [entry] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (val: any) => ({
        onConflictDoUpdate: async () => {
          mockReviewsTable['daily:2026-10-20'] = val;
          return [val];
        },
      }),
    }),
  },
}));

vi.mock('@/lib/engine/db', () => ({
  getLatestEngineOutput: async () => mockEngineOutput,
}));

describe('Review Timing, Caching and Staleness (Item 3)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    delete mockReviewsTable['daily:2026-10-20'];
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Offline unit test'));

    mockEngineOutput = {
      evaluatedAt: '2026-10-20',
      learning: {
        status: 'ready',
        expenseCount: 45,
        expenseThreshold: 30,
        distinctDaysCount: 22,
        distinctDaysThreshold: 14,
        expensesNeeded: 0,
        daysNeeded: 0,
        categories: {},
      },
      coverage: {
        daysClosed: 15,
        weeksOfHistory: 8,
        categoriesReady: ['Food', 'Dining'],
        categoriesLearning: [],
        reasons: [],
      },
      allowance: {
        dailyAllowancePaise: 150000,
        weekdayAwareAllowancePaise: 150000,
        todaySpentPaise: 100000,
        verdict: 'under',
        tomorrowDailyAllowancePaise: 160000,
        tomorrowWeekdayAllowancePaise: 160000,
        monthlyIncomePaise: 6000000,
        committedDuePaise: 1500000,
        savingsTargetPaise: 1200000,
        discretionarySpentSoFarPaise: 2000000,
        remainingDiscretionaryPaise: 1300000,
        daysLeftInMonth: 11,
      },
      budgetRunRate: {
        spentSoFarPaise: 2000000,
        monthlyLimitPaise: 3500000,
        projectedMonthEndPaise: 3100000,
        percentageUsed: 57,
        projectedPercentage: 88,
        budgetStatus: 'on_track',
        categories: [],
      },
      trends: {
        last7DaysPaise: 700000,
        prev7DaysPaise: 750000,
        weekOverWeekPercent: -6,
        currentMonthToDatePaise: 2000000,
        prevMonthToDatePaise: 2100000,
        monthOverMonthPercent: -4,
        categories: [],
      },
      transactionAnomalies: [],
      dailyAnomalies: [],
      recurring: [],
      insights: [],
    };
  });

  it('1. same-hash cache hit: serves cached review without regenerating or incrementing limit', async () => {
    // 1. Initial generation (cached with hash)
    const initial = await generateDailyReview('2026-10-20', { regenerate: false });
    expect(initial.source).toBe('fallback');
    expect(initial.regenerationCount).toBe(0);
    expect(initial.canRegenerate).toBe(true);
    expect(initial.inputHash).toBeDefined();

    const initialStored = mockReviewsTable['daily:2026-10-20'];
    expect(initialStored).toBeDefined();
    expect(initialStored.adviceJson._meta.inputHash).toBe(initial.inputHash);

    // 2. Second open without changing expenses/closures: same-hash cache hit
    const second = await generateDailyReview('2026-10-20', { regenerate: false });
    expect(second.regenerationCount).toBe(0); // Did not consume limit
    expect(second.inputHash).toBe(initial.inputHash);
    expect(second.advice.verdict).toBe(initial.advice.verdict);
  });

  it('2. stale-cache regeneration: changes in expenses trigger automatic regeneration without consuming manual limit', async () => {
    // 1. Initial generation
    const initial = await generateDailyReview('2026-10-20', { regenerate: false });
    const initialHash = initial.inputHash;
    expect(initial.regenerationCount).toBe(0);

    // 2. An expense is logged: today's spend increases from ₹1,000 to ₹3,500
    mockEngineOutput.allowance = {
      ...mockEngineOutput.allowance!,
      todaySpentPaise: 350000,
      verdict: 'over',
    };
    mockEngineOutput.budgetRunRate = {
      ...mockEngineOutput.budgetRunRate,
      spentSoFarPaise: 2250000,
    };

    const newHash = computeDailyReviewInputHash(mockEngineOutput, '2026-10-20');
    expect(newHash).not.toBe(initialHash); // Hash changed!

    // 3. User re-opens /review (fetch with regenerate: false)
    const refreshed = await generateDailyReview('2026-10-20', { regenerate: false });

    // Must have regenerated to reflect updated data
    expect(refreshed.inputHash).toBe(newHash);
    expect(refreshed.inputHash).not.toBe(initialHash);

    // CRITICAL REQUIREMENT: Automatic stale-cache refresh MUST NOT consume the 5/day limit!
    expect(refreshed.regenerationCount).toBe(0);
    expect(refreshed.canRegenerate).toBe(true);
  });

  it('3. stale-cache regeneration: changes in day closures trigger automatic regeneration', async () => {
    // 1. Initial generation with 15 days closed
    const initial = await generateDailyReview('2026-10-20', { regenerate: false });
    const initialHash = initial.inputHash;

    // 2. User marks "Done for today", closing day 16
    mockEngineOutput.coverage = {
      ...mockEngineOutput.coverage!,
      daysClosed: 16,
    };

    const newHash = computeDailyReviewInputHash(mockEngineOutput, '2026-10-20');
    expect(newHash).not.toBe(initialHash);

    // 3. Re-open review: auto regenerates with new hash and count still 0
    const refreshed = await generateDailyReview('2026-10-20', { regenerate: false });
    expect(refreshed.inputHash).toBe(newHash);
    expect(refreshed.regenerationCount).toBe(0);
  });

  it('4. manual regenerate: consumes 1 count per manual call and enforces 5/day cap', async () => {
    // 1. Initial generation
    await generateDailyReview('2026-10-20', { regenerate: false });

    // 2. 5 manual regenerations
    for (let i = 1; i <= 4; i++) {
      const res = await generateDailyReview('2026-10-20', { regenerate: true });
      expect(res.regenerationCount).toBe(i);
      expect(res.canRegenerate).toBe(true);
    }

    // 5th manual regeneration
    const fifth = await generateDailyReview('2026-10-20', { regenerate: true });
    expect(fifth.regenerationCount).toBe(5);
    expect(fifth.canRegenerate).toBe(false);

    // 6th manual attempt: rejected/capped, returns cached without incrementing
    const sixth = await generateDailyReview('2026-10-20', { regenerate: true });
    expect(sixth.regenerationCount).toBe(5);
    expect(sixth.canRegenerate).toBe(false);
  });
});
