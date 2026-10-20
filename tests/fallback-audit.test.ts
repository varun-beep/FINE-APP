import { describe, it, expect } from 'vitest';
import { generateFallbackAdvice } from '@/lib/llm/fallback';
import type { EngineOutput } from '@/lib/engine/types';

describe('4. Fallback Advice Audit (Strict Data Conditionality)', () => {
  const baseLearning = {
    status: 'ready' as const,
    expenseCount: 40,
    distinctDaysCount: 20,
    expenseThreshold: 30,
    distinctDaysThreshold: 14,
    expensesNeeded: 0,
    daysNeeded: 0,
    categories: {},
  };

  const baseTrends = {
    last7DaysPaise: 200000,
    prev7DaysPaise: 200000,
    weekOverWeekPercent: 0,
    currentMonthToDatePaise: 500000,
    prevMonthToDatePaise: 500000,
    monthOverMonthPercent: 0,
    categories: [],
  };

  it('handles over-budget condition without falsely claiming on-track status', () => {
    const overBudgetOutput: EngineOutput = {
      learning: baseLearning,
      transactionAnomalies: [],
      dailyAnomalies: [],
      recurring: [],
      budgetRunRate: {
        spentSoFarPaise: 1500000, // ₹15,000
        projectedMonthEndPaise: 2500000,
        monthlyLimitPaise: 1000000, // ₹10,000
        budgetStatus: 'over',
        percentageUsed: 150,
        projectedPercentage: 250,
        categories: [
          {
            category: 'Food',
            spentSoFarPaise: 1500000,
            projectedMonthEndPaise: 2500000,
            monthlyLimitPaise: 1000000,
            budgetStatus: 'over',
            percentageUsed: 150,
            projectedPercentage: 250,
          },
        ],
      },
      trends: baseTrends,
      evaluatedAt: '2026-10-20',
    };

    const advice = generateFallbackAdvice(overBudgetOutput);

    expect(advice.mood).toBe('careful');
    expect(advice.headline.toLowerCase()).toContain('exceeded');
    // Must NOT say on budget
    const serialized = JSON.stringify(advice);
    expect(serialized).not.toContain('comfortably on budget');
    // Must mention overage in watch_out
    expect(advice.watch_out.some((w) => w.includes('exceeded') && w.includes('₹10,000.00'))).toBe(true);
  });

  it('handles no budgets set condition without falsely claiming on-budget status', () => {
    const noBudgetsOutput: EngineOutput = {
      learning: baseLearning,
      transactionAnomalies: [],
      dailyAnomalies: [],
      recurring: [],
      budgetRunRate: {
        spentSoFarPaise: 300000,
        projectedMonthEndPaise: 600000,
        monthlyLimitPaise: null, // No overall budget limit set
        budgetStatus: 'on_track',
        percentageUsed: null,
        projectedPercentage: null,
        categories: [
          {
            category: 'Shopping',
            spentSoFarPaise: 300000,
            projectedMonthEndPaise: 600000,
            monthlyLimitPaise: null, // No category budget set
            budgetStatus: 'on_track',
            percentageUsed: null,
            projectedPercentage: null,
          },
        ],
      },
      trends: baseTrends,
      evaluatedAt: '2026-10-20',
    };

    const advice = generateFallbackAdvice(noBudgetsOutput);

    // When no budgets are set, it must never claim spending is "on budget"
    expect(advice.went_well.some((w) => w.includes('on budget'))).toBe(false);
    expect(advice.went_well.some((w) => w.includes('Shopping'))).toBe(true);
    expect(advice.watch_out.length).toBe(0);
    expect(advice.headline).toBe('Spending is steady and tracking within normal boundaries');
  });

  it('handles single category dataset and only references categories with recorded data', () => {
    const singleCategoryOutput: EngineOutput = {
      learning: baseLearning,
      transactionAnomalies: [],
      dailyAnomalies: [],
      recurring: [],
      budgetRunRate: {
        spentSoFarPaise: 40000,
        projectedMonthEndPaise: 80000,
        monthlyLimitPaise: null,
        budgetStatus: 'on_track',
        percentageUsed: null,
        projectedPercentage: null,
        categories: [
          {
            category: 'Transport',
            spentSoFarPaise: 40000,
            projectedMonthEndPaise: 80000,
            monthlyLimitPaise: null,
            budgetStatus: 'on_track',
            percentageUsed: null,
            projectedPercentage: null,
          },
          {
            category: 'Food',
            spentSoFarPaise: 0, // No spend in Food
            projectedMonthEndPaise: 0,
            monthlyLimitPaise: null,
            budgetStatus: 'on_track',
            percentageUsed: null,
            projectedPercentage: null,
          },
        ],
      },
      trends: baseTrends,
      evaluatedAt: '2026-10-20',
    };

    const advice = generateFallbackAdvice(singleCategoryOutput);

    // Must mention Transport
    expect(advice.went_well.some((w) => w.includes('Transport'))).toBe(true);
    // Must NOT mention Food or food delivery because Food had 0 spend
    const serialized = JSON.stringify(advice);
    expect(serialized).not.toContain('Food');
    expect(serialized).not.toContain('food delivery');
  });

  it('handles dataset with no anomalies and explicitly celebrates stability', () => {
    const noAnomaliesOutput: EngineOutput = {
      learning: baseLearning,
      transactionAnomalies: [],
      dailyAnomalies: [],
      recurring: [
        {
          id: 'rec-1',
          key: 'metro',
          category: 'Transport',
          merchantOrNote: 'Metro Card Pass',
          interval: 'weekly',
          intervalDays: 7,
          occurrenceCount: 4,
          estimatedAmountPaise: 20000,
          monthlyCostEstimatePaise: 80000,
          lastSpentOn: '2026-10-20',
          nextExpectedDate: '2026-10-27',
        },
      ],
      budgetRunRate: {
        spentSoFarPaise: 80000,
        projectedMonthEndPaise: 160000,
        monthlyLimitPaise: 300000,
        budgetStatus: 'on_track',
        percentageUsed: 27,
        projectedPercentage: 53,
        categories: [
          {
            category: 'Transport',
            spentSoFarPaise: 80000,
            projectedMonthEndPaise: 160000,
            monthlyLimitPaise: 300000,
            budgetStatus: 'on_track',
            percentageUsed: 27,
            projectedPercentage: 53,
          },
        ],
      },
      trends: baseTrends,
      evaluatedAt: '2026-10-20',
    };

    const advice = generateFallbackAdvice(noAnomaliesOutput);

    expect(advice.mood).toBe('good');
    expect(advice.went_well).toContain('No anomalous spending spikes were detected in recent transactions.');
    expect(advice.watch_out.length).toBe(0);
    expect(advice.saving_ideas[0]).toContain('Metro Card Pass');
  });
});
