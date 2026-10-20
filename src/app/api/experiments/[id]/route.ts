import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments } from '@/db/schema';
import { eq } from 'drizzle-orm';
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { status } = body;

    if (status !== 'active' && status !== 'completed' && status !== 'abandoned') {
      return NextResponse.json(
        { error: 'Invalid status', message: 'Status must be active, completed, or abandoned' },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(experiments)
      .set({ status })
      .where(eq(experiments.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Not Found', message: 'Experiment not found' }, { status: 404 });
    }

    triggerAsyncRecompute();

    return NextResponse.json({ experiment: updated });
  } catch (error) {
    console.error('Error updating experiment:', error);
    return NextResponse.json(
      { error: 'Failed to update experiment', message: (error as Error).message },
      { status: 500 }
    );
  }
}
