import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { expenses, type NewExpense } from '@/db/schema';
import { updateExpenseSchema } from '@/lib/validations';
import { eq } from 'drizzle-orm';
import { triggerAsyncRecompute } from '@/lib/engine/db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid expense ID format. Expected UUID.' },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    const parseResult = updateExpenseSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          message: 'The submitted update data is invalid.',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;
    const updateValues: Partial<NewExpense> = {};

    if (data.amount_paise !== undefined) {
      updateValues.amountPaise = data.amount_paise;
    }
    if (data.category !== undefined) {
      updateValues.category = data.category;
    }
    if (data.spent_on !== undefined) {
      updateValues.spentOn = data.spent_on;
    }
    if (data.note !== undefined) {
      updateValues.note = data.note;
    }
    if (data.merchant !== undefined) {
      updateValues.merchant = data.merchant;
    }

    const [updated] = await db
      .update(expenses)
      .set(updateValues)
      .where(eq(expenses.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      );
    }

    // Trigger engine recompute non-blockingly
    triggerAsyncRecompute();

    return NextResponse.json({
      expense: updated,
      message: 'Expense updated successfully',
    });
  } catch (error) {
    console.error('Error updating expense:', error);
    return NextResponse.json(
      { error: 'Internal server error while updating expense' },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid expense ID format. Expected UUID.' },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(expenses)
      .where(eq(expenses.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      );
    }

    // Trigger engine recompute non-blockingly
    triggerAsyncRecompute();

    return NextResponse.json({
      success: true,
      message: 'Expense deleted successfully',
      deletedId: id,
    });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return NextResponse.json(
      { error: 'Internal server error while deleting expense' },
      { status: 500 }
    );
  }
}
