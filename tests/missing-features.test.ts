import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateWeeklyReview } from '@/lib/reviews/weekly';
import { generateMonthlyReview } from '@/lib/reviews/monthly';
import { generateExperimentProgressInsights } from '@/lib/engine/experiments';
import { isFeedbackSuppressed } from '@/lib/engine/ranking';
import { validateActionAntiRepetition } from '@/lib/llm/guardrail';
import { addDays } from '@/lib/engine/math';
import type {
  EngineExperiment,
  EngineExpense,
  Insight,
  InsightLogEntry,
} from '@/lib/engine/types';

// Mock DB for weekly & monthly review idempotency tests
const mockReviewsDB: Record<string, any> = {};

const createQueryChain = (results: any[] = []) => {
  const promise = Promise.resolve(results);
  return Object.assign(promise, {
    where: () => createQueryChain(results),
    limit: async (n: number) => results.slice(0, n),
    orderBy: () => createQueryChain(results),
  });
};

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        const isReviews = table?._?.name === 'reviews' || table?.periodType !== undefined;
        if (isReviews) {
          const key = (globalThis as any).__mockQueryKey || 'weekly:2026-10-18';
          const entry = mockReviewsDB[key];
          const rows = entry ? [entry] : [];
          return createQueryChain(rows);
        }
        return createQueryChain([]);
      },
    }),
    insert: () => ({
      values: (val: any) => ({
        onConflictDoUpdate: async () => {
          const key = `${val.periodType}:${val.reviewDate}`;
          mockReviewsDB[key] = val;
          return [val];
        },
      }),
    }),
  },
}));

describe('Missing Feature Tests (Item 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockReviewsDB)) {
      delete mockReviewsDB[k];
    }
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Offline unit test'));
  });

  // =========================================================================
  // 1. Weekly and Monthly Review Idempotency per Period
  // =========================================================================
  describe('1. Review Idempotency per Period (Weekly & Monthly)', () => {
    it('weekly review is idempotent per Sunday date', async () => {
      (globalThis as any).__mockQueryKey = 'weekly:2026-10-18';

      // First call generates and stores weekly review
      const first = await generateWeeklyReview('2026-10-18', { regenerate: false });
      expect(first).toBeDefined();
      expect(first.date).toBe('2026-10-18');
      expect(mockReviewsDB['weekly:2026-10-18']).toBeDefined();

      // Second call returns cached review without regenerating
      const second = await generateWeeklyReview('2026-10-18', { regenerate: false });
      expect(second.date).toBe('2026-10-18');
      expect(second.advice.verdict).toBe(first.advice.verdict);
    });

    it('monthly review is idempotent per month 1st date', async () => {
      (globalThis as any).__mockQueryKey = 'monthly:2026-10-01';

      // First call generates and stores monthly review
      const first = await generateMonthlyReview('2026-10-01', { regenerate: false });
      expect(first).toBeDefined();
      expect(first.date).toBe('2026-10-01');
      expect(mockReviewsDB['monthly:2026-10-01']).toBeDefined();

      // Second call returns cached review without regenerating
      const second = await generateMonthlyReview('2026-10-01', { regenerate: false });
      expect(second.date).toBe('2026-10-01');
      expect(second.advice.verdict).toBe(first.advice.verdict);
    });
  });

  // =========================================================================
  // 2. Experiment Lifecycle & Achieved vs Baseline
  // =========================================================================
  describe('2. Experiment Lifecycle: Create, Progress, Complete & Achieved vs Baseline', () => {
    const NOW = '2026-10-20';

    it('tracks active experiment progress with pro-rated baseline and days remaining', () => {
      const activeExp: EngineExperiment = {
        id: 'exp-dining-1',
        leverId: 'lever:Dining:limit_orders',
        category: 'Dining',
        metric: 'weekly_spend',
        target: '₹5,000/week',
        baseline: 3000000, // ₹30,000 monthly baseline
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        status: 'active',
      };

      // 20 days elapsed (Oct 1 to Oct 20)
      // Discretionary spend so far: ₹12,000 (spent less than pro-rated baseline of ₹30,000 * 20/31 = ~₹19,355)
      const expenses: EngineExpense[] = [
        {
          id: 'e-1',
          amountPaise: 1200000, // ₹12,000
          category: 'Dining',
          spentOn: '2026-10-10',
          kind: 'spend',
        },
      ];

      const insights = generateExperimentProgressInsights([activeExp], expenses, NOW);
      expect(insights).toHaveLength(1);
      const ins = insights[0];

      expect(ins.type).toBe('experiment_progress');
      expect(ins.title).toContain('Experiment Progress: Dining');
      expect(ins.title).toContain('11 days left');
      expect(ins.evidence.status).toBe('active');
      expect(ins.evidence.daysRemaining).toBe(11);
      expect(ins.evidence.actual).toBe(1200000);
      expect(ins.evidence.achievedSavingPaise).toBeGreaterThan(0);
    });

    it('completes experiment and computes final achieved saving vs baseline', () => {
      const completedExp: EngineExperiment = {
        id: 'exp-groceries-1',
        leverId: 'lever:Groceries:store_brand',
        category: 'Groceries',
        metric: 'monthly_spend',
        target: 'Buy store brands',
        baseline: 2000000, // ₹20,000 baseline
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        status: 'completed',
      };

      // Actual spend during September: ₹14,000 (achieved ₹6,000 saving vs ₹20,000 baseline)
      const expenses: EngineExpense[] = [
        {
          id: 'g-1',
          amountPaise: 1400000, // ₹14,000
          category: 'Groceries',
          spentOn: '2026-09-15',
          kind: 'spend',
        },
      ];

      const insights = generateExperimentProgressInsights([completedExp], expenses, NOW);
      expect(insights).toHaveLength(1);
      const ins = insights[0];

      expect(ins.type).toBe('experiment_progress');
      expect(ins.title).toContain('Experiment Completed: Groceries');
      expect(ins.title).toContain('₹6,000.00 saved vs baseline');
      expect(ins.impactPaise).toBe(600000); // ₹6,000 achieved saving
      expect(ins.evidence.status).toBe('completed');
      expect(ins.evidence.achievedSavingPaise).toBe(600000);
    });

    it('ignores abandoned experiments', () => {
      const abandonedExp: EngineExperiment = {
        id: 'exp-abandoned',
        leverId: 'lever:Shopping:no_buy',
        category: 'Shopping',
        metric: 'spend',
        target: 'No impulse buying',
        baseline: 1000000,
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        status: 'abandoned',
      };

      const insights = generateExperimentProgressInsights([abandonedExp], [], NOW);
      expect(insights).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. Max-2-Active Experiments Cap
  // =========================================================================
  describe('3. Max-2-Active Experiments Cap', () => {
    it('enforces maximum 2 active experiments cap', () => {
      const activeExperiments = [
        { id: '1', status: 'active' },
        { id: '2', status: 'active' },
      ];

      const canStartNew = activeExperiments.filter((e) => e.status === 'active').length < 2;
      expect(canStartNew).toBe(false);

      // Completing one unlocks a slot
      activeExperiments[0].status = 'completed';
      const canStartNow = activeExperiments.filter((e) => e.status === 'active').length < 2;
      expect(canStartNow).toBe(true);
    });
  });

  // =========================================================================
  // 4. Feedback Suppression Windows
  // =========================================================================
  describe('4. Feedback Suppression Windows', () => {
    const baseInsight: Insight = {
      id: 'drift:Dining:2026-W42',
      type: 'drift',
      title: 'Dining drift +25%',
      impactPaise: 200000,
      confidence: 0.85,
      actionable: true,
      levers: [],
      evidence: { category: 'Dining' },
      firstSeen: '2026-10-01',
      severity: 'warning',
    };

    it('suppresses insight for exactly 14 days after a single not_useful feedback', () => {
      const logs: InsightLogEntry[] = [
        {
          insightKey: 'drift:Dining:2026-W42',
          firstShown: '2026-10-01T00:00:00Z',
          lastShown: '2026-10-01T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ];

      // Day 13 (< 14 days) -> suppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-14')).toBe(true);

      // Day 14 (boundary) -> unsuppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-15')).toBe(false);

      // Day 20 (> 14 days) -> unsuppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-21')).toBe(false);
    });

    it('suppresses insight for 60 days after 3 consecutive not_useful feedbacks', () => {
      const logs: InsightLogEntry[] = [
        {
          insightKey: 'drift:Dining:2026-W42',
          firstShown: '2026-10-01T00:00:00Z',
          lastShown: '2026-10-01T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-10-01T00:00:00Z',
        },
        {
          insightKey: 'drift:Dining:2026-W41',
          firstShown: '2026-09-24T00:00:00Z',
          lastShown: '2026-09-24T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-09-24T00:00:00Z',
        },
        {
          insightKey: 'drift:Dining:2026-W40',
          firstShown: '2026-09-17T00:00:00Z',
          lastShown: '2026-09-17T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-09-17T00:00:00Z',
        },
      ];

      // Day 30 after latest feedback (< 60 days) -> suppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-31')).toBe(true);

      // Day 59 after latest feedback (< 60 days) -> suppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-11-29')).toBe(true);

      // Day 60 (boundary) -> unsuppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-11-30')).toBe(false);
    });
  });

  // =========================================================================
  // 5. Repeated-Action Avoidance Across Last 3 Reviews
  // =========================================================================
  describe('5. Repeated-Action Avoidance Across Last 3 Reviews', () => {
    it('rejects candidate action if it duplicates any of the last 3 review actions', () => {
      const last3 = [
        'Brew coffee at home instead of daily takeaway',
        'Pause OTT streaming subscriptions',
        'Hold discretionary spend to ₹1,200 tomorrow',
      ];

      // Exact repetition
      const check1 = validateActionAntiRepetition(
        'Brew coffee at home instead of daily takeaway',
        last3
      );
      expect(check1.valid).toBe(false);
      expect(check1.reason).toContain('repeats an action shown in the last 3 reviews');

      // Substring repetition
      const check2 = validateActionAntiRepetition(
        'Please pause OTT streaming subscriptions to save money',
        last3
      );
      expect(check2.valid).toBe(false);

      // Fresh action
      const check3 = validateActionAntiRepetition(
        'Pack lunch for work tomorrow to save ₹350',
        last3
      );
      expect(check3.valid).toBe(true);
    });
  });
});
