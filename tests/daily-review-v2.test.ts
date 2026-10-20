import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dailyReviewAdviceSchemaV2 } from '@/lib/llm/types';
import {
  validateNumberGuardrail,
  validateInsightIds,
  validateActionAntiRepetition,
} from '@/lib/llm/guardrail';
import { generateFallbackAdvice } from '@/lib/llm/fallback';
import { isFeedbackSuppressed, rankAndFilterInsights } from '@/lib/engine/ranking';
import { generateExperimentProgressInsights } from '@/lib/engine/experiments';
import { generateDeterministicWeeklyFallback, type WeeklyAggregates } from '@/lib/reviews/weekly';
import { generateDeterministicMonthlyFallback, type MonthlyAggregates } from '@/lib/reviews/monthly';
import type { EngineOutput, Insight, InsightLogEntry, EngineExperiment, EngineExpense } from '@/lib/engine/types';

describe('SpendCoach Daily Review v2 & Engine Enhancements', () => {
  describe('1. Valid v2 JSON Accepted', () => {
    it('successfully validates a complete v2 review matching the schema', () => {
      const validV2 = {
        verdict: 'You spent ₹450 today against your daily allowance of ₹1,500.',
        why_it_matters: 'Remaining under allowance leaves ₹1,050 surplus for savings.',
        insights: [
          {
            insight_id: 'safe_to_spend:2026-10-20',
            narrative: 'Your discretionary allowance is ₹1,500 per day.',
            lever_id: 'lever:allowance:daily',
          },
        ],
        one_action_tomorrow: 'Keep discretionary spend within ₹1,500 tomorrow.',
        win: 'You spent ₹1,050 less than your daily allowance.',
        mood: 'good' as const,
      };

      const result = dailyReviewAdviceSchemaV2.safeParse(validV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.verdict).toBe(validV2.verdict);
        expect(result.data.insights).toHaveLength(1);
        expect(result.data.win).toBe(validV2.win);
      }
    });

    it('accepts null win when there is no genuine win today', () => {
      const validV2WithNullWin = {
        verdict: 'You spent ₹2,200 today, exceeding your daily allowance of ₹1,500.',
        why_it_matters: 'Daily overspending reduces the buffer for unexpected expenses.',
        insights: [],
        one_action_tomorrow: 'Pause discretionary purchases tomorrow to balance the allowance.',
        win: null,
        mood: 'caution' as const,
      };

      const result = dailyReviewAdviceSchemaV2.safeParse(validV2WithNullWin);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.win).toBeNull();
      }
    });
  });

  describe('2. Candidate Insight IDs Guardrail', () => {
    it('accepts insight IDs that exist in candidate list', () => {
      const advice = {
        verdict: 'Good job today.',
        why_it_matters: 'Expenses are on track.',
        insights: [
          {
            insight_id: 'drift:Dining:2026-W42',
            narrative: 'Dining spend increased.',
          },
        ],
        one_action_tomorrow: 'Cook dinner at home.',
        win: null,
        mood: 'good' as const,
      };

      const result = validateInsightIds(advice, ['drift:Dining:2026-W42', 'safe_to_spend:2026-10-20']);
      expect(result.valid).toBe(true);
    });

    it('rejects insight IDs that are NOT in the supplied candidate list', () => {
      const advice = {
        verdict: 'Good job today.',
        why_it_matters: 'Expenses are on track.',
        insights: [
          {
            insight_id: 'invented_insight_id_123',
            narrative: 'Invented narrative.',
          },
        ],
        one_action_tomorrow: 'Cook dinner at home.',
        win: null,
        mood: 'good' as const,
      };

      const result = validateInsightIds(advice, ['safe_to_spend:2026-10-20']);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('invented_insight_id_123');
    });
  });

  describe('3. Invented Number Guardrail', () => {
    it('rejects ungrounded invented numbers not present in evidence or levers', () => {
      const allowedNumbers = [450, 1500, 1050];
      const adviceWithInventedNumber = {
        verdict: 'You spent ₹450 today against your allowance of ₹1,500.',
        why_it_matters: 'You could earn ₹75,000 extra with an 18% return rate.',
        insights: [],
        one_action_tomorrow: 'Save ₹1,050 tomorrow.',
        win: null,
      };

      const result = validateNumberGuardrail(adviceWithInventedNumber, allowedNumbers);
      expect(result.valid).toBe(false);
      expect(result.unsupportedNumbers).toContain(75000);
      expect(result.unsupportedNumbers).toContain(18);
    });

    it('accepts numbers present in allowance, candidate evidence, and levers', () => {
      // Evidence has 450 (spent), 1500 (allowance), 2500 (lever monthly saving), 3 (orders)
      const allowedNumbers = [450, 1500, 2500, 3];
      const groundedAdvice = {
        verdict: 'You spent ₹450 today within your daily allowance of ₹1,500.',
        why_it_matters: 'Saving daily keeps you on target.',
        insights: [
          {
            insight_id: 'lever:dining',
            narrative: 'Limit food deliveries to 3 orders per week.',
          },
        ],
        one_action_tomorrow: 'Cut food deliveries to save ₹2,500 this month.',
        win: 'Under allowance today.',
      };

      const result = validateNumberGuardrail(groundedAdvice, allowedNumbers);
      expect(result.valid).toBe(true);
      expect(result.unsupportedNumbers).toHaveLength(0);
    });
  });

  describe('4. Action Anti-Repetition Guardrail', () => {
    it('rejects an action that repeats one shown in the last 3 reviews', () => {
      const last3 = [
        'Limit food delivery orders to 2 per week',
        'Switch mobile plan to save ₹300',
        'Stick to daily allowance of ₹1,500',
      ];

      const check1 = validateActionAntiRepetition(
        'Limit food delivery orders to 2 per week',
        last3
      );
      expect(check1.valid).toBe(false);

      const check2 = validateActionAntiRepetition(
        'Please stick to daily allowance of ₹1,500 tomorrow',
        last3
      );
      expect(check2.valid).toBe(false);
    });

    it('accepts a fresh, non-repeated action', () => {
      const last3 = [
        'Limit food delivery orders to 2 per week',
        'Switch mobile plan to save ₹300',
        'Stick to daily allowance of ₹1,500',
      ];

      const result = validateActionAntiRepetition(
        'Prepare home-brewed coffee instead of cafe takeaway',
        last3
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('5. Nothing Notable Path', () => {
    it('produces calm fallback when engine returns no candidate insights', () => {
      const emptyEngineOutput: EngineOutput = {
        evaluatedAt: '2026-10-20',
        learning: {
          status: 'ready',
          expenseCount: 45,
          distinctDaysCount: 20,
          expenseThreshold: 30,
          distinctDaysThreshold: 14,
          expensesNeeded: 0,
          daysNeeded: 0,
          categories: {},
        },
        allowance: {
          dailyAllowancePaise: 150000,
          weekdayAwareAllowancePaise: 150000,
          todaySpentPaise: 0,
          verdict: 'under',
          tomorrowDailyAllowancePaise: 150000,
          tomorrowWeekdayAllowancePaise: 150000,
          monthlyIncomePaise: 5000000,
          committedDuePaise: 1000000,
          savingsTargetPaise: 1000000,
          discretionarySpentSoFarPaise: 0,
          remainingDiscretionaryPaise: 3000000,
          daysLeftInMonth: 10,
        },
        insights: [],
        transactionAnomalies: [],
        dailyAnomalies: [],
        recurring: [],
        budgetRunRate: {
          spentSoFarPaise: 0,
          projectedMonthEndPaise: 0,
          monthlyLimitPaise: null,
          budgetStatus: 'on_track',
          percentageUsed: null,
          projectedPercentage: null,
          categories: [],
        },
        trends: {
          last7DaysPaise: 0,
          prev7DaysPaise: 0,
          weekOverWeekPercent: null,
          currentMonthToDatePaise: 0,
          prevMonthToDatePaise: 0,
          monthOverMonthPercent: null,
          categories: [],
        },
      };

      const fallback = generateFallbackAdvice(emptyEngineOutput);
      expect(fallback.insights).toHaveLength(0);
      expect(fallback.verdict).toContain('allowance');
      expect(fallback.why_it_matters).toContain('Nothing notable today');
      expect(fallback.one_action_tomorrow).toBeDefined();
    });
  });

  describe('6. Fallback Built from Insights & Levers', () => {
    it('constructs deterministic fallback directly from engine insights and levers', () => {
      const mockInsight: Insight = {
        id: 'drift:Food:2026-W42',
        type: 'drift',
        title: 'Food spend drifting upward',
        impactPaise: 350000,
        confidence: 0.85,
        actionable: true,
        levers: [
          {
            id: 'lever:Food:cook_dinner',
            description: 'Cook dinner at home 2 extra nights/week',
            monthlySavingPaise: 200000,
          },
        ],
        evidence: { category: 'Food', weeklyAvgPaise: 500000 },
        firstSeen: '2026-10-15',
        severity: 'warning',
      };

      const engineOutput: EngineOutput = {
        evaluatedAt: '2026-10-20',
        learning: {
          status: 'ready',
          expenseCount: 40,
          distinctDaysCount: 18,
          expenseThreshold: 30,
          distinctDaysThreshold: 14,
          expensesNeeded: 0,
          daysNeeded: 0,
          categories: {},
        },
        allowance: {
          dailyAllowancePaise: 120000,
          weekdayAwareAllowancePaise: 120000,
          todaySpentPaise: 80000,
          verdict: 'under',
          tomorrowDailyAllowancePaise: 120000,
          tomorrowWeekdayAllowancePaise: 120000,
          monthlyIncomePaise: 5000000,
          committedDuePaise: 1000000,
          savingsTargetPaise: 1000000,
          discretionarySpentSoFarPaise: 80000,
          remainingDiscretionaryPaise: 2920000,
          daysLeftInMonth: 11,
        },
        insights: [mockInsight],
        transactionAnomalies: [],
        dailyAnomalies: [],
        recurring: [],
        budgetRunRate: {
          spentSoFarPaise: 80000,
          projectedMonthEndPaise: 2400000,
          monthlyLimitPaise: null,
          budgetStatus: 'on_track',
          percentageUsed: null,
          projectedPercentage: null,
          categories: [],
        },
        trends: {
          last7DaysPaise: 80000,
          prev7DaysPaise: 0,
          weekOverWeekPercent: null,
          currentMonthToDatePaise: 80000,
          prevMonthToDatePaise: 0,
          monthOverMonthPercent: null,
          categories: [],
        },
      };

      const fallback = generateFallbackAdvice(engineOutput);

      expect(fallback.insights).toHaveLength(1);
      expect(fallback.insights[0].insight_id).toBe('drift:Food:2026-W42');
      expect(fallback.insights[0].lever_id).toBe('lever:Food:cook_dinner');
      expect(fallback.one_action_tomorrow).toContain('Cook dinner at home');
      expect(fallback.win).toContain('under your daily spending allowance');
    });
  });

  describe('7. Experiments Tracking & Lifecycle', () => {
    it('generates progress insights for active experiments', () => {
      const activeExp: EngineExperiment = {
        id: 'exp-1',
        leverId: 'lever:dining:limit',
        category: 'Dining',
        metric: 'orders',
        target: '3 orders/week',
        baseline: 5,
        startDate: '2026-10-01',
        endDate: '2026-10-28',
        status: 'active',
      };

      const expenses: EngineExpense[] = [
        {
          id: 'e1',
          amountPaise: 40000,
          category: 'Dining',
          spentOn: '2026-10-05',
          kind: 'spend',
        },
        {
          id: 'e2',
          amountPaise: 35000,
          category: 'Dining',
          spentOn: '2026-10-12',
          kind: 'spend',
        },
      ];

      const progress = generateExperimentProgressInsights([activeExp], expenses, '2026-10-15');
      expect(progress).toHaveLength(1);
      expect(progress[0].id).toBe('experiment_progress:exp-1');
      expect(progress[0].evidence?.actual).toBe(2);
      expect(progress[0].evidence?.status).toBe('active');
    });

    it('calculates achieved savings on experiment completion', () => {
      const completedExp: EngineExperiment = {
        id: 'exp-2',
        leverId: 'lever:shopping:cut',
        category: 'Shopping',
        metric: 'spend',
        target: '₹5,000 monthly cap',
        baseline: 1500000, // ₹15,000
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        status: 'completed',
      };

      const expenses: EngineExpense[] = [
        {
          id: 'e3',
          amountPaise: 600000, // ₹6,000 spent
          category: 'Shopping',
          spentOn: '2026-09-15',
          kind: 'spend',
        },
      ];

      const progress = generateExperimentProgressInsights([completedExp], expenses, '2026-10-01');
      expect(progress).toHaveLength(1);
      expect(progress[0].evidence?.achievedSavingPaise).toBe(900000); // 15,000 - 6,000 = ₹9,000 saved
      expect(progress[0].evidence?.status).toBe('completed');
    });
  });

  describe('8. Feedback Learning Suppression Windows', () => {
    const baseInsight: Insight = {
      id: 'drift:Groceries:2026-W42',
      type: 'drift',
      title: 'Groceries spend drift',
      impactPaise: 250000,
      confidence: 0.8,
      actionable: true,
      levers: [],
      evidence: { category: 'Groceries' },
      firstSeen: '2026-10-10',
      severity: 'info',
    };

    it('suppresses insight for 14 days after "not_useful" feedback', () => {
      const logs: InsightLogEntry[] = [
        {
          insightKey: 'drift:Groceries:2026-W41',
          firstShown: '2026-10-10T00:00:00Z',
          lastShown: '2026-10-10T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-10-10T00:00:00Z',
        },
      ];

      // Day 5 after feedback (< 14 days) -> suppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-15')).toBe(true);

      // Day 16 after feedback (>= 14 days) -> unsuppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-26')).toBe(false);
    });

    it('suppresses insight for 14 days after "already_know" and "planned" feedback', () => {
      const logs: InsightLogEntry[] = [
        {
          insightKey: 'drift:Groceries:2026-W41',
          firstShown: '2026-10-10T00:00:00Z',
          lastShown: '2026-10-10T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'already_know',
          updatedAt: '2026-10-10T00:00:00Z',
        },
      ];

      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-15')).toBe(true);
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-10-25')).toBe(false);
    });

    it('suppresses insight for 60 days after 3 consecutive "not_useful" feedbacks', () => {
      const logs: InsightLogEntry[] = [
        {
          insightKey: 'drift:Groceries:2026-W42',
          firstShown: '2026-10-01T00:00:00Z',
          lastShown: '2026-10-01T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-10-01T00:00:00Z',
        },
        {
          insightKey: 'drift:Groceries:2026-W41',
          firstShown: '2026-09-24T00:00:00Z',
          lastShown: '2026-09-24T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-09-24T00:00:00Z',
        },
        {
          insightKey: 'drift:Groceries:2026-W40',
          firstShown: '2026-09-17T00:00:00Z',
          lastShown: '2026-09-17T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-09-17T00:00:00Z',
        },
      ];

      // Day 40 after latest feedback (< 60 days) -> suppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-11-10')).toBe(true);

      // Day 65 after latest feedback (>= 60 days) -> unsuppressed
      expect(isFeedbackSuppressed(baseInsight, logs, '2026-12-05')).toBe(false);
    });

    it('filters out suppressed insights in rankAndFilterInsights', () => {
      const logs: InsightLogEntry[] = [
        {
          insightKey: 'drift:Groceries:2026-W42',
          firstShown: '2026-10-18T00:00:00Z',
          lastShown: '2026-10-18T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: 'not_useful',
          updatedAt: '2026-10-18T00:00:00Z',
        },
      ];

      const { topInsights } = rankAndFilterInsights([baseInsight], {
        monthlyIncomePaise: 5000000,
        insightLogs: logs,
        now: '2026-10-20',
      });

      expect(topInsights).toHaveLength(0);
    });
  });

  describe('9. Weekly & Monthly Deterministic Aggregation & Idempotency Shape', () => {
    it('generates deterministic weekly review fallback grounded in aggregates', () => {
      const mockAggregates: WeeklyAggregates = {
        sundayDate: '2026-10-18',
        weekStart: '2026-10-12',
        w0SpendPaise: 420000,
        w1SpendPaise: 500000,
        w2SpendPaise: 480000,
        w3SpendPaise: 520000,
        trailing3AvgPaise: 500000,
        weekOverWeekPct: -16,
        bestCategory: { category: 'Dining', w0Paise: 120000, w1Paise: 200000, diffPaise: -80000 },
        worstCategory: { category: 'Groceries', w0Paise: 180000, w1Paise: 150000, diffPaise: 30000 },
        weeklyInvestedPaise: 70000,
        estimatedWeeklyIncomePaise: 1250000,
        savingsRatePct: 6,
        experimentSuggestion: {
          lever_id: 'lever:Dining:limit_orders',
          category: 'Dining',
          description: 'Limit food deliveries to 3 orders per week',
          target: '3 orders/week',
          baseline_paise: 200000,
          duration_weeks: 4,
        },
      };

      const fallback = generateDeterministicWeeklyFallback(mockAggregates);
      expect(fallback.verdict).toContain('under your trailing 3-week average');
      expect(fallback.spend_vs_prior_weeks).toContain('16% lower');
      expect(fallback.experiment_suggestion.lever_id).toBe('lever:Dining:limit_orders');
      expect(fallback.earning_ideas).toHaveLength(1);
    });

    it('generates deterministic monthly review fallback grounded in aggregates', () => {
      const mockAggregates: MonthlyAggregates = {
        monthDate: '2026-10-01',
        monthEnd: '2026-10-31',
        monthlyIncomePaise: 5000000,
        monthlySpendPaise: 2400000,
        monthlyInvestedPaise: 1000000,
        savingsRatePct: 20,
        savingsTargetRatePct: 20,
        commitmentsTotalPaise: 1200000,
        commitmentsShareOfIncomePct: 24,
        topLearnings: [
          'Monthly spend was ₹24,000.00 across 31 days.',
          'Savings rate reached 20% against your 20% target.',
          'Fixed commitments take 24% of your total income.',
        ],
        budgetAdjustmentSuggestion: 'Maintain existing budgets; spending tracked well within limits.',
        savingOrEarningIdea: 'Review subscriptions before next month renewals.',
      };

      const fallback = generateDeterministicMonthlyFallback(mockAggregates);
      expect(fallback.income_vs_spend_vs_invested).toContain('₹50,000.00');
      expect(fallback.savings_rate_vs_target).toContain('20%');
      expect(fallback.top_learnings).toHaveLength(3);
      expect(fallback.mood).toBe('celebratory');
    });
  });
});
