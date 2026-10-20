import { describe, it, expect, beforeEach } from 'vitest';
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

describe('Security Review: Route Protection & Middleware Enforcement', () => {
  const SESSION_SECRET = 'spendcoach_super_secure_session_secret_at_least_32_bytes_long!';
  const CRON_SECRET = 'spendcoach_cron_secret_example';

  beforeEach(() => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    process.env.CRON_SECRET = CRON_SECRET;
  });

  async function createValidSessionToken(): Promise<string> {
    const secret = new TextEncoder().encode(SESSION_SECRET);
    return new SignJWT({ auth: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(secret);
  }

  // 1. App Pages Protection (All private pages must redirect to /login when unauthenticated)
  const protectedPages = ['/', '/history', '/insights', '/review'];

  describe('Protected App Pages', () => {
    protectedPages.forEach((path) => {
      it(`redirects unauthenticated request to /login for page: ${path}`, async () => {
        const req = new NextRequest(new URL(`http://localhost:3000${path}`));
        const res = await middleware(req);

        expect(res.status).toBe(307); // NextResponse.redirect
        const location = res.headers.get('location') || '';
        expect(location).toContain('/login');
      });

      it(`allows authenticated request to page: ${path}`, async () => {
        const token = await createValidSessionToken();
        const req = new NextRequest(new URL(`http://localhost:3000${path}`), {
          headers: {
            cookie: `session=${token}`,
          },
        });
        const res = await middleware(req);

        // NextResponse.next() returns status 200 with x-middleware-next header
        expect(res.headers.get('x-middleware-next')).toBe('1');
      });
    });
  });

  // 2. Protected API Endpoints (Must return HTTP 401 when unauthenticated)
  const protectedApiRoutes = [
    '/api/expenses',
    '/api/expenses/123e4567-e89b-12d3-a456-426614174000',
    '/api/budgets',
    '/api/insights',
    '/api/daily-review',
    '/api/cron/daily-review',
    '/api/logout',
  ];

  describe('Protected API Routes', () => {
    protectedApiRoutes.forEach((path) => {
      it(`blocks unauthenticated request with 401 for API route: ${path}`, async () => {
        const req = new NextRequest(new URL(`http://localhost:3000${path}`));
        const res = await middleware(req);

        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.error).toBe('Unauthorized');
      });

      it(`allows authenticated request with session cookie for API route: ${path}`, async () => {
        const token = await createValidSessionToken();
        const req = new NextRequest(new URL(`http://localhost:3000${path}`), {
          headers: {
            cookie: `session=${token}`,
          },
        });
        const res = await middleware(req);

        expect(res.headers.get('x-middleware-next')).toBe('1');
      });
    });
  });

  // 3. Public Allow-List Routes (Must be accessible without authentication)
  const publicRoutes = [
    '/login',
    '/api/login',
    '/api/health',
    '/manifest.webmanifest',
    '/manifest.json',
    '/apple-touch-icon.png',
    '/favicon.ico',
  ];

  describe('Public Allow-List Routes', () => {
    publicRoutes.forEach((path) => {
      it(`allows unauthenticated access to public route: ${path}`, async () => {
        const req = new NextRequest(new URL(`http://localhost:3000${path}`));
        const res = await middleware(req);

        expect(res.status).not.toBe(401);
        expect(res.headers.get('location')).toBeNull(); // No redirect away
        expect(res.headers.get('x-middleware-next')).toBe('1');
      });
    });
  });

  // 4. CRON Bearer Authorization
  describe('Cron Bearer Authorization', () => {
    it('allows CRON_SECRET bearer token for cron endpoint', async () => {
      const req = new NextRequest(new URL('http://localhost:3000/api/cron/daily-review'), {
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
        },
      });
      const res = await middleware(req);

      expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    it('rejects invalid bearer token with 401', async () => {
      const req = new NextRequest(new URL('http://localhost:3000/api/cron/daily-review'), {
        headers: {
          authorization: 'Bearer wrong_secret',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(401);
    });
  });
});
