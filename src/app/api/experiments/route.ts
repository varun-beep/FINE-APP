import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, expenses } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getKolkataToday } from '@/lib/date';
import { addDays } from '@/lib/engine/math';
import { triggerAsyncRecompute } from '@/lib/engine/db';
import { generateExperimentProgressInsights } from '@/lib/engine/experiments';
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

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = getKolkataToday();
    const allExp = await db.select().from(experiments);
    const allExpenses = await db.select().from(expenses);

    const progressInsights = generateExperimentProgressInsights(
      allExp.map((e) => ({
        id: e.id,
        leverId: e.leverId,
        category: e.category,
        metric: e.metric,
        target: e.target,
        baseline: e.baseline,
        startDate: e.startDate,
        endDate: e.endDate,
        status: e.status,
      })),
      allExpenses.map((e) => ({
        id: e.id,
        amountPaise: e.amountPaise,
        category: e.category,
        spentOn: e.spentOn,
        kind: e.kind,
        oneOff: e.oneOff,
      })),
      today
    );

    const progressMap = new Map(progressInsights.map((p) => [p.evidence?.experimentId, p]));

    const enriched = allExp.map((e) => {
      const insight = progressMap.get(e.id);
      return {
        ...e,
        progressInsight: insight || null,
        achievedSavingPaise: insight?.evidence?.achievedSavingPaise ?? 0,
        daysRemaining: insight?.evidence?.daysRemaining ?? 0,
      };
    });

    return NextResponse.json({ experiments: enriched });
  } catch (error) {
    console.error('Error fetching experiments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch experiments', message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      leverId,
      category,
      metric = 'weekly_orders',
      target,
      baseline,
      startDate: customStart,
      durationWeeks = 4,
    } = body;

    if (!leverId || !category || !target || baseline === undefined) {
      return NextResponse.json(
        { error: 'Validation Error', message: 'leverId, category, target, and baseline are required' },
        { status: 400 }
      );
    }

    // Enforce MAXIMUM 2 active experiments cap
    const [countResult] = await db
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(experiments)
      .where(eq(experiments.status, 'active'));

    const activeCount = countResult?.activeCount ?? 0;
    if (activeCount >= 2) {
      return NextResponse.json(
        {
          error: 'Maximum Limit Reached',
          message: 'Maximum 2 active experiments allowed. Please complete or abandon an existing experiment before starting a new one.',
        },
        { status: 400 }
      );
    }

    const startDate =
      typeof customStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(customStart)
        ? customStart
        : getKolkataToday();
    const endDate = addDays(startDate, Math.max(1, durationWeeks) * 7);

    const [created] = await db
      .insert(experiments)
      .values({
        leverId,
        category,
        metric,
        target: String(target),
        baseline: Math.round(Number(baseline)),
        startDate,
        endDate,
        status: 'active',
        createdAt: new Date(),
      })
      .returning();

    triggerAsyncRecompute();

    return NextResponse.json({ experiment: created }, { status: 201 });
  } catch (error) {
    console.error('Error creating experiment:', error);
    return NextResponse.json(
      { error: 'Failed to create experiment', message: (error as Error).message },
      { status: 500 }
    );
  }
}
