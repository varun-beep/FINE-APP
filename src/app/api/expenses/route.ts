import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { expenses } from '@/db/schema';
import { createExpenseSchema, expenseQuerySchema } from '@/lib/validations';
import { and, gte, lte, eq, desc } from 'drizzle-orm';
import { triggerAsyncRecompute } from '@/lib/engine/db';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const queryParams = {
      month: url.searchParams.get('month') || undefined,
      date: url.searchParams.get('date') || undefined,
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
    };

    const parseResult = expenseQuerySchema.safeParse(queryParams);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { month, date, from, to } = parseResult.data;
    const conditions = [];

    if (date) {
      conditions.push(eq(expenses.spentOn, date));
    } else if (month) {
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10);
      const startDate = `${month}-01`;
      // Calculate end date for this month
      const lastDay = new Date(year, m, 0).getDate();
      const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
      conditions.push(gte(expenses.spentOn, startDate));
      conditions.push(lte(expenses.spentOn, endDate));
    } else {
      if (from) conditions.push(gte(expenses.spentOn, from));
      if (to) conditions.push(lte(expenses.spentOn, to));
    }

    const query = db
      .select()
      .from(expenses)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));

    const results = await query;
    const totalPaise = results.reduce((acc, curr) => acc + curr.amountPaise, 0);

    return NextResponse.json({
      expenses: results,
      total_paise: totalPaise,
      count: results.length,
    });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return NextResponse.json(
      { error: 'Internal server error while fetching expenses' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
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

    const parseResult = createExpenseSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          message: 'The submitted expense data is invalid.',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    const [inserted] = await db
      .insert(expenses)
      .values({
        amountPaise: data.amount_paise,
        category: data.category,
        note: data.note ?? null,
        merchant: data.merchant ?? null,
        spentOn: data.spent_on,
      })
      .returning();

    // Trigger learning engine recompute asynchronously (non-blocking)
    triggerAsyncRecompute();

    return NextResponse.json(
      {
        expense: inserted,
        message: 'Expense created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating expense:', error);
    return NextResponse.json(
      { error: 'Internal server error while creating expense' },
      { status: 500 }
    );
  }
}
