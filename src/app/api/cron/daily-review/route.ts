import { NextRequest, NextResponse } from 'next/server';
import { generateDailyReview } from '@/lib/llm/service';
import { getKolkataToday } from '@/lib/date';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing CRON_SECRET bearer token' },
      { status: 401 }
    );
  }

  try {
    const today = getKolkataToday();
    const result = await generateDailyReview(today, { regenerate: true });

    return NextResponse.json({
      success: true,
      date: result.date,
      source: result.source,
      mood: result.advice.mood,
      isLearning: result.isLearning,
    });
  } catch (error) {
    console.error('Error during cron daily-review generation:', error);
    return NextResponse.json(
      { error: 'Cron review generation failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}
