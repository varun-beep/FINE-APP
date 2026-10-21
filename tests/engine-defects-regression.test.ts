import { describe, it, expect } from 'vitest';
import { analyzeExpenses } from '@/lib/engine';
import { calculateSafeToSpend } from '@/lib/engine/safetospend';
import { detectContextAwareOutliers } from '@/lib/engine/outliers';
import { analyzeCategoryDrift } from '@/lib/engine/drift';
import { analyzeBehaviour } from '@/lib/engine/behaviour';
import { detectSmallLeaks } from '@/lib/engine/smallleaks';
import { addDays } from '@/lib/engine/math';
import type {
  EngineExpense,
  EngineSchedule,
  InsightLogEntry,
  EngineBudget,
  EngineDayClosure,
} from '@/lib/engine/types';

describe('Regression Tests: Engine Logic Defects (Item 2)', () => {
  const FIXED_NOW = '2026-10-20';

  // =========================================================================
  // 2a. Double-Counting Exclusions in Behaviour, Drift, and Small Leaks
  // =========================================================================
  describe('2a. Exclude one-off, outlier, schedule, and non-spend kinds', () => {
    it('drift calculation excludes outlier rows, one_off rows, schedule rows, and non-spend', () => {
      const expenses: EngineExpense[] = [];
      // 8 weeks baseline: Shopping ~₹1,000/week
      for (let w = 8; w >= 1; w--) {
        expenses.push({
          id: `base-shop-${w}`,
          amountPaise: 100000, // ₹1,000
          category: 'Shopping',
          spentOn: addDays(FIXED_NOW, -w * 7),
          kind: 'spend',
          source: 'manual',
          oneOff: false,
        });
      }

      // Add a single massive ₹1,00,000 outlier flagged expense
      expenses.push({
        id: 'outlier-shop-1',
        amountPaise: 10000000,
        category: 'Shopping',
        spentOn: addDays(FIXED_NOW, -2),
        kind: 'spend',
        source: 'manual',
        oneOff: false,
      });

      // Add a ₹50,000 one-off expense
      expenses.push({
        id: 'oneoff-shop-1',
        amountPaise: 5000000,
        category: 'Shopping',
        spentOn: addDays(FIXED_NOW, -3),
        kind: 'spend',
        source: 'manual',
        oneOff: true,
      });

      // Add a schedule-posted ₹20,000 investment/income
      expenses.push({
        id: 'sched-inv-1',
        amountPaise: 2000000,
        category: 'Shopping',
        spentOn: addDays(FIXED_NOW, -4),
        kind: 'investment',
        source: 'schedule',
        scheduleId: 'sched-1',
        oneOff: false,
      });

      // Run drift with outlierExpenseIds set
      const flaggedOutlierIds = new Set(['outlier-shop-1']);
      const res = analyzeCategoryDrift(expenses, FIXED_NOW, {
        outlierExpenseIds: flaggedOutlierIds,
      });

      // Shopping should NOT show a drift because the outlier, one-off, and schedule rows are excluded
      const shoppingDrift = res.insights.find((i) => i.id.includes('Shopping'));
      expect(shoppingDrift).toBeUndefined();
    });

    it('behaviour / payday calculation excludes one-off and outlier rows', () => {
      const salarySchedule: EngineSchedule = {
        id: 'salary-1',
        name: 'Tech Salary',
        kind: 'income',
        category: 'Income',
        amountPaise: 10000000, // ₹1,00,000
        frequency: 'monthly',
        anchorDate: '2026-10-01',
        startDate: '2026-01-01',
        active: true,
      };

      const expenses: EngineExpense[] = [];
      // Flat spending across 60 days of ~₹1,000/day
      for (let i = 1; i <= 60; i++) {
        expenses.push({
          id: `flat-exp-${i}`,
          amountPaise: 100000,
          category: 'Dining',
          spentOn: addDays(FIXED_NOW, -i),
          kind: 'spend',
          source: 'manual',
        });
      }

      // Add a ₹2,00,000 one-off purchase on day 2 post-salary
      expenses.push({
        id: 'oneoff-large-1',
        amountPaise: 20000000,
        category: 'Electronics',
        spentOn: '2026-10-02',
        kind: 'spend',
        source: 'manual',
        oneOff: true,
      });

      const flaggedOutliers = new Set(['oneoff-large-1']);
      const insights = analyzeBehaviour(expenses, [salarySchedule], FIXED_NOW, {
        outlierExpenseIds: flaggedOutliers,
      });

      // Because the one-off and outlier are excluded, payday surge is NOT triggered
      const paydayInsight = insights.find((i) => i.id.includes('payday_surge'));
      expect(paydayInsight).toBeUndefined();
    });

    it('small leaks excludes one-off and schedule rows', () => {
      const expenses: EngineExpense[] = [];
      // 10 small coffee charges of ₹150 in the last 20 days
      for (let i = 1; i <= 10; i++) {
        expenses.push({
          id: `coffee-${i}`,
          amountPaise: 15000,
          category: 'Dining',
          merchant: 'Starbucks',
          spentOn: addDays(FIXED_NOW, -i * 2),
          kind: 'spend',
          source: 'manual',
        });
      }

      // Add 10 schedule-posted OTT recurring charges
      for (let i = 1; i <= 10; i++) {
        expenses.push({
          id: `ott-${i}`,
          amountPaise: 19900,
          category: 'Entertainment',
          merchant: 'Netflix',
          spentOn: addDays(FIXED_NOW, -i * 2),
          kind: 'spend',
          source: 'schedule',
          scheduleId: 'sched-netflix',
        });
      }

      const leaks = detectSmallLeaks(expenses, FIXED_NOW);
      // Netflix should NOT be flagged as a leak because it is schedule-sourced
      const netflixLeak = leaks.find((l) => l.title.includes('Netflix'));
      expect(netflixLeak).toBeUndefined();
    });
  });

  // =========================================================================
  // 2b. PROJECTION is Not a Ranked Insight
  // =========================================================================
  describe('2b. PROJECTION returned as dedicated field, never in top-3 insight slots', () => {
    it('returns projection as separate engine output field and never in candidate insights', () => {
      const expenses: EngineExpense[] = [];
      for (let i = 1; i <= 35; i++) {
        expenses.push({
          id: `exp-${i}`,
          amountPaise: 200000,
          category: 'Food',
          spentOn: addDays(FIXED_NOW, -i),
          kind: 'spend',
          source: 'manual',
        });
      }

      const salarySchedule: EngineSchedule = {
        id: 'salary-1',
        name: 'Tech Salary',
        kind: 'income',
        category: 'Income',
        amountPaise: 10000000,
        frequency: 'monthly',
        anchorDate: '2026-10-01',
        startDate: '2026-01-01',
        active: true,
      };

      const closures: EngineDayClosure[] = [];
      for (let i = 1; i <= 20; i++) {
        closures.push({
          day: addDays(FIXED_NOW, -i),
          status: 'logged',
          closedAt: new Date(),
        });
      }

      const result = analyzeExpenses(expenses, {
        now: FIXED_NOW,
        schedules: [salarySchedule],
        closedDays: closures,
      });

      // Projection must be defined on result.projection
      expect(result.projection).toBeDefined();
      expect(result.projection?.totalProjectedPaise).toBeGreaterThan(0);

      // result.insights must NEVER contain a projection insight
      const projectionInTop = (result.insights || []).find((i) => i.type === 'projection');
      expect(projectionInTop).toBeUndefined();

      // allRankedInsights must NEVER contain a projection insight
      const projectionInAll = (result.allRankedInsights || []).find((i) => i.type === 'projection');
      expect(projectionInAll).toBeUndefined();
    });
  });

  // =========================================================================
  // 2c. Respect the Learning Gate in ALL Generators
  // =========================================================================
  describe('2c. Respect learning gate: returns only safe_to_spend and clear "still learning"', () => {
    it('suppresses outlier, drift, behaviour, and leak insights when closed days < 14', () => {
      const expenses: EngineExpense[] = [];
      // 35 expenses but across only 6 distinct days
      for (let i = 1; i <= 35; i++) {
        const dayOffset = i % 6;
        expenses.push({
          id: `exp-${i}`,
          amountPaise: i === 1 ? 5000000 : 100000, // One massive anomaly
          category: 'Shopping',
          spentOn: addDays(FIXED_NOW, -dayOffset),
          kind: 'spend',
          source: 'manual',
        });
      }

      const closures: EngineDayClosure[] = [
        { day: addDays(FIXED_NOW, -1), status: 'logged', closedAt: new Date() },
        { day: addDays(FIXED_NOW, -2), status: 'logged', closedAt: new Date() },
        { day: addDays(FIXED_NOW, -3), status: 'logged', closedAt: new Date() },
      ]; // Only 3 closed days (< 14 threshold)

      const result = analyzeExpenses(expenses, {
        now: FIXED_NOW,
        closedDays: closures,
      });

      // Learning status must be learning
      expect(result.learning.status).toBe('learning');

      // Only safe_to_spend is allowed; all others suppressed
      const nonSafeInsights = (result.insights || []).filter((i) => i.type !== 'safe_to_spend');
      expect(nonSafeInsights).toHaveLength(0);

      // Coverage report states clearly "still learning: needs X more closed days"
      expect(result.coverage?.reasons).toBeDefined();
      const needsDaysReason = result.coverage?.reasons.find((r) => r.includes('still learning: needs'));
      expect(needsDaysReason).toBeDefined();
      expect(needsDaysReason).toContain('more closed days');
    });
  });

  // =========================================================================
  // 2d. Safe to Spend When Remaining Discretionary is Negative
  // =========================================================================
  describe('2d. Safe to Spend: negative remaining discretionary handling', () => {
    it('reports budget is used up with ₹X over, suggests essentials-only, and computes lever from real deficit', () => {
      const salarySchedule: EngineSchedule = {
        id: 'salary-1',
        name: 'Salary',
        kind: 'income',
        category: 'Income',
        amountPaise: 5000000, // ₹50,000 monthly income
        frequency: 'monthly',
        anchorDate: '2026-10-01',
        startDate: '2026-01-01',
        active: true,
      };

      // Discretionary spend so far this month: ₹60,000 (exceeds ₹50,000 income by ₹10,000)
      const expenses: EngineExpense[] = [
        {
          id: 'exp-big',
          amountPaise: 6000000, // ₹60,000
          category: 'Shopping',
          spentOn: '2026-10-10',
          kind: 'spend',
          source: 'manual',
        },
      ];

      const s2s = calculateSafeToSpend(expenses, [salarySchedule], FIXED_NOW, {
        savingsTargetRate: 0.10, // ₹5,000 target
      });

      expect(s2s.insight).toBeDefined();
      const ins = s2s.insight!;

      // 1. Must say "This month's discretionary budget is used up; you are ₹X over"
      expect(ins.title).toContain("This month's discretionary budget is used up; you are");
      expect(ins.title).toContain('over');

      // 2. Must NEVER show "₹0.00 (over)"
      expect(ins.title).not.toContain('₹0.00 (over)');

      // 3. Lever description must suggest essentials-only
      const lever = ins.levers[0];
      expect(lever).toBeDefined();
      expect(lever.description.toLowerCase()).toContain('essentials-only');

      // 4. Lever's monthly saving must be computed from real figures (the deficit), NOT from today's spend
      expect(lever.monthlySavingPaise).toBeGreaterThan(0);
      expect(lever.monthlySavingPaise).toBe(Math.abs(s2s.allowance!.remainingDiscretionaryPaise));
    });
  });

  // =========================================================================
  // 2e. One-off > 7 Days Old Unanswered Handling
  // =========================================================================
  describe('2e. One-off > 7 days old unanswered: one-time prompt then silent', () => {
    it('surfaces as one-time "Was this planned?" prompt when timesShown === 0, then goes silent', () => {
      // Expense 10 days ago (older than 7 days)
      const oldOneOffDate = addDays(FIXED_NOW, -10);
      const expenses: EngineExpense[] = [];

      // 20 small baseline transactions in Dining
      for (let i = 1; i <= 20; i++) {
        expenses.push({
          id: `base-${i}`,
          amountPaise: 25000, // ₹250
          category: 'Dining',
          spentOn: addDays(FIXED_NOW, -i),
          kind: 'spend',
          source: 'manual',
        });
      }

      // Add a large one-off purchase from 10 days ago
      expenses.push({
        id: 'large-old-oneoff',
        amountPaise: 4000000, // ₹40,000 (160x median of ₹250)
        category: 'Dining',
        spentOn: oldOneOffDate,
        merchant: 'Apple Store',
        kind: 'spend',
        source: 'manual',
        oneOff: false,
      });

      // Run 1: timesShown === 0 (unanswered, first time seen)
      const logsFirstTime: InsightLogEntry[] = [];
      const resFirstTime = detectContextAwareOutliers(expenses, FIXED_NOW, {
        monthlyDiscretionaryBudgetPaise: 4000000,
        insightLogs: logsFirstTime,
      });

      const promptInsight = resFirstTime.insights.find((i) => i.id.includes('large-old-oneoff'));
      expect(promptInsight).toBeDefined();
      expect(promptInsight?.title).toContain('Was this planned?');

      // Run 2: timesShown === 1 (has been shown once, still unanswered -> goes silent)
      const logsSecondTime: InsightLogEntry[] = [
        {
          insightKey: promptInsight!.id,
          firstShown: '2026-10-18T00:00:00Z',
          lastShown: '2026-10-18T00:00:00Z',
          timesShown: 1,
          dismissed: false,
          feedback: null, // unanswered
        },
      ];

      const resSecondTime = detectContextAwareOutliers(expenses, FIXED_NOW, {
        monthlyDiscretionaryBudgetPaise: 4000000,
        insightLogs: logsSecondTime,
      });

      // Must NOT be in surfaced insights
      const promptSurfacedSecond = resSecondTime.insights.find((i) => i.id.includes('large-old-oneoff'));
      expect(promptSurfacedSecond).toBeUndefined();

      // Must be in silentFlags
      const silentFlag = resSecondTime.silentFlags.find((f) => f.id.includes('large-old-oneoff'));
      expect(silentFlag).toBeDefined();
      expect(silentFlag?.reason).toContain('is now silent');
    });
  });
});
