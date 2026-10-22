import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { insightLog } from '@/db/schema';
import { sql } from 'drizzle-orm';

/**
 * POST /api/insights/seen
 * Increments insight_log.times_shown ONLY when client reports an insight was rendered.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawKeys = Array.isArray(body?.ids)
      ? body.ids
      : body?.insightKey
      ? [body.insightKey]
      : body?.id
      ? [body.id]
      : [];

    if (rawKeys.length === 0) {
      return NextResponse.json(
        { error: 'Payload must include insightKey (string) or ids (array of insight keys)' },
        { status: 400 }
      );
    }

    const ids = rawKeys;

    const recorded: string[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !id.trim()) continue;
      const key = id.trim();
      // Do not log safe_to_spend in insight_log
      if (key.startsWith('safe_to_spend')) continue;

      await db
        .insert(insightLog)
        .values({
          insightKey: key,
          firstShown: new Date(),
          lastShown: new Date(),
          timesShown: 1,
          dismissed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: insightLog.insightKey,
          set: {
            lastShown: new Date(),
            timesShown: sql`${insightLog.timesShown} + 1`,
            updatedAt: new Date(),
          },
        });

      recorded.push(key);
    }

    return NextResponse.json({
      success: true,
      recordedCount: recorded.length,
      recorded,
    });
  } catch (err) {
    console.error('Error recording seen insights:', err);
    return NextResponse.json(
      { error: 'Internal server error recording seen insights' },
      { status: 500 }
    );
  }
}
