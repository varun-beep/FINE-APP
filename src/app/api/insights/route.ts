import { NextRequest, NextResponse } from 'next/server';
import { getLatestEngineOutput } from '@/lib/engine/db';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date') || undefined;

    const output = await getLatestEngineOutput(dateParam);

    return NextResponse.json(output, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Error serving insights:', error);
    return NextResponse.json(
      { error: 'Internal server error while generating insights' },
      { status: 500 }
    );
  }
}
