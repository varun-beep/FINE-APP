import { describe, it, expect } from 'vitest';
import {
  analyzeExpenses,
  calculateSafeToSpend,
  detectContextAwareOutliers,
  analyzeCategoryDrift,
  analyzeBehaviour,
  detectSmallLeaks,
  analyzeCommitmentLoad,
  analyzeSavings,
  calculateMonthEndProjection,
  rankAndFilterInsights,
  evaluateCoverage,
} from '@/lib/engine';
import type {
  EngineExpense,
  EngineSchedule,
  EngineBudget,
  EngineDayClosure,
  InsightLogEntry,
} from '@/lib/engine/types';
import { addDays } from '@/lib/engine/math';

describe('SpendCoach Brain Engine & Insights', () => {
  const FIXED_NOW = '2026-10-20'; // Tuesday in October (31 days)

  // Standard salary schedule: ₹1,50,000 on 1st of month
  const SALARY_SCHEDULE: EngineSchedule = {
    id: 'sched-salary',
    name: 'Salary',
    kind: 'income',
    category: 'Income',
    amountPaise: 15000000, // ₹1,50,000
    frequency: 'monthly',
    anchorDate: '2026-10-01',
    startDate: '2026-01-01',
    active: true,
  };

  // Daily gold investment schedule: ₹500/day
  const GOLD_SCHEDULE: EngineSchedule = {
    id: 'sched-gold',
    name: 'Daily Gold Investment',
    kind: 'investment',
    category: 'Investment',
    amountPaise: 50000, // ₹500
    frequency: 'daily',
    anchorDate: '2026-10-01',
    startDate: '2026-06-01',
    active: true,
  };

  // Subscriptions
  const NETFLIX_SCHEDULE: EngineSchedule = {
    id: 'sched-netflix',
    name: 'Netflix Premium',
    kind: 'subscription',
    category: 'Entertainment',
    amountPaise: 64900, // ₹649
    frequency: 'monthly',
    anchorDate: '2026-10-15',
    startDate: '2026-01-01',
    active: true,
  };

  const SPOTIFY_SCHEDULE: EngineSchedule = {
    id: 'sched-spotify',
    name: 'Spotify Family',
    kind: 'subscription',
    category: 'Entertainment',
    amountPaise: 17900, // ₹179
    frequency: 'monthly',
    anchorDate: '2026-10-10',
    startDate: '2026-01-01',
    active: true,
  };

  const PRIME_SCHEDULE: EngineSchedule = {
    id: 'sched-prime',
    name: 'Amazon Prime',
    kind: 'subscription',
    category: 'Entertainment',
    amountPaise: 149900, // ₹1,499 yearly = ~₹125/mo
    frequency: 'yearly',
    anchorDate: '2026-10-05',
    startDate: '2026-01-01',
    active: true,
  };

  const HOTSTAR_SCHEDULE: EngineSchedule = {
    id: 'sched-hotstar',
    name: 'Disney+ Hotstar',
    kind: 'subscription',
    category: 'Entertainment',
    amountPaise: 29900, // ₹299
    frequency: 'monthly',
    anchorDate: '2026-10-20',
    startDate: '2026-01-01',
    active: true,
  };

  // Helper to generate steady baseline expenses
  function generateBaselineExpenses(daysCount = 60, dailyAmount = 100000): EngineExpense[] {
    const list: EngineExpense[] = [];
    for (let i = 1; i <= daysCount; i++) {
      const spentOn = addDays(FIXED_NOW, -i);
      list.push({
        id: `base-${i}`,
        amountPaise: dailyAmount + (i % 5) * 5000,
        category: 'Food',
        merchant: i % 2 === 0 ? 'Swiggy' : 'Zomato',
        spentOn,
        kind: 'spend',
        source: 'manual',
      });
    }
    return list;
  }

  // =========================================================================
  // GROUP 1: SAFE-TO-SPEND ALLOWANCE (Tests 1 - 6)
  // =========================================================================
  describe('1. Safe-to-Spend Allowance Generator', () => {
    it('1. computes daily allowance subtracting commitments, 20% savings target, and spend so far', () => {
      // Income = ₹1,50,000 (15,000,000 paise).
      // Fixed commitments: Gold (₹500 × 31 = ₹15,500 = 1,550,000 paise) + Netflix (₹649 = 64,900 paise). Total commitments = 1,614,900 paise.
      // 20% savings target = ₹30,000 = 3,000,000 paise.
      // Net discretionary budget = 15,000,000 - 1,614,900 - 3,000,000 = 10,385,100 paise (~₹1,03,851).
      // Days left on Oct 20 (including today) = 31 - 20 + 1 = 12 days.
      const schedules = [SALARY_SCHEDULE, GOLD_SCHEDULE, NETFLIX_SCHEDULE];
      const res = calculateSafeToSpend([], schedules, FIXED_NOW, 0.20);

      expect(res.allowance).not.toBeNull();
      const allowance = res.allowance!;
      expect(allowance.monthlyIncomePaise).toBe(15000000);
      expect(allowance.committedDuePaise).toBe(1550000 + 64900);
      expect(allowance.savingsTargetPaise).toBe(3000000);
      expect(allowance.daysLeftInMonth).toBe(12);
      expect(allowance.dailyAllowancePaise).toBe(Math.round(10385100 / 12));
    });

    it('2. evaluates today spend verdict as under, at, or over allowance', () => {
      const schedules = [SALARY_SCHEDULE];
      // Under verdict
      const underRes = calculateSafeToSpend(
        [{ id: 't1', amountPaise: 10000, category: 'Food', spentOn: FIXED_NOW }],
        schedules,
        FIXED_NOW
      );
      expect(underRes.allowance?.verdict).toBe('under');

      // Over verdict (spending ₹50,000 on today)
      const overRes = calculateSafeToSpend(
        [{ id: 't2', amountPaise: 5000000, category: 'Shopping', spentOn: FIXED_NOW }],
        schedules,
        FIXED_NOW
      );
      expect(overRes.allowance?.verdict).toBe('over');
    });

    it('3. calculates effect of today overspending on tomorrow allowance', () => {
      const schedules = [SALARY_SCHEDULE];
      const res = calculateSafeToSpend(
        [{ id: 't-heavy', amountPaise: 2000000, category: 'Food', spentOn: FIXED_NOW }],
        schedules,
        FIXED_NOW
      );
      const allowance = res.allowance!;
      // Tomorrow's allowance should drop since today's overspend is subtracted from remaining
      expect(allowance.tomorrowDailyAllowancePaise).toBeLessThan(allowance.dailyAllowancePaise);
    });

    it('4. computes weekday-aware allowance from historical spend profile', () => {
      // Historical spend: twice as high on weekends (Sat=6, Sun=0)
      const historical: EngineExpense[] = [];
      for (let i = 1; i <= 30; i++) {
        const spentOn = addDays(FIXED_NOW, -i);
        const [y, m, d] = spentOn.split('-').map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const amt = dow === 0 || dow === 6 ? 200000 : 50000;
        historical.push({
          id: `h-${i}`,
          amountPaise: amt,
          category: 'Food',
          spentOn,
        });
      }

      const res = calculateSafeToSpend(historical, [SALARY_SCHEDULE], FIXED_NOW);
      expect(res.allowance).not.toBeNull();
      // Oct 20 is Tuesday. Weekday allowance should differ from flat daily allowance
      expect(res.allowance?.weekdayAwareAllowancePaise).toBeGreaterThan(0);
    });

    it('5. falls back to trailing 3-month income when no income schedule exists', () => {
      const ninetyDaysAgo = addDays(FIXED_NOW, -45);
      const incomeExpenses: EngineExpense[] = [
        {
          id: 'inc-1',
          amountPaise: 30000000, // ₹3,00,000 across 90 days = ₹1,00,000/mo
          category: 'Income',
          kind: 'income',
          spentOn: ninetyDaysAgo,
        },
      ];

      const res = calculateSafeToSpend(incomeExpenses, [], FIXED_NOW);
      expect(res.allowance).not.toBeNull();
      expect(res.allowance?.monthlyIncomePaise).toBe(10000000); // 30000000 / 3
    });

    it('6. returns insufficient_data when neither income schedule nor 3-month income exists', () => {
      const res = calculateSafeToSpend([], [], FIXED_NOW);
      expect(res.allowance).toBeNull();
      expect(res.insufficientReason).toContain('insufficient_data');
    });
  });

  // =========================================================================
  // GROUP 2: CONTEXT-AWARE OUTLIER DETECTION (Tests 7 - 14)
  // =========================================================================
  describe('2. Context-Aware Outlier Detection', () => {
    it('7. does NOT surface a lumpy Health bill (variability >= 0.5) under higher modified z-score bar', () => {
      // 10 Health expenses with high natural dispersion: ₹1,000 to ₹5,000
      const healthExpenses: EngineExpense[] = [
        { id: 'h1', amountPaise: 100000, category: 'Health', spentOn: addDays(FIXED_NOW, -30) },
        { id: 'h2', amountPaise: 150000, category: 'Health', spentOn: addDays(FIXED_NOW, -25) },
        { id: 'h3', amountPaise: 200000, category: 'Health', spentOn: addDays(FIXED_NOW, -20) },
        { id: 'h4', amountPaise: 250000, category: 'Health', spentOn: addDays(FIXED_NOW, -18) },
        { id: 'h5', amountPaise: 300000, category: 'Health', spentOn: addDays(FIXED_NOW, -15) },
        { id: 'h6', amountPaise: 350000, category: 'Health', spentOn: addDays(FIXED_NOW, -12) },
        { id: 'h7', amountPaise: 400000, category: 'Health', spentOn: addDays(FIXED_NOW, -10) },
        { id: 'h8', amountPaise: 450000, category: 'Health', spentOn: addDays(FIXED_NOW, -8) },
        { id: 'h9', amountPaise: 500000, category: 'Health', spentOn: addDays(FIXED_NOW, -5) },
        // A ₹6,500 dental cleaning (normal for lumpy Health, below 3.5x median or 5% budget)
        { id: 'h10', amountPaise: 650000, category: 'Health', spentOn: FIXED_NOW },
      ];

      const res = detectContextAwareOutliers(healthExpenses, FIXED_NOW, {
        monthlyDiscretionaryBudgetPaise: 5000000,
      });

      // Health bill should NOT be surfaced as an active insight
      const healthInsight = res.insights.find((i) => i.expenseId === 'h10');
      expect(healthInsight).toBeUndefined();
    });

    it('8. surfaces a ₹20k Shopping jump in a steady category', () => {
      const shoppingExpenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `s-${i}`,
          amountPaise: 50000 + (i % 3) * 5000, // median ~₹550
          category: 'Shopping',
          merchant: 'Zara',
          spentOn: addDays(FIXED_NOW, -(i * 3 + 2)),
        })),
        // ₹20,000 flagship purchase (2,000,000 paise)
        {
          id: 's-spike',
          amountPaise: 2000000,
          category: 'Shopping',
          merchant: 'Apple Store',
          spentOn: FIXED_NOW,
        },
      ];

      const res = detectContextAwareOutliers(shoppingExpenses, FIXED_NOW, {
        monthlyDiscretionaryBudgetPaise: 5000000,
      });

      const spikeInsight = res.insights.find((i) => i.expenseId === 's-spike');
      expect(spikeInsight).toBeDefined();
      expect(spikeInsight?.title).toContain('Apple Store');
      expect(spikeInsight?.evidence.classification).toBe('one_off_large');
    });

    it('9. detects possible duplicate charge (same merchant, same amount, same day)', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `f-${i}`,
          amountPaise: 25000,
          category: 'Food',
          merchant: 'Swiggy',
          spentOn: addDays(FIXED_NOW, -i - 2),
        })),
        {
          id: 'swiggy-1',
          amountPaise: 45000,
          category: 'Food',
          merchant: 'Swiggy',
          spentOn: FIXED_NOW,
        },
        {
          id: 'swiggy-2',
          amountPaise: 45000,
          category: 'Food',
          merchant: 'Swiggy',
          spentOn: FIXED_NOW,
        },
      ];

      const res = detectContextAwareOutliers(expenses, FIXED_NOW);
      const dup = res.insights.find((i) => i.expenseId === 'swiggy-2');
      expect(dup).toBeDefined();
      expect(dup?.title).toContain('Possible duplicate');
      expect(dup?.evidence.isDuplicate).toBe(true);
    });

    it('10. records sub-threshold anomaly as silent flag instead of surfacing', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `f-${i}`,
          amountPaise: 10000,
          category: 'Food',
          merchant: 'Tea Stall',
          spentOn: addDays(FIXED_NOW, -i - 2),
        })),
        // ₹350 spend vs ₹100 median. Excess is ₹250 (< ₹500 floor and < 5% of ₹50,000 budget)
        {
          id: 'f-sub',
          amountPaise: 35000,
          category: 'Food',
          merchant: 'Tea Stall',
          spentOn: FIXED_NOW,
        },
      ];

      const res = detectContextAwareOutliers(expenses, FIXED_NOW, {
        monthlyDiscretionaryBudgetPaise: 5000000,
      });

      expect(res.insights.find((i) => i.expenseId === 'f-sub')).toBeUndefined();
      const silent = res.silentFlags.find((s) => s.id === 'silent:outlier:f-sub');
      expect(silent).toBeDefined();
    });

    it('11. never mentions an expense tagged one_off=true again', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `s-${i}`,
          amountPaise: 50000,
          category: 'Shopping',
          spentOn: addDays(FIXED_NOW, -i - 2),
        })),
        {
          id: 's-planned',
          amountPaise: 2500000,
          category: 'Shopping',
          merchant: 'Furniture Store',
          spentOn: FIXED_NOW,
          oneOff: true, // tagged one_off
        },
      ];

      const res = detectContextAwareOutliers(expenses, FIXED_NOW);
      expect(res.insights.find((i) => i.expenseId === 's-planned')).toBeUndefined();
      expect(res.silentFlags.find((s) => s.id.includes('s-planned'))).toBeUndefined();
    });

    it('12. suppresses outlier when memory log has feedback=planned', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `s-${i}`,
          amountPaise: 50000,
          category: 'Shopping',
          spentOn: addDays(FIXED_NOW, -i - 2),
        })),
        {
          id: 's-unplanned',
          amountPaise: 2500000,
          category: 'Shopping',
          merchant: 'Jewelry',
          spentOn: FIXED_NOW,
          oneOff: false,
        },
      ];

      const logs: InsightLogEntry[] = [
        {
          insightKey: 'outlier:s-unplanned',
          firstShown: addDays(FIXED_NOW, -1),
          lastShown: addDays(FIXED_NOW, -1),
          timesShown: 1,
          dismissed: true,
          feedback: 'planned',
        },
      ];

      const res = detectContextAwareOutliers(expenses, FIXED_NOW, { insightLogs: logs });
      expect(res.insights.find((i) => i.expenseId === 's-unplanned')).toBeUndefined();
    });

    it('13. includes wasPlanned flag in evidence so UI can prompt user once', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `f-${i}`,
          amountPaise: 20000,
          category: 'Food',
          spentOn: addDays(FIXED_NOW, -i - 2),
        })),
        {
          id: 'f-spike',
          amountPaise: 200000, // ₹2,000 dinner vs ₹200 median
          category: 'Food',
          merchant: 'Fine Dining',
          spentOn: FIXED_NOW,
        },
      ];

      const res = detectContextAwareOutliers(expenses, FIXED_NOW);
      const ins = res.insights.find((i) => i.expenseId === 'f-spike');
      expect(ins).toBeDefined();
      expect(ins?.evidence.wasPlanned).toBe(false);
    });

    it('14. excludes scheduled source expenses from outlier detection', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `f-${i}`,
          amountPaise: 20000,
          category: 'Food',
          spentOn: addDays(FIXED_NOW, -i - 2),
        })),
        {
          id: 'f-sched',
          amountPaise: 500000,
          category: 'Food',
          spentOn: FIXED_NOW,
          source: 'schedule',
        },
      ];

      const res = detectContextAwareOutliers(expenses, FIXED_NOW);
      expect(res.insights.find((i) => i.expenseId === 'f-sched')).toBeUndefined();
    });
  });

  // =========================================================================
  // GROUP 3: TREND DRIFT GENERATOR (Tests 15 - 20)
  // =========================================================================
  describe('3. Trend Drift Generator', () => {
    it('15. detects steady Food drifting up 35% over 4 weeks with correct monthly ₹ effect', () => {
      // 12 weeks of data (84 days)
      // Prior 8 weeks (weeks 4 to 11): 3 transactions per week of ₹2,000 = ₹6,000/week (600,000 paise)
      // Last 4 weeks (weeks 0 to 3): 3 transactions per week of ₹2,700 = ₹8,100/week (810,000 paise) -> +35% drift
      const expenses: EngineExpense[] = [];
      for (let w = 0; w < 12; w++) {
        const amt = w < 4 ? 270000 : 200000;
        for (let t = 0; t < 3; t++) {
          const daysAgo = w * 7 + t * 2 + 1;
          expenses.push({
            id: `drift-${w}-${t}`,
            amountPaise: amt,
            category: 'Food',
            spentOn: addDays(FIXED_NOW, -daysAgo),
          });
        }
      }

      const res = analyzeCategoryDrift(expenses, FIXED_NOW);
      const foodDrift = res.insights.find((i) => i.type === 'drift' && i.id.includes('Food'));
      expect(foodDrift).toBeDefined();

      const evidence = foodDrift!.evidence;
      expect(evidence.category).toBe('Food');
      expect(evidence.recentWeeklyMedianPaise).toBe(810000);
      expect(evidence.priorWeeklyMedianPaise).toBe(600000);
      expect(evidence.percentChange).toBe(35);
      // Monthly effect = (810,000 - 600,000) * 4.33 = 210,000 * 4.33 = 909,300 paise (~₹9,093)
      expect(evidence.monthlyEffectPaise).toBe(909300);
    });

    it('16. returns insufficient_data when category has < 8 weeks of history', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `short-${i}`,
          amountPaise: 50000,
          category: 'Food',
          spentOn: addDays(FIXED_NOW, -i), // only 15 days of history
        })),
      ];

      const res = analyzeCategoryDrift(expenses, FIXED_NOW);
      const foodAnalysis = res.categoryAnalyses.find((c) => c.category === 'Food');
      expect(foodAnalysis?.status).toBe('insufficient_data');
      expect(foodAnalysis?.reason).toContain('8 weeks of history');
    });

    it('17. returns insufficient_data when category has < 6 transactions in 12-week window', () => {
      // Has 90 days span, but only 4 transactions in Health
      const expenses: EngineExpense[] = [
        { id: 'h-1', amountPaise: 50000, category: 'Health', spentOn: addDays(FIXED_NOW, -80) },
        { id: 'h-2', amountPaise: 50000, category: 'Health', spentOn: addDays(FIXED_NOW, -60) },
        { id: 'h-3', amountPaise: 50000, category: 'Health', spentOn: addDays(FIXED_NOW, -30) },
        { id: 'h-4', amountPaise: 50000, category: 'Health', spentOn: addDays(FIXED_NOW, -10) },
      ];

      const res = analyzeCategoryDrift(expenses, FIXED_NOW);
      const healthAnalysis = res.categoryAnalyses.find((c) => c.category === 'Health');
      expect(healthAnalysis?.status).toBe('insufficient_data');
    });

    it('18. does NOT trigger drift when spending across weeks is flat', () => {
      const expenses: EngineExpense[] = [];
      for (let w = 0; w < 12; w++) {
        for (let t = 0; t < 2; t++) {
          expenses.push({
            id: `flat-${w}-${t}`,
            amountPaise: 50000,
            category: 'Groceries',
            spentOn: addDays(FIXED_NOW, -(w * 7 + t * 2 + 1)),
          });
        }
      }

      const res = analyzeCategoryDrift(expenses, FIXED_NOW);
      const grocDrift = res.insights.find((i) => i.id.includes('Groceries'));
      expect(grocDrift).toBeUndefined();
    });

    it('19. does not flag downward spending improvement as an alarming drift', () => {
      const expenses: EngineExpense[] = [];
      for (let w = 0; w < 12; w++) {
        // Decreasing spend (recent is lower than prior)
        const amt = w < 4 ? 20000 : 80000;
        for (let t = 0; t < 2; t++) {
          expenses.push({
            id: `down-${w}-${t}`,
            amountPaise: amt,
            category: 'Transport',
            spentOn: addDays(FIXED_NOW, -(w * 7 + t * 2 + 1)),
          });
        }
      }

      const res = analyzeCategoryDrift(expenses, FIXED_NOW);
      const transportDrift = res.insights.find((i) => i.id.includes('Transport'));
      expect(transportDrift).toBeUndefined();
    });

    it('20. excludes one_off expenses from drift calculations', () => {
      const expenses: EngineExpense[] = [];
      for (let w = 0; w < 12; w++) {
        for (let t = 0; t < 2; t++) {
          expenses.push({
            id: `base-${w}-${t}`,
            amountPaise: 50000,
            category: 'Shopping',
            spentOn: addDays(FIXED_NOW, -(w * 7 + t * 2 + 1)),
          });
        }
      }
      // Add a single massive one-off in recent week
      expenses.push({
        id: 'oneoff-huge',
        amountPaise: 5000000,
        category: 'Shopping',
        spentOn: addDays(FIXED_NOW, -3),
        oneOff: true,
      });

      const res = analyzeCategoryDrift(expenses, FIXED_NOW);
      expect(res.insights.find((i) => i.id.includes('Shopping'))).toBeUndefined();
    });
  });

  // =========================================================================
  // GROUP 4: BEHAVIOURAL INSIGHTS (Tests 21 - 25)
  // =========================================================================
  describe('4. Behavioural Spend Patterns', () => {
    it('21. detects Payday Surge when spend in 5 days post-salary is >= 1.5x rest of month', () => {
      const expenses: EngineExpense[] = [];
      // 60 days of data
      // Payday is 1st of month. On days 1, 2, 3, 4, 5: daily spend = ₹6,000. On other days: ₹1,500.
      for (let i = 1; i <= 60; i++) {
        const spentOn = addDays(FIXED_NOW, -i);
        const [, , dStr] = spentOn.split('-');
        const d = parseInt(dStr, 10);
        const isPaydayWindow = d >= 1 && d <= 5;
        expenses.push({
          id: `exp-${i}`,
          amountPaise: isPaydayWindow ? 600000 : 150000,
          category: 'Shopping',
          spentOn,
        });
      }

      const res = analyzeBehaviour(expenses, [SALARY_SCHEDULE], FIXED_NOW);
      const paydayInsight = res.find((i) => i.id.includes('payday_surge'));
      expect(paydayInsight).toBeDefined();
      expect(paydayInsight?.title).toContain('Payday Surge');
    });

    it('22. does not flag payday surge when spending is evenly paced throughout the month', () => {
      const expenses: EngineExpense[] = [];
      for (let i = 1; i <= 60; i++) {
        expenses.push({
          id: `exp-${i}`,
          amountPaise: 100000,
          category: 'Food',
          spentOn: addDays(FIXED_NOW, -i),
        });
      }

      const res = analyzeBehaviour(expenses, [SALARY_SCHEDULE], FIXED_NOW);
      expect(res.find((i) => i.id.includes('payday_surge'))).toBeUndefined();
    });

    it('23. detects Weekend Surge when daily spend on weekends is >= 1.8x weekdays', () => {
      const expenses: EngineExpense[] = [];
      for (let i = 1; i <= 60; i++) {
        const spentOn = addDays(FIXED_NOW, -i);
        const [y, m, d] = spentOn.split('-').map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        expenses.push({
          id: `exp-${i}`,
          amountPaise: isWeekend ? 500000 : 150000, // ~3.3x weekend spend
          category: 'Entertainment',
          spentOn,
        });
      }

      const res = analyzeBehaviour(expenses, [], FIXED_NOW);
      const weekendInsight = res.find((i) => i.id.includes('weekend_surge'));
      expect(weekendInsight).toBeDefined();
      expect(weekendInsight?.title).toContain('Weekend Spending');
    });

    it('24. detects merchant concentration when single merchant has >= 65% of category spend', () => {
      const expenses: EngineExpense[] = [];
      // 15 Food expenses: 12 Swiggy (₹1,000 each = ₹12,000), 3 Others (₹500 each = ₹1,500) -> 88% Swiggy
      for (let i = 1; i <= 12; i++) {
        expenses.push({
          id: `swiggy-${i}`,
          amountPaise: 100000,
          category: 'Food',
          merchant: 'Swiggy',
          spentOn: addDays(FIXED_NOW, -i),
        });
      }
      for (let i = 1; i <= 3; i++) {
        expenses.push({
          id: `other-${i}`,
          amountPaise: 50000,
          category: 'Food',
          merchant: 'Local Cafe',
          spentOn: addDays(FIXED_NOW, -i - 12),
        });
      }

      const res = analyzeBehaviour(expenses, [], FIXED_NOW);
      const concInsight = res.find((i) => i.id.includes('concentration:Food:Swiggy'));
      expect(concInsight).toBeDefined();
      expect(concInsight?.title).toContain('Swiggy accounts for');
    });

    it('25. does not flag concentration when merchants are diverse', () => {
      const merchants = ['Uber', 'Ola', 'Rapido', 'Namma Yatri', 'Metro'];
      const expenses: EngineExpense[] = [];
      for (let i = 1; i <= 15; i++) {
        expenses.push({
          id: `t-${i}`,
          amountPaise: 15000,
          category: 'Transport',
          merchant: merchants[i % merchants.length],
          spentOn: addDays(FIXED_NOW, -i),
        });
      }

      const res = analyzeBehaviour(expenses, [], FIXED_NOW);
      expect(res.find((i) => i.id.includes('concentration:Transport'))).toBeUndefined();
    });
  });

  // =========================================================================
  // GROUP 5: SMALL LEAKS GENERATOR (Tests 26 - 30)
  // =========================================================================
  describe('5. Small Leaks Generator', () => {
    it('26. detects frequent micro-spends (e.g. ₹120 chai × 22 per month at Chaayos)', () => {
      const expenses: EngineExpense[] = [
        // 22 chai purchases of ₹120 (12,000 paise) in last 30 days
        ...Array.from({ length: 22 }, (_, i) => ({
          id: `chai-${i}`,
          amountPaise: 12000,
          category: 'Food',
          merchant: 'Chaayos',
          spentOn: addDays(FIXED_NOW, -(i + 1)),
        })),
        // Baseline other discretionary spend so total is ~₹60,000 (Chai = ₹2,640 = 4.4% of budget)
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `other-${i}`,
          amountPaise: 550000,
          category: 'Groceries',
          spentOn: addDays(FIXED_NOW, -(i * 2 + 1)),
        })),
      ];

      const res = detectSmallLeaks(expenses, FIXED_NOW);
      const chaiLeak = res.find((l) => l.id.includes('Chaayos'));
      expect(chaiLeak).toBeDefined();

      const ev = chaiLeak!.evidence;
      expect(ev.count).toBe(22);
      expect(ev.medianPaise).toBe(12000);
      expect(ev.monthlyTotalPaise).toBe(22 * 12000); // 264,000 paise
      expect(ev.annualisedTotalPaise).toBe(22 * 12000 * 12); // 3,168,000 paise
      expect(chaiLeak?.levers[0].monthlySavingPaise).toBe(Math.round(264000 / 2));
    });

    it('27. ignores frequent purchases if median is >= ₹300', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `lunch-${i}`,
          amountPaise: 45000, // ₹450 median
          category: 'Food',
          merchant: 'Subway',
          spentOn: addDays(FIXED_NOW, -(i + 1)),
        })),
        { id: 'b1', amountPaise: 500000, category: 'Shopping', spentOn: addDays(FIXED_NOW, -5) },
      ];

      const res = detectSmallLeaks(expenses, FIXED_NOW);
      expect(res.find((l) => l.id.includes('Subway'))).toBeUndefined();
    });

    it('28. ignores micro-spends with < 8 purchases in 30 days', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `coffee-${i}`,
          amountPaise: 15000,
          category: 'Food',
          merchant: 'Third Wave Coffee',
          spentOn: addDays(FIXED_NOW, -(i * 3 + 1)),
        })),
        { id: 'b1', amountPaise: 500000, category: 'Shopping', spentOn: addDays(FIXED_NOW, -5) },
      ];

      const res = detectSmallLeaks(expenses, FIXED_NOW);
      expect(res.find((l) => l.id.includes('Third Wave'))).toBeUndefined();
    });

    it('29. ignores micro-spends totaling < 3% of 30-day discretionary spend', () => {
      const expenses: EngineExpense[] = [
        // 8 purchases of ₹50 = ₹400
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `candy-${i}`,
          amountPaise: 5000,
          category: 'Food',
          merchant: 'Paan Shop',
          spentOn: addDays(FIXED_NOW, -(i + 1)),
        })),
        // Huge other spend of ₹3,00,000, so ₹400 is only 0.13%
        { id: 'b1', amountPaise: 30000000, category: 'Shopping', spentOn: addDays(FIXED_NOW, -5) },
      ];

      const res = detectSmallLeaks(expenses, FIXED_NOW);
      expect(res.find((l) => l.id.includes('Paan Shop'))).toBeUndefined();
    });

    it('30. calculates annualized impact and half-frequency savings lever', () => {
      const expenses: EngineExpense[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `t-${i}`,
          amountPaise: 20000, // ₹200
          category: 'Food',
          merchant: 'Starbucks',
          spentOn: addDays(FIXED_NOW, -(i * 2 + 1)),
        })),
        { id: 'b1', amountPaise: 500000, category: 'Shopping', spentOn: addDays(FIXED_NOW, -5) },
      ];

      const res = detectSmallLeaks(expenses, FIXED_NOW);
      const starbucks = res.find((l) => l.id.includes('Starbucks'));
      expect(starbucks).toBeDefined();
      expect(starbucks?.levers[0].monthlySavingPaise).toBe(100000); // half of 200,000
    });
  });

  // =========================================================================
  // GROUP 6: COMMITMENT LOAD & SAVINGS (Tests 31 - 34)
  // =========================================================================
  describe('6. Commitment Load & Savings', () => {
    it('31. reports subscription overlap without judgement when >= 3 subscriptions exist in Entertainment', () => {
      const schedules = [
        SALARY_SCHEDULE,
        NETFLIX_SCHEDULE,
        SPOTIFY_SCHEDULE,
        HOTSTAR_SCHEDULE,
      ];

      const res = analyzeCommitmentLoad(schedules, FIXED_NOW);
      const overlap = res.find((i) => i.id.includes('entertainment_overlap'));
      expect(overlap).toBeDefined();
      expect(overlap?.title).toContain('3 active subscription services');
      expect(overlap?.evidence.count).toBe(3);
      expect(overlap?.actionable).toBe(false); // NO JUDGEMENT
    });

    it('32. does not surface overlap when < 3 subscriptions exist', () => {
      const schedules = [SALARY_SCHEDULE, NETFLIX_SCHEDULE, SPOTIFY_SCHEDULE];
      const res = analyzeCommitmentLoad(schedules, FIXED_NOW);
      expect(res.find((i) => i.id.includes('entertainment_overlap'))).toBeUndefined();
    });

    it('33. computes savings rate = (income - discretionary - non-investment commitments) / income', () => {
      // Income = ₹1,00,000 (10,000,000 paise)
      const incomeSched: EngineSchedule = {
        ...SALARY_SCHEDULE,
        amountPaise: 10000000,
      };
      // Non-investment: Netflix ₹1,000 (100,000 paise)
      const subSched: EngineSchedule = {
        ...NETFLIX_SCHEDULE,
        amountPaise: 100000,
      };
      // Discretionary spend so far: ₹30,000 (3,000,000 paise)
      const expenses: EngineExpense[] = [
        { id: 'e1', amountPaise: 3000000, category: 'Food', spentOn: FIXED_NOW },
      ];

      const res = analyzeSavings(expenses, [incomeSched, subSched], FIXED_NOW, 0.20);
      const savingsInsight = res.find((i) => i.type === 'savings');
      expect(savingsInsight).toBeDefined();
      // Savings = (10,000,000 - 3,000,000 - 100,000) = 6,900,000 paise (69%)
      expect(savingsInsight?.evidence.savingsRatePercent).toBe(69);
    });

    it('34. tracks cumulative gold investment since schedule start', () => {
      const expenses: EngineExpense[] = [
        { id: 'g1', amountPaise: 50000, category: 'Investment', merchant: 'Daily Gold Investment', spentOn: '2026-10-01' },
        { id: 'g2', amountPaise: 50000, category: 'Investment', merchant: 'Daily Gold Investment', spentOn: '2026-10-02' },
        { id: 'g3', amountPaise: 50000, category: 'Investment', merchant: 'Daily Gold Investment', spentOn: '2026-10-03' },
      ];

      const res = analyzeSavings(expenses, [SALARY_SCHEDULE, GOLD_SCHEDULE], FIXED_NOW);
      const savingsInsight = res.find((i) => i.type === 'savings');
      expect(savingsInsight?.evidence.cumulativeGoldPaise).toBe(150000); // ₹1,500
    });
  });

  // =========================================================================
  // GROUP 7: MONTH-END PROJECTION (Tests 35 - 37)
  // =========================================================================
  describe('7. Month-End Projection', () => {
    it('35. caps single day outlier at 90th percentile so spike does not distort run rate', () => {
      // 19 days of spend in October before Oct 20: 18 days at ₹1,000, 1 day at ₹50,000 spike
      const expenses: EngineExpense[] = [];
      for (let d = 1; d <= 18; d++) {
        const spentOn = `2026-10-${String(d).padStart(2, '0')}`;
        expenses.push({ id: `d-${d}`, amountPaise: 100000, category: 'Food', spentOn });
      }
      expenses.push({ id: 'd-spike', amountPaise: 5000000, category: 'Shopping', spentOn: '2026-10-19' });

      const res = calculateMonthEndProjection(expenses, [NETFLIX_SCHEDULE], FIXED_NOW);
      expect(res).not.toBeNull();
      // Capped P90 should be near ₹1,000, NOT ₹50,000
      expect(res?.evidence.cappedP90Paise).toBeLessThan(3000000);
      expect(res?.evidence.projectedDiscretionaryRemainingPaise).toBeLessThan(5000000);
    });

    it('36. includes committed known for rest of month in projected total', () => {
      // Sched due on Oct 25 (after Oct 20)
      const lateBill: EngineSchedule = {
        id: 'bill-late',
        name: 'Electricity Bill',
        kind: 'bill',
        category: 'Bills',
        amountPaise: 350000, // ₹3,500
        frequency: 'monthly',
        anchorDate: '2026-10-25',
        startDate: '2026-01-01',
        active: true,
      };

      const res = calculateMonthEndProjection([], [lateBill], FIXED_NOW);
      expect(res?.evidence.committedKnownRestOfMonthPaise).toBe(350000);
    });

    it('37. computes low and high confidence bands around projected spend', () => {
      const expenses = [
        { id: 'e1', amountPaise: 500000, category: 'Food', spentOn: '2026-10-10' },
      ];
      const res = calculateMonthEndProjection(expenses, [NETFLIX_SCHEDULE], FIXED_NOW);
      expect(res).not.toBeNull();
      expect(res?.evidence.lowPaise).toBeLessThan(res?.evidence.totalProjectedPaise as number);
      expect(res?.evidence.highPaise).toBeGreaterThan(res?.evidence.totalProjectedPaise as number);
    });

  });

  // =========================================================================
  // GROUP 8: RANKING, NOVELTY SUPPRESSION & DETERMINISM (Tests 38 - 44)
  // =========================================================================
  describe('8. Ranking, Memory, Novelty & Determinism', () => {
    it('38. ranks systemic drift higher than a single one-off spike of similar impact', () => {
      const driftInsight = {
        id: 'drift:Food:2026-W42',
        type: 'drift' as const,
        title: 'Food spend drifting up',
        impactPaise: 1000000, // ₹10,000
        confidence: 0.85,
        actionable: true,
        levers: [{ id: 'l1', description: 'Curb', monthlySavingPaise: 1000000 }],
        firstSeen: FIXED_NOW,
        severity: 'warning' as const,
        evidence: {},
      };

      const spikeInsight = {
        id: 'outlier:exp-spike',
        type: 'outlier' as const,
        title: 'Spike in Shopping',
        impactPaise: 1000000, // ₹10,000
        confidence: 0.85,
        actionable: true,
        levers: [{ id: 'l2', description: 'Review', monthlySavingPaise: 0 }],
        firstSeen: FIXED_NOW,
        severity: 'warning' as const,
        evidence: {},
      };

      const { topInsights } = rankAndFilterInsights([driftInsight, spikeInsight], {
        now: FIXED_NOW,
        monthlyIncomePaise: 10000000,
      });

      // Drift should be ranked #1
      expect(topInsights[0].id).toBe('drift:Food:2026-W42');
    });

    it('39. suppresses insight shown in the last 3 days (novelty = 0)', () => {
      const insight = {
        id: 'leak:Swiggy:2026-10',
        type: 'small_leaks' as const,
        title: 'Swiggy micro-spends',
        impactPaise: 500000,
        confidence: 0.9,
        actionable: true,
        levers: [],
        firstSeen: addDays(FIXED_NOW, -2),
        severity: 'info' as const,
        evidence: {},
      };

      const logs: InsightLogEntry[] = [
        {
          insightKey: 'leak:Swiggy:2026-10',
          firstShown: addDays(FIXED_NOW, -2),
          lastShown: addDays(FIXED_NOW, -1), // shown yesterday
          timesShown: 1,
          dismissed: false,
          lastImpactPaise: 500000,
        },
      ];

      const { topInsights } = rankAndFilterInsights([insight], {
        now: FIXED_NOW,
        insightLogs: logs,
      });

      expect(topInsights.find((i) => i.id === 'leak:Swiggy:2026-10')).toBeUndefined();
    });

    it('40. re-surfaces an insight shown in last 3 days if its impact grew >= 25%', () => {
      const insight = {
        id: 'leak:Swiggy:2026-10',
        type: 'small_leaks' as const,
        title: 'Swiggy micro-spends',
        impactPaise: 650000, // grew from 500,000 (+30%)
        confidence: 0.9,
        actionable: true,
        levers: [],
        firstSeen: addDays(FIXED_NOW, -2),
        severity: 'info' as const,
        evidence: {},
      };

      const logs: InsightLogEntry[] = [
        {
          insightKey: 'leak:Swiggy:2026-10',
          firstShown: addDays(FIXED_NOW, -2),
          lastShown: addDays(FIXED_NOW, -1),
          timesShown: 1,
          dismissed: false,
          lastImpactPaise: 500000,
        },
      ];

      const { topInsights } = rankAndFilterInsights([insight], {
        now: FIXED_NOW,
        insightLogs: logs,
      });

      // Should re-surface!
      expect(topInsights.find((i) => i.id === 'leak:Swiggy:2026-10')).toBeDefined();
    });

    it('41. suppresses insight when user gave not_now or not_useful feedback', () => {
      const insight = {
        id: 'drift:Shopping:2026-W42',
        type: 'drift' as const,
        title: 'Shopping drift',
        impactPaise: 1500000,
        confidence: 0.9,
        actionable: true,
        levers: [],
        firstSeen: FIXED_NOW,
        severity: 'warning' as const,
        evidence: {},
      };

      const logs: InsightLogEntry[] = [
        {
          insightKey: 'drift:Shopping:2026-W42',
          firstShown: addDays(FIXED_NOW, -5),
          lastShown: addDays(FIXED_NOW, -5),
          timesShown: 1,
          dismissed: true,
          feedback: 'not_useful',
        },
      ];

      const { topInsights } = rankAndFilterInsights([insight], {
        now: FIXED_NOW,
        insightLogs: logs,
      });

      expect(topInsights.find((i) => i.id === 'drift:Shopping:2026-W42')).toBeUndefined();
    });

    it('42. returns top 3 insights plus safe_to_spend (max 4 cards total)', () => {
      const candidates = [
        {
          id: 'safe_to_spend:2026-10-20',
          type: 'safe_to_spend' as const,
          title: 'Safe to Spend',
          impactPaise: 1000,
          confidence: 0.95,
          actionable: true,
          levers: [],
          firstSeen: FIXED_NOW,
          severity: 'info' as const,
          evidence: {},
        },
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `ins-${i}`,
          type: 'drift' as const,
          title: `Drift ${i}`,
          impactPaise: 1000000 * (i + 1),
          confidence: 0.9,
          actionable: true,
          levers: [],
          firstSeen: FIXED_NOW,
          severity: 'warning' as const,
          evidence: {},
        })),
      ];

      const { topInsights } = rankAndFilterInsights(candidates, { now: FIXED_NOW });
      expect(topInsights.length).toBe(4); // 1 safe_to_spend + 3 top insights
      expect(topInsights[0].type).toBe('safe_to_spend');
    });

    it('43. returns "nothing notable" (silence) on boring baseline data without padding', () => {
      // 30 days of perfectly flat, predictable spending
      const expenses = generateBaselineExpenses(30, 20000);
      const res = analyzeExpenses(expenses, { now: FIXED_NOW });

      // No uncharacteristic anomalies, no drift, no leaks
      const nonSafe = (res.insights || []).filter((i) => i.type !== 'safe_to_spend');
      expect(nonSafe.length).toBe(0); // Silence is a valid answer!

    });

    it('44. proves engine determinism: analyzeExpenses produces identical outputs on repeated runs', () => {
      const expenses = generateBaselineExpenses(45, 35000);
      const options = {
        now: FIXED_NOW,
        schedules: [SALARY_SCHEDULE, GOLD_SCHEDULE],
      };

      const run1 = analyzeExpenses(expenses, options);
      const run2 = analyzeExpenses(expenses, options);

      expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    });
  });
});
