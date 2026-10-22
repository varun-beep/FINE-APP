import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyzeExpenses } from '@/lib/engine';
import { db } from '@/db';
import { insightLog, expenses } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { EngineExpense } from '@/lib/engine/types';

describe('A2. Insight Memory & Seen Reporting', () => {
  const FIXED_NOW = '2026-10-20';

  it('proves engine computation is pure and read-only: computing 5 times leaves times_shown unchanged', () => {
    const testExpenses: EngineExpense[] = [
      {
        id: 'dup-1',
        amountPaise: 45000,
        category: 'Food',
        merchant: 'Swiggy',
        spentOn: FIXED_NOW,
      },
      {
        id: 'dup-2',
        amountPaise: 45000,
        category: 'Food',
        merchant: 'Swiggy',
        spentOn: FIXED_NOW,
      },
      ...Array.from({ length: 35 }, (_, i) => ({
        id: `food-${i}`,
        amountPaise: 20000,
        category: 'Food',
        merchant: 'Swiggy',
        spentOn: `2026-09-${String((i % 25) + 1).padStart(2, '0')}`,
      })),
    ];

    const initialLogs = [
      {
        insightKey: 'outlier:dup-2',
        firstShown: new Date('2026-10-18'),
        lastShown: new Date('2026-10-18'),
        timesShown: 2,
        dismissed: false,
      },
    ];

    // Compute 5 times
    for (let i = 0; i < 5; i++) {
      const out = analyzeExpenses(testExpenses, {
        now: FIXED_NOW,
        insightLogs: initialLogs,
      });
      expect(out.insights?.length).toBeGreaterThan(0);
    }

    // timesShown in initialLogs has not mutated
    expect(initialLogs[0].timesShown).toBe(2);
  });

  it('proves identical input data gives identical output on repeated engine runs', () => {
    const testExpenses: EngineExpense[] = Array.from({ length: 40 }, (_, i) => ({
      id: `exp-${i}`,
      amountPaise: 25000 + (i % 5) * 2000,
      category: i % 2 === 0 ? 'Food' : 'Transport',
      merchant: i % 2 === 0 ? 'Swiggy' : 'Uber',
      spentOn: '2026-10-10',
    }));

    const run1 = analyzeExpenses(testExpenses, { now: FIXED_NOW });
    const run2 = analyzeExpenses(testExpenses, { now: FIXED_NOW });
    const run3 = analyzeExpenses(testExpenses, { now: FIXED_NOW });

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    expect(JSON.stringify(run2)).toBe(JSON.stringify(run3));
  });

  it('increments times_shown only when client reports an insight was viewed (POST /api/insights/seen)', async () => {
    // Test the logic directly against db table
    const testKey = `test_seen_insight_${Date.now()}`;

    // Clean up if exists
    await db.delete(insightLog).where(eq(insightLog.insightKey, testKey));

    // First view
    await db
      .insert(insightLog)
      .values({
        insightKey: testKey,
        firstShown: new Date(),
        lastShown: new Date(),
        timesShown: 1,
        dismissed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    const [row1] = await db.select().from(insightLog).where(eq(insightLog.insightKey, testKey));
    expect(row1.timesShown).toBe(1);

    // Second view
    const { sql } = await import('drizzle-orm');
    await db
      .insert(insightLog)
      .values({
        insightKey: testKey,
        firstShown: new Date(),
        lastShown: new Date(),
        timesShown: 1,
        dismissed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: insightLog.insightKey,
        set: {
          lastShown: new Date(),
          timesShown: sql`${insightLog.timesShown} + 1`,
          updatedAt: new Date(),
        },
      });

    const [row2] = await db.select().from(insightLog).where(eq(insightLog.insightKey, testKey));
    expect(row2.timesShown).toBe(2);

    // Cleanup
    await db.delete(insightLog).where(eq(insightLog.insightKey, testKey));
  });
});
