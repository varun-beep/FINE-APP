import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, status: 'ok', db: 'ok' });
  } catch (err) {
    return NextResponse.json(
      { ok: false, status: 'error', db: 'error', error: (err as Error).message },
      { status: 503 }
    );
  }
}
