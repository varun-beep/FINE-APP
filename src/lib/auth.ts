import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from './env';

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

interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Brute-force protection:
 * Returns whether login is allowed for an IP. Max 5 failed attempts in 10 minutes.
 */
export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxAttempts = 5;

  const entry = rateLimitMap.get(ip);
  if (!entry) return { allowed: true };

  if (now - entry.firstAttemptAt > windowMs) {
    rateLimitMap.delete(ip);
    return { allowed: true };
  }

  if (entry.attempts >= maxAttempts) {
    const remainingMs = entry.firstAttemptAt + windowMs - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  return { allowed: true };
}

/**
 * Records a failed login attempt for the given IP.
 */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.firstAttemptAt > windowMs) {
    rateLimitMap.set(ip, { attempts: 1, firstAttemptAt: now });
  } else {
    entry.attempts += 1;
  }
}

/**
 * Resets failed attempts after a successful login.
 */
export function clearRateLimit(ip: string): void {
  rateLimitMap.delete(ip);
}
