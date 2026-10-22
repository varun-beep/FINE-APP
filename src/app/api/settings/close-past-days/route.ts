import { NextResponse } from 'next/server';
import { db } from '@/db';
import { expenses, dayClosures } from '@/db/schema';

/**
 * POST /api/settings/close-past-days
 * Explicit action for users with backfilled data:
 * Marks every past day that has at least one logged expense entry as 'logged' in day_closures,
 * allowing the learning gate to progress immediately.
 */
export async function POST() {
  try {
    // 1. Fetch all distinct spent_on dates from expenses
    const allExpenses = await db.select({ spentOn: expenses.spentOn, kind: expenses.kind }).from(expenses);
    const spendDates = new Set<string>();
    for (const exp of allExpenses) {
      if (exp.kind === 'spend' || !exp.kind) {
        spendDates.add(exp.spentOn);
      }
    }

    if (spendDates.size === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: 'No expenses found to close.',
      });
    }

    // 2. Fetch already closed days
    const existingClosures = await db.select({ day: dayClosures.day }).from(dayClosures);
    const closedSet = new Set(existingClosures.map((c) => c.day));

    // 3. Find days with entries that are not yet closed
    const datesToClose = Array.from(spendDates).filter((d) => !closedSet.has(d));

    if (datesToClose.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: 'All past days with entries are already marked as closed.',
      });
    }

    // 4. Insert day closures for these dates
    const rowsToInsert = datesToClose.map((day) => ({
      day,
      status: 'logged' as const,
      closedAt: new Date(),
    }));

    for (const row of rowsToInsert) {
      await db
        .insert(dayClosures)
        .values(row)
        .onConflictDoNothing({ target: dayClosures.day });
    }

    return NextResponse.json({
      success: true,
      count: datesToClose.length,
      message: `Successfully marked ${datesToClose.length} past days with expenses as closed.`,
    });
  } catch (err) {
    console.error('Error closing past days with entries:', err);
    return NextResponse.json(
      { error: 'Internal server error while closing past days' },
      { status: 500 }
    );
  }
}
