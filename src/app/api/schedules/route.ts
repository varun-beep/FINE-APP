import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { schedules, schedulePriceHistory, expenses } from '@/db/schema';
import { createScheduleSchema } from '@/lib/validations';
import { desc } from 'drizzle-orm';
import { triggerAsyncRecompute } from '@/lib/engine/db';
import { detectRecurring } from '@/lib/engine/recurring';
import type { EngineExpense } from '@/lib/engine/types';

function calculateMonthlyEquivalentPaise(
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
  amountPaise: number
): number {
  switch (frequency) {
    case 'daily':
      return amountPaise * 30;
    case 'weekly':
      return Math.round((amountPaise * 52) / 12);
    case 'monthly':
      return amountPaise;
    case 'yearly':
      return Math.round(amountPaise / 12);
  }
}

export async function GET() {
  try {
    const allSchedules = await db
      .select()
      .from(schedules)
      .orderBy(desc(schedules.createdAt));

    const allHistory = await db
      .select()
      .from(schedulePriceHistory)
      .orderBy(desc(schedulePriceHistory.effectiveFrom));

    // Group price history by scheduleId
    const historyMap = new Map<string, typeof allHistory>();
    for (const h of allHistory) {
      if (!historyMap.has(h.scheduleId)) {
        historyMap.set(h.scheduleId, []);
      }
      historyMap.get(h.scheduleId)!.push(h);
    }

    const schedulesWithDetails = allSchedules.map((s) => ({
      ...s,
      monthlyEquivalentPaise: calculateMonthlyEquivalentPaise(s.frequency, s.amountPaise),
      priceHistory: historyMap.get(s.id) || [],
    }));

    // Find recurring suggestions from expenses history
    const allExpenses = await db.select().from(expenses);
    const engineExpenses: EngineExpense[] = allExpenses.map((e) => ({
      id: e.id,
      amountPaise: e.amountPaise,
      category: e.category,
      spentOn: e.spentOn,
      merchant: e.merchant,
      note: e.note,
    }));

    const detectedRecurring = detectRecurring(engineExpenses);
    const existingNames = new Set(allSchedules.map((s) => s.name.toLowerCase().trim()));

    // Keep suggestions for items not yet tracked as schedules
    const suggestions = detectedRecurring.filter(
      (r) => !existingNames.has(r.merchantOrNote.toLowerCase().trim())
    );

    return NextResponse.json({
      schedules: schedulesWithDetails,
      suggestions,
    });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json(
      { error: 'Internal server error while fetching schedules' },
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

    const parseResult = createScheduleSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    // 1. Insert schedule
    const [inserted] = await db
      .insert(schedules)
      .values({
        name: data.name,
        kind: data.kind,
        category: data.category,
        amountPaise: data.amount_paise,
        frequency: data.frequency,
        anchorDate: data.anchor_date,
        startDate: data.start_date,
        endDate: data.end_date ?? null,
        active: data.active ?? true,
      })
      .returning();

    // 2. Initialize price history
    await db.insert(schedulePriceHistory).values({
      scheduleId: inserted.id,
      amountPaise: data.amount_paise,
      effectiveFrom: data.start_date,
    });

    triggerAsyncRecompute();

    return NextResponse.json(
      {
        schedule: inserted,
        message: 'Commitment schedule created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json(
      { error: 'Internal server error while creating schedule' },
      { status: 500 }
    );
  }
}
