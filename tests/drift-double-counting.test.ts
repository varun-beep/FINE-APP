import { describe, it, expect } from 'vitest';
import { analyzeCategoryDrift } from '@/lib/engine/drift';
import { analyzeExpenses } from '@/lib/engine';
import { generateFallbackAdvice } from '@/lib/llm/fallback';
import type { EngineExpense, SafeToSpendAllowance } from '@/lib/engine/types';

describe('Drift Double-Counting & Deduplication Rules (4a, 4b, 4c, 3)', () => {
  const now = '2026-10-22';

  // Helper to generate baseline weekly meals (weeks 4-11: 8 weeks)
  function createBaselineMeals(): EngineExpense[] {
    const list: EngineExpense[] = [];
    for (let week = 4; week < 12; week++) {
      const d1 = new Date(new Date(now).getTime() - (week * 7 + 1) * 86400000).toISOString().slice(0, 10);
      const d2 = new Date(new Date(now).getTime() - (week * 7 + 3) * 86400000).toISOString().slice(0, 10);
      const d3 = new Date(new Date(now).getTime() - (week * 7 + 5) * 86400000).toISOString().slice(0, 10);
      list.push(
        { id: `base_meal_${week}_1`, spentOn: d1, amountPaise: 25000, category: 'Food', merchant: 'Subway', kind: 'spend' },
        { id: `base_meal_${week}_2`, spentOn: d2, amountPaise: 25000, category: 'Food', merchant: 'Subway', kind: 'spend' },
        { id: `base_meal_${week}_3`, spentOn: d3, amountPaise: 25000, category: 'Food', merchant: 'Subway', kind: 'spend' }
      );
    }
    return list;
  }

  // Helper to generate recent dining (weeks 0-3: 4 weeks)
  function createRecentDining(): EngineExpense[] {
    const list: EngineExpense[] = [];
    for (let week = 0; week < 4; week++) {
      const d1 = new Date(new Date(now).getTime() - (week * 7 + 1) * 86400000).toISOString().slice(0, 10);
      const d2 = new Date(new Date(now).getTime() - (week * 7 + 3) * 86400000).toISOString().slice(0, 10);
      const d3 = new Date(new Date(now).getTime() - (week * 7 + 5) * 86400000).toISOString().slice(0, 10);
      list.push(
        { id: `recent_meal_${week}_1`, spentOn: d1, amountPaise: 40000, category: 'Food', merchant: 'Punjab Grill', kind: 'spend' },
        { id: `recent_meal_${week}_2`, spentOn: d2, amountPaise: 40000, category: 'Food', merchant: 'Punjab Grill', kind: 'spend' },
        { id: `recent_meal_${week}_3`, spentOn: d3, amountPaise: 41500, category: 'Food', merchant: 'Punjab Grill', kind: 'spend' }
      );
    }
    return list;
  }

  it('4a: excludes expenses flagged as duplicate or outlier from drift calculation', () => {
    const baseline = createBaselineMeals();
    const recent = createRecentDining();

    // Add a massive outlier expense in Food during recent window
    const outlierExpense: EngineExpense = {
      id: 'outlier_catering_1',
      spentOn: '2026-10-18',
      amountPaise: 5000000, // ₹50,000 catering
      category: 'Food',
      merchant: 'Grand Catering',
      kind: 'spend',
    };

    // Add a duplicate charge in Food during recent window
    const dupExpense: EngineExpense = {
      id: 'dup_swiggy_2',
      spentOn: '2026-10-20',
      amountPaise: 45000,
      category: 'Food',
      merchant: 'Swiggy',
      kind: 'spend',
    };

    const allExpenses = [...baseline, ...recent, outlierExpense, dupExpense];

    // Compute drift with exclusions
    const { insights } = analyzeCategoryDrift(allExpenses, now, {
      outlierExpenseIds: new Set(['outlier_catering_1']),
      duplicateExpenseIds: new Set(['dup_swiggy_2']),
    });

    const foodDrift = insights.find((i) => i.id.includes('Food'));
    expect(foodDrift).toBeDefined();

    const ev = foodDrift!.evidence as Record<string, unknown>;
    // Median of Punjab Grill (3 meals @ ~400 = ₹1,215/wk = 121500 paise)
    expect(ev.recentWeeklyMedianPaise).toBe(121500);
    // Baseline is Subway (3 meals @ 250 = ₹750/wk = 75000 paise)
    expect(ev.priorWeeklyMedianPaise).toBe(75000);
    // Outlier (₹50,000) was successfully excluded!
    expect(ev.recentWeeklyMedianPaise).toBeLessThan(200000);
  });

  it('4b: includes top 2 merchants by rupees added as drivers in drift evidence', () => {
    const baseline = createBaselineMeals(); // Subway ₹750/wk
    const recent = createRecentDining(); // Punjab Grill ~₹1,215/wk

    // Add another merchant with smaller increase
    for (let w = 0; w < 4; w++) {
      const d = new Date(new Date(now).getTime() - (w * 7 + 1) * 86400000).toISOString().slice(0, 10);
      recent.push({
        id: `tea_${w}`,
        spentOn: d,
        amountPaise: 20000, // ₹200/wk
        category: 'Food',
        merchant: 'Blue Tokai',
        kind: 'spend',
      });
    }

    const { insights } = analyzeCategoryDrift([...baseline, ...recent], now);
    const foodDrift = insights.find((i) => i.id.includes('Food'));
    expect(foodDrift).toBeDefined();

    const drivers = (foodDrift!.evidence as Record<string, unknown>)?.drivers as Array<{ merchant: string; rupeesAddedPaise: number }>;
    expect(drivers).toBeDefined();
    expect(drivers.length).toBeLessThanOrEqual(2);
    expect(drivers[0].merchant).toBe('Punjab Grill');
    expect(drivers[0].rupeesAddedPaise).toBeGreaterThan(100000); // > ₹1,000/wk added
  });

  it('4c: deduplicates small leak explaining >= 50% of category drift, keeping duplicate separate', () => {
    const baseline = createBaselineMeals();
    const recent = createRecentDining();

    // Add 25 Chaayos visits in 30 days @ ₹120 (total ₹3,000, ~₹750/wk in Food)
    const chaayosExpenses: EngineExpense[] = [];
    for (let i = 0; i < 25; i++) {
      const d = new Date(new Date(now).getTime() - (i + 1) * 86400000).toISOString().slice(0, 10);
      chaayosExpenses.push({
        id: `chaayos_${i}`,
        spentOn: d,
        amountPaise: 12000, // ₹120
        category: 'Food',
        merchant: 'Chaayos',
        kind: 'spend',
      });
    }

    // Add a duplicate charge today
    const duplicateExpenses: EngineExpense[] = [
      { id: 'dup_swiggy_1', spentOn: now, amountPaise: 45000, category: 'Food', merchant: 'Swiggy', kind: 'spend' },
      { id: 'dup_swiggy_2', spentOn: now, amountPaise: 45000, category: 'Food', merchant: 'Swiggy', kind: 'spend' },
    ];

    const expenses = [...baseline, ...recent, ...chaayosExpenses, ...duplicateExpenses];

    // Build mock closed days (15 closed days to clear learning gate)
    const closedDays = Array.from({ length: 15 }, (_, i) => {
      const d = new Date(new Date(now).getTime() - (i + 1) * 86400000).toISOString().slice(0, 10);
      return { day: d, status: 'logged' as const };
    });

    const output = analyzeExpenses(expenses, { now, closedDays });

    // 1. Duplicate card MUST be present
    const dupCard = (output.insights || []).find((i) => i.id.includes('outlier:') && (i.evidence as Record<string, unknown>)?.isDuplicate);
    expect(dupCard).toBeDefined();

    // 2. Drift card MUST name the driver (Chaayos)
    const driftCard = (output.insights || []).find((i) => i.type === 'drift' && i.id.includes('Food'));
    expect(driftCard).toBeDefined();
    expect(driftCard!.title).toContain('Chaayos');

    // 3. Separate small leak card for Chaayos MUST be suppressed (deduplicated)
    const separateLeakCard = (output.insights || []).find((i) => i.type === 'small_leaks' && i.id.toLowerCase().includes('chaayos'));
    expect(separateLeakCard).toBeUndefined();
  });

  it('3: non-duplicate headlines never start with "Action Needed:"', () => {
    // Generate fallback advice across multiple scenarios
    const baseAllowance: SafeToSpendAllowance = {
      dailyAllowancePaise: 100000,
      todaySpentPaise: 150000,
      weekdayAwareAllowancePaise: 100000,
      tomorrowDailyAllowancePaise: 90000,
      tomorrowWeekdayAllowancePaise: 90000,
      verdict: 'over',
      monthlyIncomePaise: 10000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 2000000,
      discretionarySpentSoFarPaise: 150000,
      remainingDiscretionaryPaise: 5850000,
      daysLeftInMonth: 10,
    };

    const mockOutput = {
      evaluatedAt: now,
      coverage: { daysClosed: 20, weeksOfHistory: 12, categoriesReady: ['Food'], categoriesLearning: [], reasons: [] },
      allowance: baseAllowance,
      insights: [
        {
          id: 'drift:Food:2026-W42',
          type: 'drift' as const,
          title: 'Food spend drifting up 40% (+₹4,000/mo)',
          impactPaise: 400000,
          confidence: 0.9,
          actionable: true,
          firstSeen: now,
          severity: 'warning' as const,
        },
      ],
      silentFlags: [],
    };

    const advice = generateFallbackAdvice(mockOutput as any);
    expect(advice.headline.startsWith('Action Needed:')).toBe(false);
  });
});
