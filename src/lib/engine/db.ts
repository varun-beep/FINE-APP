import { db } from '@/db';
import { expenses, budgets, reviews, schedules, dayClosures, insightLog } from '@/db/schema';
import { analyzeExpenses } from './index';
import type {
  EngineOutput,
  EngineExpense,
  EngineBudget,
  EngineSchedule,
  EngineDayClosure,
  InsightLogEntry,
} from './types';
import { getKolkataToday } from '../date';
import { postDueSchedules } from '../schedules';
import { eq, desc, sql } from 'drizzle-orm';


/**
 * Loads all expenses, budgets, schedules, and day closures from the database,
 * runs the pure learning engine, and upserts the result into the reviews table.
 * Calls postDueSchedules before recomputing so state is up-to-date.
 */
export async function recomputeAndPersistEngine(targetDate?: string): Promise<EngineOutput> {
  const dateKey = targetDate || getKolkataToday();

  // 1. Post any due schedules prior to recomputing
  try {
    await postDueSchedules(dateKey);
  } catch (err) {
    console.warn('[Engine Pre-Recompute Post Due Schedules Warning]:', err);
  }

  // 2. Fetch expenses
  const allExpenses = await db
    .select()
    .from(expenses)
    .orderBy(desc(expenses.spentOn));

  const engineExpenses: EngineExpense[] = allExpenses.map((e) => ({
    id: e.id,
    amountPaise: e.amountPaise,
    category: e.category,
    spentOn: e.spentOn,
    merchant: e.merchant,
    note: e.note,
    createdAt: e.createdAt,
    kind: e.kind,
    source: e.source,
    scheduleId: e.scheduleId,
    oneOff: e.oneOff,
  }));

  // 3. Fetch budgets
  const allBudgets = await db.select().from(budgets);
  const engineBudgets: EngineBudget[] = allBudgets.map((b) => ({
    category: b.category,
    monthlyLimitPaise: b.monthlyLimitPaise,
  }));

  // 4. Fetch schedules
  const allSchedules = await db.select().from(schedules);
  const engineSchedules: EngineSchedule[] = allSchedules.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    category: s.category,
    amountPaise: s.amountPaise,
    frequency: s.frequency,
    anchorDate: s.anchorDate,
    startDate: s.startDate,
    endDate: s.endDate,
    active: s.active,
  }));

  // 5. Fetch day closures
  const allClosures = await db.select().from(dayClosures);
  const engineClosures: EngineDayClosure[] = allClosures.map((c) => ({
    day: c.day,
    status: c.status,
    closedAt: c.closedAt,
  }));

  // 5.5 Fetch insight logs
  const allLogs = await db.select().from(insightLog);
  const engineInsightLogs: InsightLogEntry[] = allLogs.map((l) => ({
    insightKey: l.insightKey,
    firstShown: l.firstShown,
    lastShown: l.lastShown,
    timesShown: l.timesShown,
    dismissed: l.dismissed,
    feedback: l.feedback as 'not_now' | 'not_useful' | 'planned' | null,
    lastImpactPaise: l.lastImpactPaise,
  }));

  // 6. Run pure engine
  const output = analyzeExpenses(engineExpenses, {
    now: dateKey,
    budgets: engineBudgets,
    schedules: engineSchedules,
    closedDays: engineClosures,
    insightLogs: engineInsightLogs,
  });

  // 6.5 Record shown insights in insight_log (only for non-safe_to_spend insights)
  try {
    for (const ins of output.insights || []) {
      if (ins.type === 'safe_to_spend') continue;

      await db
        .insert(insightLog)
        .values({
          insightKey: ins.id,
          firstShown: new Date(),
          lastShown: new Date(),
          timesShown: 1,
          dismissed: false,
          lastImpactPaise: ins.impactPaise,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: insightLog.insightKey,
          set: {
            lastShown: new Date(),
            timesShown: sql`${insightLog.timesShown} + 1`,
            lastImpactPaise: ins.impactPaise,
            updatedAt: new Date(),
          },
        });
    }
  } catch (err) {
    console.warn('[Engine Insight Log Update Warning]:', err);
  }


  // 7. Upsert snapshot into reviews table
  try {
    const adviceSummary = {
      anomalyCount: output.transactionAnomalies.length,
      dailyAnomalyCount: output.dailyAnomalies.length,
      recurringCount: output.recurring.length,
      learningStatus: output.learning.status,
      overallBudgetStatus: output.budgetRunRate.budgetStatus,
    };

    await db
      .insert(reviews)
      .values({
        reviewDate: dateKey,
        statsJson: output as unknown as Record<string, unknown>,
        adviceJson: adviceSummary as unknown as Record<string, unknown>,
        source: 'fallback',
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: reviews.reviewDate,
        set: {
          statsJson: output as unknown as Record<string, unknown>,
          adviceJson: adviceSummary as unknown as Record<string, unknown>,
          source: 'fallback',
          createdAt: new Date(),
        },
      });
  } catch (err) {
    console.error('Failed to persist engine review snapshot:', err);
  }

  return output;
}

/**
 * Triggers recompute asynchronously (non-blocking).
 * Guaranteed not to throw or interrupt the calling request.
 */
export function triggerAsyncRecompute(): void {
  recomputeAndPersistEngine().catch((err) => {
    console.error('[Async Engine Recompute Failed]:', err);
  });
}

/**
 * Retrieves the latest engine output, reading cached review if available or recomputing fresh.
 */
export async function getLatestEngineOutput(targetDate?: string): Promise<EngineOutput> {
  const dateKey = targetDate || getKolkataToday();

  try {
    const [existing] = await db
      .select()
      .from(reviews)
      .where(eq(reviews.reviewDate, dateKey))
      .limit(1);

    if (existing && existing.statsJson) {
      return existing.statsJson as unknown as EngineOutput;
    }
  } catch (err) {
    console.warn('Could not read cached review, recomputing:', err);
  }

  return recomputeAndPersistEngine(dateKey);
}
