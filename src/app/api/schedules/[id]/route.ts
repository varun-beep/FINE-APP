import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { schedules, schedulePriceHistory, type NewSchedule } from '@/db/schema';
import { updateScheduleSchema } from '@/lib/validations';
import { getKolkataToday } from '@/lib/date';
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
        { error: 'Invalid schedule ID format. Expected UUID.' },
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

    const parseResult = updateScheduleSchema.safeParse(body);
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

    // Fetch existing schedule
    const [existing] = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: 'Schedule not found' },
        { status: 404 }
      );
    }

    // If amount changed, append to price history with effectiveFrom date (default today)
    if (data.amount_paise !== undefined && data.amount_paise !== existing.amountPaise) {
      const effectiveFrom = data.effective_from || getKolkataToday();
      await db.insert(schedulePriceHistory).values({
        scheduleId: id,
        amountPaise: data.amount_paise,
        effectiveFrom,
      });
    }

    const updateValues: Partial<NewSchedule> = {};
    if (data.name !== undefined) updateValues.name = data.name;
    if (data.kind !== undefined) updateValues.kind = data.kind;
    if (data.category !== undefined) updateValues.category = data.category;
    if (data.amount_paise !== undefined) updateValues.amountPaise = data.amount_paise;
    if (data.frequency !== undefined) updateValues.frequency = data.frequency;
    if (data.anchor_date !== undefined) updateValues.anchorDate = data.anchor_date;
    if (data.start_date !== undefined) updateValues.startDate = data.start_date;
    if (data.end_date !== undefined) updateValues.endDate = data.end_date;
    if (data.active !== undefined) updateValues.active = data.active;

    const [updated] = await db
      .update(schedules)
      .set(updateValues)
      .where(eq(schedules.id, id))
      .returning();

    triggerAsyncRecompute();

    return NextResponse.json({
      schedule: updated,
      message: 'Schedule updated successfully',
    });
  } catch (error) {
    console.error('Error updating schedule:', error);
    return NextResponse.json(
      { error: 'Internal server error while updating schedule' },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid schedule ID format. Expected UUID.' },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(schedules)
      .where(eq(schedules.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: 'Schedule not found' },
        { status: 404 }
      );
    }

    triggerAsyncRecompute();

    return NextResponse.json({
      success: true,
      message: 'Schedule deleted successfully',
      deletedId: id,
    });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    return NextResponse.json(
      { error: 'Internal server error while deleting schedule' },
      { status: 500 }
    );
  }
}
