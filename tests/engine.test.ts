import { describe, it, expect } from 'vitest';
import { analyzeExpenses } from '@/lib/engine';
import type { EngineExpense, EngineBudget } from '@/lib/engine/types';
import { addDays, getWeekdayName } from '@/lib/engine/math';

describe('SpendCoach Learning Engine', () => {
  const BASE_DATE = '2026-10-20';

  // Helper to generate N expenses on D distinct days
  function generateExpenses(
    count: number,
    distinctDays: number,
    baseAmountPaise = 20000,
    category = 'Food',
    startDate = '2026-08-01'
  ): EngineExpense[] {
    const list: EngineExpense[] = [];
    for (let i = 0; i < count; i++) {
      const dayOffset = i % distinctDays;
      const spentOn = addDays(startDate, dayOffset);
      list.push({
        id: `exp-${i}`,
        amountPaise: baseAmountPaise + (i % 5) * 1000,
        category,
        spentOn,
        merchant: `Store ${i % 3}`,
      });
    }
    return list;
  }

  describe('1. Learning State Thresholds', () => {
    it('is in "learning" state when expenses < 30 even if distinct days >= 14', () => {
      const expenses = generateExpenses(29, 15);
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.status).toBe('learning');
      expect(res.learning.expensesNeeded).toBe(1);
      expect(res.learning.daysNeeded).toBe(0);
    });

    it('is in "learning" state when distinct days < 14 even if expenses >= 30', () => {
      const expenses = generateExpenses(35, 13);
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.status).toBe('learning');
      expect(res.learning.expensesNeeded).toBe(0);
      expect(res.learning.daysNeeded).toBe(1);
    });

    it('transitions to "ready" when expenses >= 30 AND distinct days >= 14', () => {
      const expenses = generateExpenses(30, 14);
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.status).toBe('ready');
      expect(res.learning.expensesNeeded).toBe(0);
      expect(res.learning.daysNeeded).toBe(0);
    });

    it('evaluates per-category status as "learning" until category has >= 8 expenses', () => {
      const expenses = [
        ...generateExpenses(30, 14, 20000, 'Food'),
        ...generateExpenses(7, 5, 15000, 'Groceries'),
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.status).toBe('ready');
      expect(res.learning.categories['Food'].status).toBe('ready');
      expect(res.learning.categories['Groceries'].status).toBe('learning');
      expect(res.learning.categories['Groceries'].expensesNeeded).toBe(1);
    });

    it('evaluates per-category status as "ready" when category has >= 8 expenses', () => {
      const expenses = [
        ...generateExpenses(30, 14, 20000, 'Food'),
        ...generateExpenses(8, 6, 15000, 'Groceries'),
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.categories['Groceries'].status).toBe('ready');
      expect(res.learning.categories['Groceries'].expensesNeeded).toBe(0);
    });
  });

  describe('2. Anomaly Invariant During Learning', () => {
    it('NEVER marks any transaction as an anomaly while overall status is "learning"', () => {
      // 25 expenses on 10 days (learning) + 1 giant 100x outlier
      const expenses = [
        ...generateExpenses(25, 10, 20000, 'Food'),
        {
          id: 'giant-outlier',
          amountPaise: 20000000, // ₹2,00,000 vs ₹200
          category: 'Food',
          spentOn: BASE_DATE,
          merchant: 'Luxury Dining',
        },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.status).toBe('learning');
      expect(res.transactionAnomalies).toHaveLength(0);
    });

    it('NEVER marks daily total as an anomaly while overall status is "learning"', () => {
      const expenses = [
        ...generateExpenses(20, 10, 20000, 'Food'),
        {
          id: 'huge-day-spend',
          amountPaise: 5000000,
          category: 'Bills',
          spentOn: BASE_DATE,
        },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.dailyAnomalies).toHaveLength(0);
    });
  });

  describe('3. Transaction Anomalies (Ready State)', () => {
    it('flags a clear outlier when score > 3.5 and amount > 1.5x median', () => {
      // 40 food expenses around ₹200 (20000 paise) + 1 outlier of ₹5000 (500000 paise)
      const expenses: EngineExpense[] = [];
      for (let i = 0; i < 40; i++) {
        expenses.push({
          id: `food-${i}`,
          amountPaise: 20000 + (i % 4) * 500, // 20000, 20500, 21000, 21500
          category: 'Food',
          spentOn: addDays(BASE_DATE, -i),
          merchant: 'Swiggy',
        });
      }

      const outlierId = 'outlier-food';
      expenses.push({
        id: outlierId,
        amountPaise: 500000, // ₹5,000 -> 25x median
        category: 'Food',
        spentOn: BASE_DATE,
        merchant: 'Taj Palace',
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.status).toBe('ready');
      expect(res.transactionAnomalies.length).toBeGreaterThanOrEqual(1);

      const flagged = res.transactionAnomalies.find((a) => a.expenseId === outlierId);
      expect(flagged).toBeDefined();
      expect(flagged?.score).toBeGreaterThan(3.5);
      expect(flagged?.ratioToMedian).toBeGreaterThan(15);
      expect(flagged?.reason).toContain('usual Food spend');
    });

    it('does NOT flag a normal spike (e.g. ₹280 when median is ₹200)', () => {
      const expenses: EngineExpense[] = [];
      for (let i = 0; i < 40; i++) {
        expenses.push({
          id: `food-${i}`,
          amountPaise: 20000 + (i % 6) * 1000,
          category: 'Food',
          spentOn: addDays(BASE_DATE, -i),
        });
      }
      // Small bump to ₹280 (28000 paise)
      expenses.push({
        id: 'normal-bump',
        amountPaise: 28000,
        category: 'Food',
        spentOn: BASE_DATE,
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      const flagged = res.transactionAnomalies.find((a) => a.expenseId === 'normal-bump');
      expect(flagged).toBeUndefined();
    });

    it('handles MAD = 0 fallback by flagging amount > 3x median', () => {
      // 35 expenses of EXACTLY 20000 paise (MAD = 0)
      const expenses: EngineExpense[] = [];
      for (let i = 0; i < 35; i++) {
        expenses.push({
          id: `ident-${i}`,
          amountPaise: 20000,
          category: 'Transport',
          spentOn: addDays(BASE_DATE, -i),
        });
      }

      // Outlier of ₹800 (80000 paise = 4x median)
      expenses.push({
        id: 'mad-zero-outlier',
        amountPaise: 80000,
        category: 'Transport',
        spentOn: BASE_DATE,
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      const flagged = res.transactionAnomalies.find((a) => a.expenseId === 'mad-zero-outlier');
      expect(flagged).toBeDefined();
      expect(flagged?.ratioToMedian).toBe(4);
    });

    it('MAD = 0 fallback does NOT flag amount <= 3x median', () => {
      const expenses: EngineExpense[] = [];
      for (let i = 0; i < 35; i++) {
        expenses.push({
          id: `ident-${i}`,
          amountPaise: 20000,
          category: 'Transport',
          spentOn: addDays(BASE_DATE, -i),
        });
      }
      // ₹500 (50000 paise = 2.5x median <= 3x)
      expenses.push({
        id: 'below-3x',
        amountPaise: 50000,
        category: 'Transport',
        spentOn: BASE_DATE,
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      const flagged = res.transactionAnomalies.find((a) => a.expenseId === 'below-3x');
      expect(flagged).toBeUndefined();
    });

    it('ensures the transaction being scored does NOT influence its own baseline', () => {
      // 35 expenses of ₹100
      const expenses: EngineExpense[] = [];
      for (let i = 0; i < 35; i++) {
        expenses.push({
          id: `base-${i}`,
          amountPaise: 10000,
          category: 'Food',
          spentOn: addDays(BASE_DATE, -i),
        });
      }

      // Massive expense of ₹10,00,000 (100000000 paise)
      expenses.push({
        id: 'isolated-huge',
        amountPaise: 100000000,
        category: 'Food',
        spentOn: BASE_DATE,
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      const flagged = res.transactionAnomalies.find((a) => a.expenseId === 'isolated-huge');
      expect(flagged).toBeDefined();
      // Baseline median must remain 10000, NOT contaminated by the 10,00,000
      expect(flagged?.medianPaise).toBe(10000);
      expect(flagged?.ratioToMedian).toBe(10000);
    });

    it('falls back to all-spend baseline when category is still learning', () => {
      // 35 Food expenses (overall ready)
      const expenses: EngineExpense[] = [];
      for (let i = 0; i < 35; i++) {
        expenses.push({
          id: `food-${i}`,
          amountPaise: 20000,
          category: 'Food',
          spentOn: addDays(BASE_DATE, -i),
        });
      }

      // Only 2 Entertainment expenses (category is learning)
      expenses.push({
        id: 'ent-1',
        amountPaise: 25000,
        category: 'Entertainment',
        spentOn: addDays(BASE_DATE, -10),
      });

      // Huge Entertainment expense ₹3,000 (300000 paise)
      expenses.push({
        id: 'ent-outlier',
        amountPaise: 300000,
        category: 'Entertainment',
        spentOn: BASE_DATE,
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      const flagged = res.transactionAnomalies.find((a) => a.expenseId === 'ent-outlier');
      expect(flagged).toBeDefined();
      expect(flagged?.baselineType).toBe('overall');
      expect(flagged?.reason).toContain('overall spend');
    });
  });

  describe('4. Daily Total Anomalies', () => {
    it('flags an abnormal daily total compared to same weekday history', () => {
      const expenses: EngineExpense[] = [];
      // 7 weeks of Tuesdays with normal spend ₹500 (50000 paise)
      // BASE_DATE '2026-10-20' is a Tuesday
      for (let w = 1; w <= 6; w++) {
        const tueDate = addDays(BASE_DATE, -w * 7);
        expenses.push({
          id: `tue-${w}`,
          amountPaise: 50000,
          category: 'Bills',
          spentOn: tueDate,
        });
        // Add other days to make overall ready
        expenses.push({
          id: `wed-${w}`,
          amountPaise: 30000,
          category: 'Food',
          spentOn: addDays(tueDate, 1),
        });
        expenses.push({
          id: `thu-${w}`,
          amountPaise: 30000,
          category: 'Food',
          spentOn: addDays(tueDate, 2),
        });
        expenses.push({
          id: `fri-${w}`,
          amountPaise: 30000,
          category: 'Food',
          spentOn: addDays(tueDate, 3),
        });
        expenses.push({
          id: `sat-${w}`,
          amountPaise: 30000,
          category: 'Food',
          spentOn: addDays(tueDate, 4),
        });
        expenses.push({
          id: `sun-${w}`,
          amountPaise: 30000,
          category: 'Food',
          spentOn: addDays(tueDate, 5),
        });
      }

      // Today's Tuesday: massive spend ₹15,000 (1500000 paise = 30x median)
      expenses.push({
        id: 'tue-huge',
        amountPaise: 1500000,
        category: 'Shopping',
        spentOn: BASE_DATE,
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      const dayFlagged = res.dailyAnomalies.find((d) => d.date === BASE_DATE);
      expect(dayFlagged).toBeDefined();
      expect(dayFlagged?.weekday).toBe('Tuesday');
      expect(dayFlagged?.baselineType).toBe('weekday');
      expect(dayFlagged?.reason).toContain('Tuesday spend');
    });

    it('falls back to all_days history when weekday has < 4 data points', () => {
      // Create 35 expenses on non-Tuesdays, plus only 2 Tuesdays
      // BASE_DATE '2026-10-20' is a Tuesday
      const expenses: EngineExpense[] = [];
      let count = 0;
      for (let i = 1; count < 32; i++) {
        const d = addDays(BASE_DATE, -i);
        if (getWeekdayName(d) !== 'Tuesday') {
          expenses.push({
            id: `non-tue-${count}`,
            amountPaise: 20000,
            category: 'Food',
            spentOn: d,
          });
          count++;
        }
      }
      // Add only 2 previous Tuesdays
      expenses.push({
        id: 'prev-tue-1',
        amountPaise: 20000,
        category: 'Food',
        spentOn: addDays(BASE_DATE, -7),
      });
      expenses.push({
        id: 'prev-tue-2',
        amountPaise: 20000,
        category: 'Food',
        spentOn: addDays(BASE_DATE, -14),
      });

      // Spike on today's Tuesday (only 2 previous Tuesdays exist < 4)
      expenses.push({
        id: 'spike-day',
        amountPaise: 200000,
        category: 'Bills',
        spentOn: BASE_DATE,
      });

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      const dayFlagged = res.dailyAnomalies.find((d) => d.date === BASE_DATE);
      expect(dayFlagged).toBeDefined();
      expect(dayFlagged?.baselineType).toBe('all_days');
    });
  });

  describe('5. Recurring Detection', () => {
    it('detects a monthly subscription (30 ± 4 days, ±10% amounts)', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'netflix-1',
          amountPaise: 64900,
          category: 'Entertainment',
          merchant: 'Netflix',
          spentOn: '2026-08-15',
        },
        {
          id: 'netflix-2',
          amountPaise: 64900,
          category: 'Entertainment',
          merchant: 'Netflix',
          spentOn: '2026-09-14', // 30 days gap
        },
        {
          id: 'netflix-3',
          amountPaise: 64900,
          category: 'Entertainment',
          merchant: 'Netflix',
          spentOn: '2026-10-14', // 30 days gap
        },
      ];

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring).toHaveLength(1);
      const sub = res.recurring[0];
      expect(sub.merchantOrNote).toBe('Netflix');
      expect(sub.interval).toBe('monthly');
      expect(sub.estimatedAmountPaise).toBe(64900);
      expect(sub.monthlyCostEstimatePaise).toBe(64900);
      expect(sub.nextExpectedDate).toBe('2026-11-13');
    });

    it('detects a weekly subscription (7 ± 1 days)', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'milk-1',
          amountPaise: 42000,
          category: 'Groceries',
          merchant: 'Country Delight',
          spentOn: '2026-09-22',
        },
        {
          id: 'milk-2',
          amountPaise: 42500,
          category: 'Groceries',
          merchant: 'Country Delight',
          spentOn: '2026-09-29', // 7 days gap
        },
        {
          id: 'milk-3',
          amountPaise: 42000,
          category: 'Groceries',
          merchant: 'Country Delight',
          spentOn: '2026-10-06', // 7 days gap
        },
        {
          id: 'milk-4',
          amountPaise: 43000,
          category: 'Groceries',
          merchant: 'Country Delight',
          spentOn: '2026-10-13', // 7 days gap
        },
      ];

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring).toHaveLength(1);
      const item = res.recurring[0];
      expect(item.interval).toBe('weekly');
      expect(item.nextExpectedDate).toBe('2026-10-20');
      // Monthly estimate ~ (42000 * 52) / 12 = 182000
      expect(item.monthlyCostEstimatePaise).toBeGreaterThan(180000);
    });

    it('detects a bi-weekly subscription (14 ± 2 days)', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'sub-1',
          amountPaise: 100000,
          category: 'Other',
          merchant: 'House Cleaner',
          spentOn: '2026-09-01',
        },
        {
          id: 'sub-2',
          amountPaise: 100000,
          category: 'Other',
          merchant: 'House Cleaner',
          spentOn: '2026-09-15', // 14 days
        },
        {
          id: 'sub-3',
          amountPaise: 100000,
          category: 'Other',
          merchant: 'House Cleaner',
          spentOn: '2026-09-29', // 14 days
        },
      ];

      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring[0]?.interval).toBe('biweekly');
    });

    it('rejects recurring if fewer than 3 occurrences', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'rent-1',
          amountPaise: 2500000,
          category: 'Rent',
          merchant: 'Landlord',
          spentOn: '2026-08-01',
        },
        {
          id: 'rent-2',
          amountPaise: 2500000,
          category: 'Rent',
          merchant: 'Landlord',
          spentOn: '2026-09-01',
        },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring).toHaveLength(0);
    });

    it('rejects recurring if amounts vary by more than ±10%', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'bill-1',
          amountPaise: 10000,
          category: 'Bills',
          merchant: 'Power Corp',
          spentOn: '2026-08-01',
        },
        {
          id: 'bill-2',
          amountPaise: 20000, // 100% higher
          category: 'Bills',
          merchant: 'Power Corp',
          spentOn: '2026-08-31',
        },
        {
          id: 'bill-3',
          amountPaise: 15000,
          category: 'Bills',
          merchant: 'Power Corp',
          spentOn: '2026-09-30',
        },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring).toHaveLength(0);
    });

    it('rejects recurring if intervals are irregular', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'c-1',
          amountPaise: 50000,
          category: 'Shopping',
          merchant: 'Bookstore',
          spentOn: '2026-08-01',
        },
        {
          id: 'c-2',
          amountPaise: 50000,
          category: 'Shopping',
          merchant: 'Bookstore',
          spentOn: '2026-08-03', // 2 days
        },
        {
          id: 'c-3',
          amountPaise: 50000,
          category: 'Shopping',
          merchant: 'Bookstore',
          spentOn: '2026-09-20', // 48 days
        },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring).toHaveLength(0);
    });

    it('normalises merchant names by stripping numbers, punctuation and casing', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'sub-1',
          amountPaise: 50000,
          category: 'Bills',
          merchant: 'Jio-Fiber #100!',
          spentOn: '2026-08-01',
        },
        {
          id: 'sub-2',
          amountPaise: 50000,
          category: 'Bills',
          merchant: 'jio fiber',
          spentOn: '2026-08-31',
        },
        {
          id: 'sub-3',
          amountPaise: 50000,
          category: 'Bills',
          merchant: 'JIOFIBER',
          spentOn: '2026-09-30',
        },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring).toHaveLength(1);
      expect(res.recurring[0].key).toBe('jiofiber');
    });

    it('groups by note when merchant is empty', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'gym-1',
          amountPaise: 150000,
          category: 'Health',
          merchant: null,
          note: 'Cult.fit Pass',
          spentOn: '2026-08-01',
        },
        {
          id: 'gym-2',
          amountPaise: 150000,
          category: 'Health',
          merchant: '',
          note: 'cult fit pass',
          spentOn: '2026-08-31',
        },
        {
          id: 'gym-3',
          amountPaise: 150000,
          category: 'Health',
          merchant: undefined,
          note: 'CultFitPass',
          spentOn: '2026-09-30',
        },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.recurring).toHaveLength(1);
      expect(res.recurring[0].key).toBe('cultfitpass');
    });
  });

  describe('6. Budget Run-Rate & Month-End Projection', () => {
    it('projects month-end spending linearly when no recurring items exist', () => {
      // On 2026-10-20 (day 20 of 31 days in October):
      // Spent ₹10,000 (1000000 paise) so far.
      // Expected projection = 1000000 * 31 / 20 = 1550000 paise (₹15,500)
      const expenses: EngineExpense[] = [
        {
          id: 'e-1',
          amountPaise: 1000000,
          category: 'Food',
          spentOn: '2026-10-10',
        },
      ];
      const res = analyzeExpenses(expenses, { now: '2026-10-20' });
      expect(res.budgetRunRate.spentSoFarPaise).toBe(1000000);
      expect(res.budgetRunRate.projectedMonthEndPaise).toBe(1550000);
    });

    it('blends recurring charges into month-end projection without multiplying them', () => {
      // In October (31 days, evaluated on day 20):
      // Recurring rent of ₹25,000 paid on Oct 1st
      // Discretionary food spend of ₹10,000 on Oct 10th
      const expenses: EngineExpense[] = [
        // 3 occurrences of rent to qualify as recurring
        {
          id: 'rent-aug',
          amountPaise: 2500000,
          category: 'Rent',
          merchant: 'Landlord',
          spentOn: '2026-08-01',
        },
        {
          id: 'rent-sep',
          amountPaise: 2500000,
          category: 'Rent',
          merchant: 'Landlord',
          spentOn: '2026-08-31',
        },
        {
          id: 'rent-oct',
          amountPaise: 2500000,
          category: 'Rent',
          merchant: 'Landlord',
          spentOn: '2026-09-30',
        },
        // Discretionary food in October
        {
          id: 'food-oct',
          amountPaise: 1000000,
          category: 'Food',
          spentOn: '2026-10-10',
        },
      ];

      const res = analyzeExpenses(expenses, { now: '2026-10-20' });
      const foodProj = res.budgetRunRate.categories.find((c) => c.category === 'Food');
      // Discretionary 1000000 * 31 / 20 = 1550000
      expect(foodProj?.projectedMonthEndPaise).toBe(1550000);
    });

    it('marks budget status "on_track" when projected is <= 85% of limit', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'e-1',
          amountPaise: 500000,
          category: 'Food',
          spentOn: '2026-10-10',
        },
      ];
      // Day 20 of 31: projected is 500000 * 31 / 20 = 775000.
      // Limit is 10,00,000. 775000 is 77.5% <= 85% -> on_track
      const budgets: EngineBudget[] = [{ category: 'Food', monthlyLimitPaise: 1000000 }];
      const res = analyzeExpenses(expenses, { now: '2026-10-20', budgets });
      const cat = res.budgetRunRate.categories.find((c) => c.category === 'Food');
      expect(cat?.budgetStatus).toBe('on_track');
    });

    it('marks budget status "warning" when projected is between 85% and 100%', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'e-1',
          amountPaise: 600000,
          category: 'Food',
          spentOn: '2026-10-20',
        },
      ];
      // Day 20 of 31: projected is 600000 * 31 / 20 = 930000.
      // Limit is 10,00,000. 930000 is 93% (> 85% and <= 100%) -> warning
      const budgets: EngineBudget[] = [{ category: 'Food', monthlyLimitPaise: 1000000 }];
      const res = analyzeExpenses(expenses, { now: '2026-10-20', budgets });
      const cat = res.budgetRunRate.categories.find((c) => c.category === 'Food');
      expect(cat?.budgetStatus).toBe('warning');
    });

    it('marks budget status "over" when projected exceeds limit', () => {
      const expenses: EngineExpense[] = [
        {
          id: 'e-1',
          amountPaise: 800000,
          category: 'Food',
          spentOn: '2026-10-20',
        },
      ];
      // Day 20 of 31: projected is 800000 * 31 / 20 = 1240000.
      // Limit is 10,00,000. 1240000 is 124% > 100% -> over
      const budgets: EngineBudget[] = [{ category: 'Food', monthlyLimitPaise: 1000000 }];
      const res = analyzeExpenses(expenses, { now: '2026-10-20', budgets });
      const cat = res.budgetRunRate.categories.find((c) => c.category === 'Food');
      expect(cat?.budgetStatus).toBe('over');
    });
  });

  describe('7. Trends (WoW and MoM)', () => {
    it('computes last 7 days vs previous 7 days percentage change', () => {
      // BASE_DATE: 2026-10-20
      // Last 7 days: [2026-10-14 to 2026-10-20]: ₹2,000
      // Prev 7 days: [2026-10-07 to 2026-10-13]: ₹1,000
      // Change = +100%
      const expenses: EngineExpense[] = [
        { id: '1', amountPaise: 200000, category: 'Food', spentOn: '2026-10-18' },
        { id: '2', amountPaise: 100000, category: 'Food', spentOn: '2026-10-10' },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.trends.last7DaysPaise).toBe(200000);
      expect(res.trends.prev7DaysPaise).toBe(100000);
      expect(res.trends.weekOverWeekPercent).toBe(100);
    });

    it('computes current month-to-date vs previous month-to-date change', () => {
      // BASE_DATE: 2026-10-20
      // Current MTD: [2026-10-01 to 2026-10-20]: ₹3,000
      // Previous MTD: [2026-09-01 to 2026-09-20]: ₹2,000
      // Change = +50%
      const expenses: EngineExpense[] = [
        { id: '1', amountPaise: 300000, category: 'Shopping', spentOn: '2026-10-05' },
        { id: '2', amountPaise: 200000, category: 'Shopping', spentOn: '2026-09-12' },
      ];
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.trends.currentMonthToDatePaise).toBe(300000);
      expect(res.trends.prevMonthToDatePaise).toBe(200000);
      expect(res.trends.monthOverMonthPercent).toBe(50);
    });
  });

  describe('8. Edge Cases & Determinism', () => {
    it('handles completely empty dataset gracefully', () => {
      const res = analyzeExpenses([], { now: BASE_DATE });
      expect(res.learning.status).toBe('learning');
      expect(res.learning.expenseCount).toBe(0);
      expect(res.transactionAnomalies).toHaveLength(0);
      expect(res.dailyAnomalies).toHaveLength(0);
      expect(res.recurring).toHaveLength(0);
      expect(res.budgetRunRate.spentSoFarPaise).toBe(0);
    });

    it('handles single-category dataset cleanly', () => {
      const expenses = generateExpenses(40, 20, 10000, 'Health');
      const res = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(res.learning.status).toBe('ready');
      expect(res.learning.categories['Health'].status).toBe('ready');
      expect(res.learning.categories['Food'].status).toBe('learning');
    });

    it('guarantees strict determinism: identical input gives identical output', () => {
      const expenses = generateExpenses(35, 16, 25000, 'Groceries');
      const out1 = analyzeExpenses(expenses, { now: BASE_DATE });
      const out2 = analyzeExpenses(expenses, { now: BASE_DATE });
      expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });
  });

  describe('9. Commitments, Day Closures & Baseline Exclusions', () => {
    it('excludes kind != "spend" and source == "schedule" from transaction-anomaly baselines and candidates', () => {
      // 35 normal food expenses of ₹200 (20000 paise)
      const normalExpenses = generateExpenses(35, 16, 20000, 'Food', '2026-09-01');

      // Add a massive scheduled gold expense (source='schedule', kind='investment')
      const scheduledGold: EngineExpense = {
        id: 'gold-1',
        amountPaise: 5000000, // ₹50,000 (huge spike if treated as spend)
        category: 'Investment',
        spentOn: '2026-10-15',
        kind: 'investment',
        source: 'schedule',
      };

      // Add a massive scheduled OTT renewal (source='schedule', kind='spend')
      const scheduledOtt: EngineExpense = {
        id: 'ott-1',
        amountPaise: 149900, // ₹1,499
        category: 'Subscriptions',
        spentOn: '2026-10-18',
        kind: 'spend',
        source: 'schedule',
      };

      const res = analyzeExpenses([...normalExpenses, scheduledGold, scheduledOtt], {
        now: BASE_DATE,
      });

      // Scheduled items must NOT be flagged as anomalies
      const flaggedIds = res.transactionAnomalies.map((a) => a.expenseId);
      expect(flaggedIds).not.toContain('gold-1');
      expect(flaggedIds).not.toContain('ott-1');
    });

    it('excludes one-off transactions from anomaly baselines and candidate alerts', () => {
      const normalExpenses = generateExpenses(35, 16, 20000, 'Food', '2026-09-01');

      // Add an intentional one-off purchase of ₹80,000 (e.g. buying a laptop)
      const oneOffExpense: EngineExpense = {
        id: 'laptop-1',
        amountPaise: 8000000,
        category: 'Shopping',
        spentOn: '2026-10-12',
        kind: 'spend',
        source: 'manual',
        oneOff: true,
      };

      const res = analyzeExpenses([...normalExpenses, oneOffExpense], {
        now: BASE_DATE,
      });

      // One-off purchase must NOT be flagged as a transaction anomaly
      const flaggedIds = res.transactionAnomalies.map((a) => a.expenseId);
      expect(flaggedIds).not.toContain('laptop-1');
    });

    it('counts only closed days with status "logged" or "no_spend", strictly excluding "skipped" days', () => {
      // 35 expenses spanning 20 dates
      const expenses = generateExpenses(35, 20, 20000, 'Food', '2026-09-01');

      // Provide closedDays where 10 are 'logged', 1 is 'no_spend', and 4 are 'skipped'
      // Total valid closed days = 10 + 1 = 11 (< 14 threshold)
      const closedDays = [
        ...Array.from({ length: 10 }, (_, i) => ({
          day: addDays('2026-09-01', i),
          status: 'logged' as const,
        })),
        {
          day: addDays('2026-09-01', 10),
          status: 'no_spend' as const,
        },
        ...Array.from({ length: 4 }, (_, i) => ({
          day: addDays('2026-09-01', 11 + i),
          status: 'skipped' as const, // Must be excluded!
        })),
      ];

      const res = analyzeExpenses(expenses, {
        now: BASE_DATE,
        closedDays,
      });

      // 11 valid closed days < 14 -> must remain in 'learning' state!
      expect(res.learning.status).toBe('learning');
      expect(res.learning.distinctDaysCount).toBe(11);
      expect(res.learning.daysNeeded).toBe(3);
    });

    it('transitions to "ready" when valid closed days (logged + no_spend) reach 14', () => {
      const expenses = generateExpenses(35, 20, 20000, 'Food', '2026-09-01');

      // 12 logged + 2 no_spend + 3 skipped = 14 valid closed days
      const closedDays = [
        ...Array.from({ length: 12 }, (_, i) => ({
          day: addDays('2026-09-01', i),
          status: 'logged' as const,
        })),
        {
          day: addDays('2026-09-01', 12),
          status: 'no_spend' as const,
        },
        {
          day: addDays('2026-09-01', 13),
          status: 'no_spend' as const,
        },
        {
          day: addDays('2026-09-01', 14),
          status: 'skipped' as const,
        },
      ];

      const res = analyzeExpenses(expenses, {
        now: BASE_DATE,
        closedDays,
      });

      expect(res.learning.status).toBe('ready');
      expect(res.learning.distinctDaysCount).toBe(14);
      expect(res.learning.daysNeeded).toBe(0);
    });

    it('adds committed schedule items due for rest of month as certain spend in budget run-rate', () => {
      // Current date is 2026-10-20. Total days in Oct = 31, elapsed = 20.
      // Spent so far on Subscriptions: 0
      const activeSchedule = {
        id: 'sched-netflix',
        name: 'Netflix',
        kind: 'subscription' as const,
        category: 'Subscriptions',
        amountPaise: 64900, // ₹649
        frequency: 'monthly' as const,
        anchorDate: '2026-01-25', // Due on 25th of month (between 20th and 31st)
        startDate: '2026-01-01',
        active: true,
      };

      const budget = [{ category: 'Subscriptions', monthlyLimitPaise: 100000 }];

      const res = analyzeExpenses([], {
        now: '2026-10-20',
        budgets: budget,
        schedules: [activeSchedule],
      });

      const subRunRate = res.budgetRunRate.categories.find(
        (c) => c.category === 'Subscriptions'
      );
      expect(subRunRate).toBeDefined();
      // Spent so far is 0, but projected month end must include the certain ₹649 upcoming charge
      expect(subRunRate?.projectedMonthEndPaise).toBe(64900);
    });
  });
});

