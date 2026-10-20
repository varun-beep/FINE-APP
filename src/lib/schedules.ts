import { db } from '@/db';
import { expenses, schedules, schedulePriceHistory } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getKolkataToday } from './date';
import { addDays, getDaysInMonth } from './engine/math';

export interface ScheduleLike {
  id?: string;
  name?: string;
  kind?: 'subscription' | 'investment' | 'bill' | 'emi' | 'income' | string;
  category?: string;
  amountPaise?: number;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  anchorDate: string; // YYYY-MM-DD
  startDate: string;  // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD
  active: boolean;
  lastPostedThrough?: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Returns UTC day of week for a YYYY-MM-DD string (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
 */
export function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Pure generator of due dates for a schedule between fromExclusive and throughInclusive.
 * Rules:
 * - Inactive schedules yield []
 * - Monthly uses anchor day-of-month clamped to the month's last day (e.g. 31st in Feb becomes 28/29)
 * - Yearly uses month+day clamped if Feb 29 on non-leap years
 * - Weekly matches anchor day of week
 * - Daily matches every day
 * - Never before startDate, never after endDate
 */
export function dueDates(
  schedule: ScheduleLike,
  fromExclusive: string,
  throughInclusive: string
): string[] {
  if (!schedule.active) return [];
  if (fromExclusive >= throughInclusive) return [];

  // Earliest candidate date is day after fromExclusive
  const rangeStart = addDays(fromExclusive, 1);
  const start = rangeStart > schedule.startDate ? rangeStart : schedule.startDate;
  const end = schedule.endDate && schedule.endDate < throughInclusive ? schedule.endDate : throughInclusive;

  if (start > end) return [];

  const results: string[] = [];

  if (schedule.frequency === 'daily') {
    let curr = start;
    while (curr <= end) {
      results.push(curr);
      curr = addDays(curr, 1);
    }
    return results;
  }

  if (schedule.frequency === 'weekly') {
    const anchorDow = getDayOfWeek(schedule.anchorDate);
    let curr = start;
    while (curr <= end) {
      if (getDayOfWeek(curr) === anchorDow) {
        results.push(curr);
      }
      curr = addDays(curr, 1);
    }
    return results;
  }

  if (schedule.frequency === 'monthly') {
    const anchorDom = parseInt(schedule.anchorDate.slice(8, 10), 10);
    const [startYear, startMonth] = start.split('-').map(Number);
    const [endYear, endMonth] = end.split('-').map(Number);

    let y = startYear;
    let m = startMonth;

    while (y < endYear || (y === endYear && m <= endMonth)) {
      const maxDays = getDaysInMonth(y, m);
      const targetDay = Math.min(anchorDom, maxDays);
      const dateStr = `${y}-${pad2(m)}-${pad2(targetDay)}`;

      if (dateStr >= start && dateStr <= end) {
        results.push(dateStr);
      }

      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return results;
  }

  if (schedule.frequency === 'yearly') {
    const anchorMonth = parseInt(schedule.anchorDate.slice(5, 7), 10);
    const anchorDom = parseInt(schedule.anchorDate.slice(8, 10), 10);
    const startYear = parseInt(start.slice(0, 4), 10);
    const endYear = parseInt(end.slice(0, 4), 10);

    for (let y = startYear; y <= endYear; y++) {
      const maxDays = getDaysInMonth(y, anchorMonth);
      const targetDay = Math.min(anchorDom, maxDays);
      const dateStr = `${y}-${pad2(anchorMonth)}-${pad2(targetDay)}`;

      if (dateStr >= start && dateStr <= end) {
        results.push(dateStr);
      }
    }
    return results;
  }

  return results;
}

/**
 * Finds the price effective on a given date from price history rows,
 * falling back to the schedule's base amountPaise.
 */
export function getEffectivePrice(
  history: { amountPaise: number; effectiveFrom: string }[],
  defaultAmountPaise: number,
  targetDate: string
): number {
  if (!history || history.length === 0) return defaultAmountPaise;

  // Filter history rows effective on or before targetDate, sort by effectiveFrom desc
  const applicable = history
    .filter((h) => h.effectiveFrom <= targetDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  if (applicable.length > 0) {
    return applicable[0].amountPaise;
  }

  return defaultAmountPaise;
}

/**
 * Maps schedule kind to expense kind ('spend' | 'investment' | 'income')
 */
export function scheduleKindToExpenseKind(
  kind: string
): 'spend' | 'investment' | 'income' {
  if (kind === 'investment') return 'investment';
  if (kind === 'income') return 'income';
  return 'spend';
}

/**
 * Posts missing due dates for all active schedules up to now.
 * Idempotent: ON CONFLICT DO NOTHING on (schedule_id, spent_on).
 */
export async function postDueSchedules(now?: string): Promise<{
  postedCount: number;
  schedulesProcessed: number;
}> {
  const nowDate = now || getKolkataToday();

  // Load all active schedules
  const activeSchedules = await db
    .select()
    .from(schedules)
    .where(eq(schedules.active, true));

  let totalPosted = 0;

  for (const sched of activeSchedules) {
    // Load price history
    const history = await db
      .select()
      .from(schedulePriceHistory)
      .where(eq(schedulePriceHistory.scheduleId, sched.id));

    const fromExclusive =
      sched.lastPostedThrough || addDays(sched.startDate, -1);

    const dates = dueDates(sched, fromExclusive, nowDate);

    for (const d of dates) {
      const price = getEffectivePrice(history, sched.amountPaise, d);
      const kind = scheduleKindToExpenseKind(sched.kind);

      try {
        await db
          .insert(expenses)
          .values({
            amountPaise: price,
            category: sched.category,
            merchant: sched.name,
            note: `Scheduled: ${sched.name}`,
            spentOn: d,
            kind,
            source: 'schedule',
            scheduleId: sched.id,
            oneOff: false,
          })
          .onConflictDoNothing();
        totalPosted++;
      } catch (err) {
        // If conflict or duplicate, safely skip
        console.warn(`[Schedule Post Warning] ${sched.name} on ${d}:`, err);
      }
    }

    // Advance lastPostedThrough to nowDate if nowDate >= sched.startDate
    if (sched.lastPostedThrough !== nowDate && nowDate >= sched.startDate) {
      await db
        .update(schedules)
        .set({ lastPostedThrough: nowDate })
        .where(eq(schedules.id, sched.id));
    }
  }

  return {
    postedCount: totalPosted,
    schedulesProcessed: activeSchedules.length,
  };
}

let lastGuardedRunMs = 0;
const GUARDED_RUN_COOLDOWN_MS = 30000; // 30 seconds

/**
 * Lightweight guarded posting for authenticated read paths.
 */
export async function guardedPostDueSchedules(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastGuardedRunMs < GUARDED_RUN_COOLDOWN_MS) {
    return;
  }
  lastGuardedRunMs = now;
  try {
    await postDueSchedules();
  } catch (err) {
    console.warn('[Guarded Schedule Post Failed]:', err);
  }
}
