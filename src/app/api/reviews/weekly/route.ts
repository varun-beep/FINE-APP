import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyReview } from '@/lib/reviews/weekly';
import { getKolkataToday } from '@/lib/date';
import { jwtVerify } from 'jose/jwt/verify';

export const maxDuration = 30;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const sessionCookie = req.cookies.get('session')?.value;
  if (sessionCookie && process.env.SESSION_SECRET) {
    try {
      const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
      const { payload } = await jwtVerify(sessionCookie, secret, { algorithms: ['HS256'] });
      return payload.auth === true;
    } catch {
      return false;
    }
  }

  return false;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetDate =
      typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : getKolkataToday();
    const regenerate = body?.regenerate === true;

    const result = await generateWeeklyReview(targetDate, { regenerate });

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error generating weekly review:', error);
    return NextResponse.json(
      { error: 'Failed to generate weekly review', message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const regenerate = url.searchParams.get('regenerate') === 'true';
    const targetDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : getKolkataToday();

    const result = await generateWeeklyReview(targetDate, { regenerate });

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching weekly review:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weekly review', message: (error as Error).message },
      { status: 500 }
    );
  }
}
