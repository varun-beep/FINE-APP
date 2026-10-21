import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { dayClosures, expenses } from '@/db/schema';
import { createDayClosureSchema } from '@/lib/validations';
import { getKolkataToday, getKolkataYesterday } from '@/lib/date';
import { addDays } from '@/lib/engine/math';
import { sql } from 'drizzle-orm';
import { triggerAsyncRecompute, getLatestEngineOutput } from '@/lib/engine/db';
import { generateDailyReview } from '@/lib/llm/service';

export async function GET() {
  try {
    const allClosures = await db.select().from(dayClosures);
    const closedSet = new Map<string, string>();
    for (const c of allClosures) {
      closedSet.set(c.day, c.status);
    }

    // Determine unclosed past days since the first recorded expense up to yesterday
    const [minResult] = await db
      .select({ minDate: sql<string>`MIN(spent_on)` })
      .from(expenses);

    const unclosedPastDays: string[] = [];
    const minDate = minResult?.minDate;
    const yesterday = getKolkataYesterday();

    if (minDate && minDate <= yesterday) {
      let curr = minDate;
      while (curr <= yesterday) {
        if (!closedSet.has(curr)) {
          unclosedPastDays.push(curr);
        }
        curr = addDays(curr, 1);
      }
    }

    // Calculate streak of consecutive closed days (logged or no_spend)
    let streak = 0;
    const today = getKolkataToday();
    const isTodayClosed =
      closedSet.get(today) === 'logged' || closedSet.get(today) === 'no_spend';

    let checkDay = isTodayClosed ? today : getKolkataYesterday();
    while (true) {
      const st = closedSet.get(checkDay);
      if (st === 'logged' || st === 'no_spend') {
        streak++;
        checkDay = addDays(checkDay, -1);
      } else {
        break;
      }
    }

    // Fetch latest engine output for allowance
    let allowance = null;
    try {
      const engineOutput = await getLatestEngineOutput(today);
      allowance = engineOutput.allowance || null;
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      closures: allClosures,
      unclosedPastDays,
      today,
      todayStatus: closedSet.get(today) || null,
      streak,
      allowance,
    });
  } catch (error) {
    console.error('Error fetching day closures:', error);
    return NextResponse.json(
      { error: 'Internal server error while fetching day closures' },
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

    const parseResult = createDayClosureSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { day, status } = parseResult.data;

    const [upserted] = await db
      .insert(dayClosures)
      .values({
        day,
        status,
        closedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dayClosures.day,
        set: {
          status,
          closedAt: new Date(),
        },
      })
      .returning();

    triggerAsyncRecompute();

    // Pregenerate daily review on day closure and cache with input summary hash
    try {
      await generateDailyReview(day, { regenerate: false });
    } catch (e) {
      console.error('Failed to generate daily review on day closure:', e);
    }

    return NextResponse.json({
      success: true,
      dayClosure: upserted,
      message: `Day ${day} recorded as ${status}`,
    });
  } catch (error) {
    console.error('Error recording day closure:', error);
    return NextResponse.json(
      { error: 'Internal server error while recording day closure' },
      { status: 500 }
    );
  }
}
