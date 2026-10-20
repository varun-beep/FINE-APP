import { db } from '@/db';
import { expenses, budgets, reviews } from '@/db/schema';
import { analyzeExpenses } from './index';
import type { EngineOutput, EngineExpense, EngineBudget } from './types';
import { getKolkataToday } from '../date';
import { eq, desc } from 'drizzle-orm';

/**
 * Loads all expenses and budgets from the database,
 * runs the pure learning engine, and upserts the result into the reviews table.
 */
export async function recomputeAndPersistEngine(targetDate?: string): Promise<EngineOutput> {
  const dateKey = targetDate || getKolkataToday();

  // 1. Fetch expenses
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
  }));

  // 2. Fetch budgets
  const allBudgets = await db.select().from(budgets);
  const engineBudgets: EngineBudget[] = allBudgets.map((b) => ({
    category: b.category,
    monthlyLimitPaise: b.monthlyLimitPaise,
  }));

  // 3. Run pure engine
  const output = analyzeExpenses(engineExpenses, {
    now: dateKey,
    budgets: engineBudgets,
  });

  // 4. Upsert snapshot into reviews table
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
