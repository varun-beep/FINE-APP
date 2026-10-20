import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  dueDates,
  getEffectivePrice,
  postDueSchedules,
  scheduleKindToExpenseKind,
  type ScheduleLike,
} from '@/lib/schedules';
import { db } from '@/db';
import { expenses, schedules, schedulePriceHistory } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';

describe('Schedule Posting & Due Dates Engine', () => {
  describe('1. Pure dueDates() generator', () => {
    it('handles month-end clamping for a 31st anchor date in February and 30-day months', () => {
      // In 2026 (non-leap year, Feb has 28 days)
      const sched: ScheduleLike = {
        name: 'Netflix',
        frequency: 'monthly',
        anchorDate: '2026-01-31',
        startDate: '2026-01-01',
        active: true,
      };

      const dates = dueDates(sched, '2026-01-01', '2026-04-30');
      // Should post on:
      // Jan 31 (31)
      // Feb 28 (clamped from 31)
      // Mar 31 (31)
      // Apr 30 (clamped from 31)
      expect(dates).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
      ]);
    });

    it('clamps 31st in leap year February to February 29th', () => {
      const sched: ScheduleLike = {
        name: 'Gym',
        frequency: 'monthly',
        anchorDate: '2024-01-31',
        startDate: '2024-02-01',
        active: true,
      };

      const dates = dueDates(sched, '2024-02-01', '2024-02-29');
      expect(dates).toEqual(['2024-02-29']);
    });

    it('generates 10 rows for daily gold over a 10-day gap', () => {
      const sched: ScheduleLike = {
        name: 'Daily gold investment',
        kind: 'investment',
        frequency: 'daily',
        anchorDate: '2026-03-01',
        startDate: '2026-03-01',
        active: true,
      };

      const dates = dueDates(sched, '2026-03-01', '2026-03-11');
      // fromExclusive 2026-03-01 through 2026-03-11 is 10 days: 02, 03, 04, 05, 06, 07, 08, 09, 10, 11
      expect(dates.length).toBe(10);
      expect(dates[0]).toBe('2026-03-02');
      expect(dates[9]).toBe('2026-03-11');
    });

    it('posts yearly schedule on the exact annual anniversary', () => {
      const sched: ScheduleLike = {
        name: 'Amazon Prime',
        frequency: 'yearly',
        anchorDate: '2024-10-15',
        startDate: '2025-01-01',
        active: true,
      };

      const dates = dueDates(sched, '2025-01-01', '2027-12-31');
      expect(dates).toEqual(['2025-10-15', '2026-10-15', '2027-10-15']);
    });

    it('never posts before startDate or after endDate', () => {
      const sched: ScheduleLike = {
        name: 'Temporary Project',
        frequency: 'daily',
        anchorDate: '2026-05-01',
        startDate: '2026-05-05',
        endDate: '2026-05-08',
        active: true,
      };

      const dates = dueDates(sched, '2026-05-01', '2026-05-20');
      expect(dates).toEqual([
        '2026-05-05',
        '2026-05-06',
        '2026-05-07',
        '2026-05-08',
      ]);
    });

    it('returns empty array for paused / inactive schedules', () => {
      const sched: ScheduleLike = {
        name: 'Paused Spotify',
        frequency: 'monthly',
        anchorDate: '2026-01-10',
        startDate: '2026-01-01',
        active: false,
      };

      const dates = dueDates(sched, '2026-01-01', '2026-04-30');
      expect(dates).toEqual([]);
    });

    it('respects price changes effective mid-month using getEffectivePrice()', () => {
      const history = [
        { amountPaise: 19900, effectiveFrom: '2026-01-01' },
        { amountPaise: 29900, effectiveFrom: '2026-03-15' },
      ];

      // Date before change: 14 March 2026
      expect(getEffectivePrice(history, 19900, '2026-03-14')).toBe(19900);
      // Date on effective date: 15 March 2026
      expect(getEffectivePrice(history, 19900, '2026-03-15')).toBe(29900);
      // Date after change: 20 March 2026
      expect(getEffectivePrice(history, 19900, '2026-03-20')).toBe(29900);
    });

    it('maps schedule kinds to appropriate expense kinds', () => {
      expect(scheduleKindToExpenseKind('subscription')).toBe('spend');
      expect(scheduleKindToExpenseKind('bill')).toBe('spend');
      expect(scheduleKindToExpenseKind('emi')).toBe('spend');
      expect(scheduleKindToExpenseKind('investment')).toBe('investment');
      expect(scheduleKindToExpenseKind('income')).toBe('income');
    });
  });

  describe('2. Database postDueSchedules() idempotency & posting', () => {
    let testScheduleId: string;

    beforeEach(async () => {
      // Clean up any test schedules
      await db.delete(schedules).where(sql`name LIKE 'TEST_%'`);
    });

    afterEach(async () => {
      if (testScheduleId) {
        await db.delete(expenses).where(eq(expenses.scheduleId, testScheduleId));
        await db.delete(schedules).where(eq(schedules.id, testScheduleId));
      }
      await db.delete(schedules).where(sql`name LIKE 'TEST_%'`);
    });

    it('posts daily gold over a 5-day gap and running twice adds 0 duplicate rows (idempotency)', async () => {
      const [sched] = await db
        .insert(schedules)
        .values({
          name: 'TEST_DailyGold',
          kind: 'investment',
          category: 'Investment',
          amountPaise: 50000, // ₹500
          frequency: 'daily',
          anchorDate: '2026-03-01',
          startDate: '2026-03-01',
          active: true,
          lastPostedThrough: '2026-03-01',
        })
        .returning();
      testScheduleId = sched.id;

      // 1. Post through 2026-03-06 (5 days: 02, 03, 04, 05, 06)
      const res1 = await postDueSchedules('2026-03-06');
      expect(res1.postedCount).toBe(5);

      const createdExpenses = await db
        .select()
        .from(expenses)
        .where(eq(expenses.scheduleId, sched.id));
      expect(createdExpenses.length).toBe(5);
      expect(createdExpenses[0].source).toBe('schedule');
      expect(createdExpenses[0].kind).toBe('investment');

      // 2. Run postDueSchedules a SECOND time for the same date window -> Idempotent!
      const res2 = await postDueSchedules('2026-03-06');
      expect(res2.postedCount).toBe(0);

      const afterSecondRun = await db
        .select()
        .from(expenses)
        .where(eq(expenses.scheduleId, sched.id));
      expect(afterSecondRun.length).toBe(5); // No duplicates
    });
  });
});
