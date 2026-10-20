import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { insightLog } from '@/db/schema';
import { triggerAsyncRecompute } from '@/lib/engine/db';
import { jwtVerify } from 'jose/jwt/verify';

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const sessionCookie = req.cookies.get('session')?.value;
  if (!sessionCookie || !process.env.SESSION_SECRET) return false;
  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const { payload } = await jwtVerify(sessionCookie, secret, { algorithms: ['HS256'] });
    return payload.auth === true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { insightKey, feedback } = body;

    if (!insightKey || !feedback) {
      return NextResponse.json(
        { error: 'Validation Error', message: 'insightKey and feedback are required' },
        { status: 400 }
      );
    }

    if (
      feedback !== 'not_useful' &&
      feedback !== 'already_know' &&
      feedback !== 'planned' &&
      feedback !== 'not_now'
    ) {
      return NextResponse.json(
        {
          error: 'Invalid feedback value',
          message: 'feedback must be not_useful, already_know, planned, or not_now',
        },
        { status: 400 }
      );
    }

    const [upserted] = await db
      .insert(insightLog)
      .values({
        insightKey,
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
      })
      .returning();

    triggerAsyncRecompute();

    return NextResponse.json({ success: true, log: upserted });
  } catch (error) {
    console.error('Error recording insight feedback:', error);
    return NextResponse.json(
      { error: 'Failed to record feedback', message: (error as Error).message },
      { status: 500 }
    );
  }
}
