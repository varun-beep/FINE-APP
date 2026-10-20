import { NextRequest, NextResponse } from 'next/server';
import { getLatestEngineOutput, recomputeAndPersistEngine } from '@/lib/engine/db';
import { db } from '@/db';
import { insightLog, expenses } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date') || undefined;

    // Force fresh computation if requested
    const fresh = url.searchParams.get('fresh') === 'true';
    const output = fresh
      ? await recomputeAndPersistEngine(dateParam)
      : await getLatestEngineOutput(dateParam);

    return NextResponse.json(
      {
        coverage: output.coverage,
        allowance: output.allowance,
        insights: output.insights,
        silentFlags: output.silentFlags,
        // Preserving additional properties for backward compatibility
        evaluatedAt: output.evaluatedAt,
        learning: output.learning,
        transactionAnomalies: output.transactionAnomalies,
        dailyAnomalies: output.dailyAnomalies,
        recurring: output.recurring,
        budgetRunRate: output.budgetRunRate,
        trends: output.trends,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('Error serving insights:', error);
    return NextResponse.json(
      { error: 'Internal server error while generating insights' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { insightId, feedback, expenseId } = body;

    if (!insightId || !feedback) {
      return NextResponse.json(
        { error: 'insightId and feedback are required' },
        { status: 400 }
      );
    }

    if (!['not_now', 'not_useful', 'planned'].includes(feedback)) {
      return NextResponse.json(
        { error: 'Invalid feedback. Must be not_now, not_useful, or planned' },
        { status: 400 }
      );
    }

    // 1. Record feedback in insight_log
    await db
      .insert(insightLog)
      .values({
        insightKey: insightId,
        firstShown: new Date(),
        lastShown: new Date(),
        timesShown: 1,
        dismissed: true,
        feedback,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: insightLog.insightKey,
        set: {
          dismissed: true,
          feedback,
          updatedAt: new Date(),
        },
      });

    // 2. If planned, set one_off on underlying expense
    const targetExpenseId =
      expenseId ||
      (insightId.startsWith('outlier:') ? insightId.slice('outlier:'.length) : null);

    if (feedback === 'planned' && targetExpenseId) {
      await db
        .update(expenses)
        .set({ oneOff: true })
        .where(eq(expenses.id, targetExpenseId));
    }

    // 3. Recompute fresh engine output
    const updatedOutput = await recomputeAndPersistEngine();

    return NextResponse.json({
      success: true,
      message: 'Feedback recorded and engine updated',
      output: {
        coverage: updatedOutput.coverage,
        allowance: updatedOutput.allowance,
        insights: updatedOutput.insights,
        silentFlags: updatedOutput.silentFlags,
      },
    });
  } catch (error) {
    console.error('Error handling insight feedback:', error);
    return NextResponse.json(
      { error: 'Internal server error while recording feedback' },
      { status: 500 }
    );
  }
}
