import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { budgets } from '@/db/schema';
import { budgetSchema } from '@/lib/validations';
import { triggerAsyncRecompute } from '@/lib/engine/db';

export async function GET() {
  try {
    const allBudgets = await db.select().from(budgets);
    return NextResponse.json({ budgets: allBudgets });
  } catch (error) {
    console.error('Error fetching budgets:', error);
    return NextResponse.json(
      { error: 'Internal server error while fetching budgets' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    const parseResult = budgetSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { category, monthly_limit_paise } = parseResult.data;

    const [upserted] = await db
      .insert(budgets)
      .values({
        category,
        monthlyLimitPaise: monthly_limit_paise,
      })
      .onConflictDoUpdate({
        target: budgets.category,
        set: {
          monthlyLimitPaise: monthly_limit_paise,
        },
      })
      .returning();

    // Trigger recompute to update run-rate & status immediately
    triggerAsyncRecompute();

    return NextResponse.json({
      success: true,
      budget: upserted,
      message: 'Budget updated successfully',
    });
  } catch (error) {
    console.error('Error saving budget:', error);
    return NextResponse.json(
      { error: 'Internal server error while saving budget' },
      { status: 500 }
    );
  }
}
