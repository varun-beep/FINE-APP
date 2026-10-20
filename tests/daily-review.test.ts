import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildDailyReviewSummaryPayload } from '@/lib/llm/privacy';
import { validateNumberGuardrail, extractNumbersFromText } from '@/lib/llm/guardrail';
import { generateFallbackAdvice, generateLearningAdvice } from '@/lib/llm/fallback';
import { generateDailyReview } from '@/lib/llm/service';
import { dailyReviewAdviceSchema, type DailyReviewAdvice } from '@/lib/llm/types';
import type { EngineOutput } from '@/lib/engine/types';

// Mock DB and engine loader for service integration tests
const mockReviewsTable: Record<string, any> = {};

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const entry = mockReviewsTable['test-key'];
            return entry ? [entry] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (val: any) => ({
        onConflictDoUpdate: async () => {
          mockReviewsTable['test-key'] = val;
          return [val];
        },
      }),
    }),
  },
}));

let mockEngineOutput: EngineOutput;

vi.mock('@/lib/engine/db', () => ({
  getLatestEngineOutput: async () => mockEngineOutput,
}));

describe('SpendCoach AI Daily Review', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockReviewsTable)) {
      delete mockReviewsTable[key];
    }

    // Default "ready" engine output
    mockEngineOutput = {
      learning: {
        status: 'ready',
        expenseCount: 50,
        expenseThreshold: 30,
        distinctDaysCount: 20,
        distinctDaysThreshold: 14,
        expensesNeeded: 0,
        daysNeeded: 0,
        categories: {},
      },
      transactionAnomalies: [
        {
          expenseId: 'exp-1',
          amountPaise: 485000, // ₹4,850
          medianPaise: 25000,  // ₹250
          madPaise: 2000,
          score: 155.14,
          ratioToMedian: 19.4,
          category: 'Food',
          merchant: 'The Leela Palace',
          note: 'CONFIDENTIAL_NOTE_ANNIVERSARY_SECRET_123',
          spentOn: '2026-10-14',
          baselineType: 'category',
          reason: '19.4x your usual Food spend',
        },
      ],
      dailyAnomalies: [],
      recurring: [
        {
          id: 'rec-1',
          key: 'netflix',
          category: 'Entertainment',
          merchantOrNote: 'Netflix Long Descriptive Subscription Name Beyond Thirty Characters Limit',
          interval: 'monthly',
          intervalDays: 30,
          occurrenceCount: 3,
          estimatedAmountPaise: 64900, // ₹649
          monthlyCostEstimatePaise: 64900,
          lastSpentOn: '2026-10-20',
          nextExpectedDate: '2026-11-19',
        },
      ],
      budgetRunRate: {
        spentSoFarPaise: 683000, // ₹6,830
        projectedMonthEndPaise: 1058650, // ₹10,586.50
        monthlyLimitPaise: 1500000, // ₹15,000
        budgetStatus: 'on_track',
        percentageUsed: 46,
        projectedPercentage: 71,
        categories: [
          {
            category: 'Food',
            spentSoFarPaise: 683000,
            projectedMonthEndPaise: 1058650,
            monthlyLimitPaise: 1500000,
            budgetStatus: 'on_track',
            percentageUsed: 46,
            projectedPercentage: 71,
          },
        ],
      },
      trends: {
        last7DaysPaise: 500000,
        prev7DaysPaise: 400000,
        weekOverWeekPercent: 25,
        currentMonthToDatePaise: 683000,
        prevMonthToDatePaise: 600000,
        monthOverMonthPercent: 14,
        categories: [
          {
            category: 'Food',
            last7DaysPaise: 500000,
            prev7DaysPaise: 400000,
            weekOverWeekPercent: 25,
            currentMonthToDatePaise: 683000,
            prevMonthToDatePaise: 600000,
            monthOverMonthPercent: 14,
          },
        ],
      },
      evaluatedAt: '2026-10-20',
    };

    process.env.GROQ_API_KEY = 'gsk_mock_test_key';
    process.env.LLM_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.LLM_MODEL = 'llama-3.3-70b-versatile';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Privacy & Payload Builder', () => {
    it('STRICT PRIVACY: never includes transaction notes in the generated payload', () => {
      const { payload } = buildDailyReviewSummaryPayload(mockEngineOutput, '2026-10-20');
      const serialized = JSON.stringify(payload);

      // Verify the private secret note is not present anywhere in the payload
      expect(serialized).not.toContain('CONFIDENTIAL_NOTE_ANNIVERSARY_SECRET_123');
      expect(serialized).not.toContain('note');
    });

    it('STRICT PRIVACY: never includes exact timestamps or raw transaction lists', () => {
      const { payload } = buildDailyReviewSummaryPayload(mockEngineOutput, '2026-10-20');
      const serialized = JSON.stringify(payload);

      expect(serialized).not.toContain('T14:22:00Z');
      expect(serialized).not.toContain('rawTransactions');
      expect(serialized).not.toContain('expenses');
    });

    it('STRICT PRIVACY: truncates recurring merchant names to maximum 30 characters', () => {
      const { payload } = buildDailyReviewSummaryPayload(mockEngineOutput, '2026-10-20');
      expect(payload.recurringCharges[0].merchant.length).toBeLessThanOrEqual(30);
      expect(payload.recurringCharges[0].merchant).toBe(
        'Netflix Long Descriptive Subsc'.slice(0, 30)
      );
    });

    it('extracts allowed numbers list from summary figures for the number guardrail', () => {
      const { allowedNumbers } = buildDailyReviewSummaryPayload(mockEngineOutput, '2026-10-20');
      expect(allowedNumbers).toContain(4850); // ₹4,850
      expect(allowedNumbers).toContain(649);  // ₹649
      expect(allowedNumbers).toContain(6830); // ₹6,830
      expect(allowedNumbers).toContain(46);   // 46%
    });
  });

  describe('2. Number Guardrail', () => {
    const allowed = [4850, 250, 19.4, 649, 6830, 15000, 46, 71, 30, 20];

    it('accepts advice using exact and simple rounded numbers from the summary', () => {
      const validAdvice: DailyReviewAdvice = {
        headline: 'Food spending spiked today with a 19.4x jump to ₹4,850',
        went_well: ['Routine monthly subscriptions like ₹649 were kept regular'],
        watch_out: ['Food spend reached ₹4,850 against median ₹250'],
        action_tomorrow: 'Avoid dining out tomorrow and prepare lunch at home',
        saving_ideas: ['Review your ₹649 monthly recurring charges'],
        earning_ideas: ['Sell unused electronics'],
        mood: 'careful',
      };

      const res = validateNumberGuardrail(validAdvice, allowed);
      expect(res.valid).toBe(true);
      expect(res.unsupportedNumbers).toHaveLength(0);
    });

    it('accepts simple rounded representations (e.g. ₹4,900 for ₹4,850)', () => {
      const roundedAdvice: DailyReviewAdvice = {
        headline: 'Food spend of ₹4,900 is higher than usual',
        went_well: ['Logged all purchases on time'],
        watch_out: ['Recent dinner cost ~₹4,900'],
        action_tomorrow: 'Keep discretionary spend to ₹0 tomorrow',
        saving_ideas: ['Save by cooking at home'],
        earning_ideas: [],
        mood: 'careful',
      };

      const res = validateNumberGuardrail(roundedAdvice, allowed);
      expect(res.valid).toBe(true);
    });

    it('rejects advice with invented ungrounded numbers (e.g. ₹75,000 or 17% interest)', () => {
      const inventedAdvice: DailyReviewAdvice = {
        headline: 'You should invest ₹75,000 into a mutual fund',
        went_well: ['Kept tracking everyday'],
        watch_out: ['High interest of 17% on cards'],
        action_tomorrow: 'Pay down your credit card',
        saving_ideas: ['Put ₹8,200 into high yield savings'],
        earning_ideas: [],
        mood: 'careful',
      };

      const res = validateNumberGuardrail(inventedAdvice, allowed);
      expect(res.valid).toBe(false);
      expect(res.unsupportedNumbers).toContain(75000);
      expect(res.unsupportedNumbers).toContain(17);
      expect(res.unsupportedNumbers).toContain(8200);
    });

    it('accepts legitimate derivations such as thousands (k), lakhs (L), and percent rounding', () => {
      // In allowed list: 4850, 79900, 19.4, 46
      const allowedWithLarge = [4850, 79900, 250, 19.4, 46, 649];
      const derivedAdvice: DailyReviewAdvice = {
        headline: 'iPad Pro purchase of ₹79.9k (around 0.8 lakh) flagged as spike',
        went_well: ['Routine ₹0.6k streaming charge on track'],
        watch_out: ['Dinner was around 4.9k (19x usual)'],
        action_tomorrow: 'Keep spend low tomorrow',
        saving_ideas: ['Save by cooking meals at home'],
        earning_ideas: [],
        mood: 'careful',
      };

      const res = validateNumberGuardrail(derivedAdvice, allowedWithLarge);
      expect(res.valid).toBe(true);
    });

    it('extracts numbers accurately from Indian formatted strings (e.g. ₹1,23,456.50)', () => {
      const numbers = extractNumbersFromText('Spent ₹1,23,456.50 on shopping and ₹4,850 on dinner');
      expect(numbers).toContain(123456.5);
      expect(numbers).toContain(4850);
    });
  });

  describe('3. Fallback and Learning Advice Generators', () => {
    it('generates deterministic fallback advice satisfying the Zod schema', () => {
      const fallback = generateFallbackAdvice(mockEngineOutput);
      const parseResult = dailyReviewAdviceSchema.safeParse(fallback);
      expect(parseResult.success).toBe(true);
      expect(fallback.mood).toBe('careful'); // Due to planted anomaly
      expect(fallback.headline).toContain('Unusual spend flagged');
      expect(fallback.watch_out.length).toBeGreaterThan(0);
    });

    it('generates friendly learning advice when baseline status is learning', () => {
      const learningOutput: EngineOutput = {
        ...mockEngineOutput,
        learning: {
          status: 'learning',
          expenseCount: 12,
          expenseThreshold: 30,
          distinctDaysCount: 6,
          distinctDaysThreshold: 14,
          expensesNeeded: 18,
          daysNeeded: 8,
          categories: {},
        },
      };

      const learningAdvice = generateLearningAdvice(learningOutput);
      const parseResult = dailyReviewAdviceSchema.safeParse(learningAdvice);
      expect(parseResult.success).toBe(true);
      expect(learningAdvice.mood).toBe('ok');
      expect(learningAdvice.headline).toContain('12/30');
      expect(learningAdvice.action_tomorrow).toContain('18 more entries');
    });
  });

  describe('4. LLM Service Workflow & Resilience', () => {
    it('SKIPS LLM completely when learning status is "learning"', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      mockEngineOutput.learning.status = 'learning';
      mockEngineOutput.learning.expensesNeeded = 15;
      mockEngineOutput.learning.daysNeeded = 7;

      const result = await generateDailyReview('2026-10-20');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.isLearning).toBe(true);
      expect(result.source).toBe('fallback');
      expect(result.learningProgress?.expensesNeeded).toBe(15);
      expect(result.advice.headline).toContain('learning');
    });

    it('accepts valid LLM output on the first try', async () => {
      const validLlmResponse = {
        headline: 'Food spending jumped to ₹4,850 today, exceeding typical limits',
        went_well: ['Routine monthly costs like ₹649 remained stable'],
        watch_out: ['Food spend of ₹4,850 was 19.4x higher than normal'],
        action_tomorrow: 'Stick to home-cooked meals tomorrow to reset pace',
        saving_ideas: ['Review your ₹649 recurring subscription'],
        earning_ideas: ['Sell unused items online'],
        mood: 'careful',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(validLlmResponse) } }],
        }),
      });

      const result = await generateDailyReview('2026-10-20', { regenerate: true });

      expect(result.source).toBe('llm');
      expect(result.advice.headline).toBe(validLlmResponse.headline);
      expect(result.isLearning).toBe(false);
    });

    it('retries with repair prompt when initial response is malformed JSON', async () => {
      const validLlmResponse = {
        headline: 'Spending is tracking in a careful range due to high dining spend',
        went_well: ['Essential expenses are steady'],
        watch_out: ['Food purchase was higher than usual'],
        action_tomorrow: 'Avoid unnecessary delivery apps tomorrow',
        saving_ideas: ['Audit subscription plans'],
        earning_ideas: [],
        mood: 'careful',
      };

      const fetchMock = vi
        .fn()
        // Call 1: Malformed JSON
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'This is not JSON at all!' } }],
          }),
        })
        // Call 2 (Repair retry): Valid JSON
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(validLlmResponse) } }],
          }),
        });

      globalThis.fetch = fetchMock;

      const result = await generateDailyReview('2026-10-20', { regenerate: true });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.source).toBe('llm');
      expect(result.advice.headline).toBe(validLlmResponse.headline);
    });

    it('rejects unsupported numbers and retries; falls back if repair also fails', async () => {
      const inventedNumberResponse = {
        headline: 'You spent ₹99,999 which is unprecedented', // ₹99,999 not in engine!
        went_well: ['Kept tracking'],
        watch_out: ['Spend of ₹99,999 is huge'],
        action_tomorrow: 'Do not spend',
        saving_ideas: ['Save money'],
        earning_ideas: [],
        mood: 'careful',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(inventedNumberResponse) } }],
        }),
      });

      globalThis.fetch = fetchMock;

      const result = await generateDailyReview('2026-10-20', { regenerate: true });

      // Was retried once
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Still invalid after retry -> fallback used
      expect(result.source).toBe('fallback');
      expect(result.fallbackReason).toBe('guardrail_rejected');
      expect(result.advice).toBeDefined();
    });

    it('handles HTTP 429 rate limit smoothly and returns fallback advice without throwing', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit reached',
      });

      const result = await generateDailyReview('2026-10-20', { regenerate: true });

      expect(result.source).toBe('fallback');
      expect(result.fallbackReason).toBe('rate_limited');
      expect(result.advice.headline).toBeDefined();
    });

    it('handles request timeout smoothly and returns fallback advice without throwing', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('TimeoutError: signal timed out'));

      const result = await generateDailyReview('2026-10-20', { regenerate: true });

      expect(result.source).toBe('fallback');
      expect(result.fallbackReason).toBe('timeout');
      expect(result.advice.headline).toBeDefined();
    });

    it('serves cached review when regenerate is false and limits regenerate to 5 per day', async () => {
      const validLlmResponse = {
        headline: 'Cached Review Headline',
        went_well: ['Good job on budget'],
        watch_out: [],
        action_tomorrow: 'Keep up the good work',
        saving_ideas: ['Save regularly'],
        earning_ideas: [],
        mood: 'good',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(validLlmResponse) } }],
        }),
      });
      globalThis.fetch = fetchMock;

      // 1. Initial generation
      const initial = await generateDailyReview('2026-10-20', { regenerate: false });
      expect(initial.source).toBe('llm');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 2. Fetch without regenerate: should use cache, fetch NOT called again
      const cached = await generateDailyReview('2026-10-20', { regenerate: false });
      expect(cached.advice.headline).toBe('Cached Review Headline');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 3. Regenerate up to 5 times
      for (let i = 1; i <= 4; i++) {
        await generateDailyReview('2026-10-20', { regenerate: true });
      }

      // 4. On 5th attempt, limit reached: canRegenerate becomes false
      const fifth = await generateDailyReview('2026-10-20', { regenerate: true });
      expect(fifth.canRegenerate).toBe(false);
      expect(fifth.regenerationCount).toBe(5);

      // 5. Subsequent call with regenerate: true should not call fetch again
      const fetchCountBefore = fetchMock.mock.calls.length;
      const sixth = await generateDailyReview('2026-10-20', { regenerate: true });
      expect(sixth.canRegenerate).toBe(false);
      expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);
    });
  });
});
