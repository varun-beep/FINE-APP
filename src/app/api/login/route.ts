import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import {
  verifyPasscode,
  signSessionJwt,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth';
import { loginSchema } from '@/lib/validations';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // 1. Check brute-force rate limit (5 failed attempts per 10 minutes, global 20/hr)
  const rateLimitStatus = await checkRateLimit(ip);
  if (!rateLimitStatus.allowed) {
    return NextResponse.json(
      {
        error: rateLimitStatus.reason || 'Too many failed login attempts',
        message: `Too many failed attempts. Try again in ${rateLimitStatus.retryAfterSeconds} seconds.`,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitStatus.retryAfterSeconds || 600),
        },
      }
    );
  }

  // 2. Parse & validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }

  const parseResult = loginSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Validation Error',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { passcode } = parseResult.data;
  const env = getEnv();

  // 3. Constant-time passcode verification
  const isValid = verifyPasscode(passcode, env.APP_PASSCODE);

  if (!isValid) {
    await recordFailedAttempt(ip);
    return NextResponse.json(
      { error: 'Invalid passcode' },
      { status: 401 }
    );
  }

  // Clear failed attempts counter on success
  await clearRateLimit(ip);

  // 4. Generate signed JWT session
  const token = await signSessionJwt();

  // 5. Return success and set httpOnly, Secure, SameSite=Lax cookie valid 30 days
  const response = NextResponse.json({
    success: true,
    message: 'Login successful',
  });

  // Always mark Secure as required by prompt; in modern browsers http://localhost is secure context
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
