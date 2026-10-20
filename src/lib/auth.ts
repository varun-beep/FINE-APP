import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from './env';
import { db } from '@/db';
import { loginAttempts } from '@/db/schema';
import { eq, and, gte, lt, asc } from 'drizzle-orm';

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Constant-time passcode verification to prevent timing attack vulnerabilities.
 */
export function verifyPasscode(provided: string, expected: string): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (providedBuf.length !== expectedBuf.length) {
    // Constant-time dummy comparison to prevent length leak timing
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function getJwtSecretKey(): Uint8Array {
  const env = getEnv();
  return new TextEncoder().encode(env.SESSION_SECRET);
}

/**
 * Signs a 30-day JWT session token using jose HS256.
 */
export async function signSessionJwt(): Promise<string> {
  const secretKey = getJwtSecretKey();
  return new SignJWT({ auth: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey);
}

/**
 * Verifies a JWT session token using jose HS256.
 */
export async function verifySessionJwt(token: string): Promise<boolean> {
  try {
    const secretKey = getJwtSecretKey();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    return payload.auth === true;
  } catch {
    return false;
  }
}

/**
 * Hashes an IP address using HMAC-SHA256 with SESSION_SECRET.
 */
export function hashIp(ip: string, secret?: string): string {
  const hmacSecret = secret || getEnv().SESSION_SECRET;
  return crypto.createHmac('sha256', hmacSecret).update(ip).digest('hex');
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

/**
 * Serverless-safe, DB-backed login rate limiter:
 * 1. Per-IP: Max 5 failed attempts per ip_hash in 10 minutes returns 429 with Retry-After.
 * 2. Global: Max 20 failed attempts across all IPs in 1 hour returns 429 with Retry-After.
 */
export async function checkRateLimit(
  ip: string,
  customNow?: Date
): Promise<RateLimitCheckResult> {
  const now = customNow || new Date();
  const ipHash = hashIp(ip);

  // 1. Check Per-IP limit: 5 failures in trailing 10 minutes
  const ipWindowMs = 10 * 60 * 1000;
  const ipWindowStart = new Date(now.getTime() - ipWindowMs);

  const ipFailures = await db
    .select({
      id: loginAttempts.id,
      attemptedAt: loginAttempts.attemptedAt,
    })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ipHash, ipHash),
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.attemptedAt, ipWindowStart)
      )
    )
    .orderBy(asc(loginAttempts.attemptedAt));

  if (ipFailures.length >= 5) {
    const oldest = ipFailures[0].attemptedAt;
    const remainingMs = oldest.getTime() + ipWindowMs - now.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      reason: 'Too many failed login attempts for this IP',
    };
  }

  // 2. Check Global limit: 20 failures across all IPs in trailing 60 minutes
  const globalWindowMs = 60 * 60 * 1000;
  const globalWindowStart = new Date(now.getTime() - globalWindowMs);

  const globalFailures = await db
    .select({
      id: loginAttempts.id,
      attemptedAt: loginAttempts.attemptedAt,
    })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.attemptedAt, globalWindowStart)
      )
    )
    .orderBy(asc(loginAttempts.attemptedAt));

  if (globalFailures.length >= 20) {
    const oldest = globalFailures[0].attemptedAt;
    const remainingMs = oldest.getTime() + globalWindowMs - now.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      reason: 'Global login attempt rate limit reached',
    };
  }

  return { allowed: true };
}

/**
 * Records a failed login attempt in the database.
 * Also opportunistically deletes records older than 24 hours.
 */
export async function recordFailedAttempt(
  ip: string,
  customNow?: Date
): Promise<void> {
  const now = customNow || new Date();
  const ipHash = hashIp(ip);

  // Insert failed attempt
  await db.insert(loginAttempts).values({
    ipHash,
    succeeded: false,
    attemptedAt: now,
  });

  // Opportunistic cleanup of rows older than 24 hours
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  db.delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, cutoff24h))
    .catch((err) => {
      console.warn('Failed to prune old login_attempts:', err);
    });
}

/**
 * Resets failed attempts after a successful login for that ip_hash.
 */
export async function clearRateLimit(ip: string): Promise<void> {
  const ipHash = hashIp(ip);
  await db.delete(loginAttempts).where(eq(loginAttempts.ipHash, ipHash));
}
