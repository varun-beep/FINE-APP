import { describe, it, expect, beforeEach } from 'vitest';
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import fs from 'fs';
import path from 'path';

interface DiscoveredRoute {
  pattern: string; // e.g. '/api/expenses/[id]'
  testUrl: string; // e.g. '/api/expenses/123e4567-e89b-12d3-a456-426614174000'
  filePath: string;
  isApi: boolean;
}

/**
 * Recursively scans src/app to discover every page.tsx and route.ts.
 */
function discoverAllAppRoutes(): DiscoveredRoute[] {
  const appDir = path.resolve(__dirname, '../src/app');
  const results: DiscoveredRoute[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name === 'page.tsx') {
          const rel = path.relative(appDir, currentDir);
          // Convert route groups like (marketing) if any
          const routeSegments = rel
            .split(path.sep)
            .filter((seg) => seg && !seg.startsWith('(') && !seg.endsWith(')'));
          const urlPath = routeSegments.length === 0 ? '/' : '/' + routeSegments.join('/');
          results.push({
            pattern: urlPath,
            testUrl: urlPath,
            filePath: fullPath,
            isApi: false,
          });
        } else if (entry.name === 'route.ts') {
          const rel = path.relative(appDir, currentDir);
          const routeSegments = rel
            .split(path.sep)
            .filter((seg) => seg && !seg.startsWith('(') && !seg.endsWith(')'));
          const urlPattern = '/' + routeSegments.join('/');
          // Replace dynamic segments like [id] with a valid UUID for actual testing
          const testUrl = urlPattern.replace(/\[\w+\]/g, '123e4567-e89b-12d3-a456-426614174000');
          results.push({
            pattern: urlPattern,
            testUrl,
            filePath: fullPath,
            isApi: true,
          });
        }
      }
    }
  }

  walk(appDir);
  return results;
}

describe('3. Dynamic Route Protection & Middleware Enforcement', () => {
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

  // Explicit Public Allow-List
  const PUBLIC_ALLOW_LIST = new Set([
    '/login',
    '/api/login',
    '/api/health',
    '/manifest.webmanifest',
    '/manifest.json',
    '/apple-touch-icon.png',
    '/favicon.ico',
  ]);

  // Explicit Protected Routes List
  const KNOWN_PROTECTED_ROUTES = new Set([
    '/',
    '/history',
    '/insights',
    '/review',
    '/api/expenses',
    '/api/expenses/[id]',
    '/api/budgets',
    '/api/insights',
    '/api/daily-review',
    '/api/cron/daily-review',
    '/api/logout',
  ]);

  const discovered = discoverAllAppRoutes();

  it('auto-discovers all routes and confirms none exist outside the classification sets', () => {
    expect(discovered.length).toBeGreaterThan(5);

    for (const route of discovered) {
      const isAllowed = PUBLIC_ALLOW_LIST.has(route.pattern);
      const isProtected = KNOWN_PROTECTED_ROUTES.has(route.pattern);

      expect(
        isAllowed || isProtected,
        `SECURITY VIOLATION: Discovered route "${route.pattern}" (${route.filePath}) is in neither the KNOWN_PROTECTED_ROUTES set nor the PUBLIC_ALLOW_LIST!`
      ).toBe(true);
    }
  });

  describe('Automated Test on Every Discovered Route', () => {
    discovered.forEach((route) => {
      const isPublic = PUBLIC_ALLOW_LIST.has(route.pattern);

      if (isPublic) {
        it(`[Public] allows unauthenticated access to ${route.pattern}`, async () => {
          const req = new NextRequest(new URL(`http://localhost:3000${route.testUrl}`));
          const res = await middleware(req);

          expect(res.status).not.toBe(401);
          expect(res.headers.get('location')).toBeNull();
        });
      } else {
        if (route.isApi) {
          it(`[Protected API] rejects unauthenticated request with 401 for ${route.pattern}`, async () => {
            const req = new NextRequest(new URL(`http://localhost:3000${route.testUrl}`));
            const res = await middleware(req);

            expect(res.status).toBe(401);
            const data = await res.json();
            expect(data.error).toBe('Unauthorized');
          });

          it(`[Protected API] allows authenticated request with session for ${route.pattern}`, async () => {
            const token = await createValidSessionToken();
            const req = new NextRequest(new URL(`http://localhost:3000${route.testUrl}`), {
              headers: { cookie: `session=${token}` },
            });
            const res = await middleware(req);

            expect(res.headers.get('x-middleware-next')).toBe('1');
          });
        } else {
          it(`[Protected Page] redirects unauthenticated request to /login for ${route.pattern}`, async () => {
            const req = new NextRequest(new URL(`http://localhost:3000${route.testUrl}`));
            const res = await middleware(req);

            expect(res.status).toBe(307);
            const location = res.headers.get('location') || '';
            expect(location).toContain('/login');
          });

          it(`[Protected Page] allows authenticated request with session for ${route.pattern}`, async () => {
            const token = await createValidSessionToken();
            const req = new NextRequest(new URL(`http://localhost:3000${route.testUrl}`), {
              headers: { cookie: `session=${token}` },
            });
            const res = await middleware(req);

            expect(res.headers.get('x-middleware-next')).toBe('1');
          });
        }
      }
    });
  });

  describe('Static & Cron Specific Checks', () => {
    const staticPublic = ['/manifest.webmanifest', '/manifest.json', '/apple-touch-icon.png', '/favicon.ico'];
    staticPublic.forEach((p) => {
      it(`allows public static asset: ${p}`, async () => {
        const req = new NextRequest(new URL(`http://localhost:3000${p}`));
        const res = await middleware(req);
        expect(res.status).not.toBe(401);
      });
    });

    it('allows CRON_SECRET bearer token for cron route', async () => {
      const req = new NextRequest(new URL('http://localhost:3000/api/cron/daily-review'), {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      const res = await middleware(req);
      expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    it('rejects invalid bearer token for cron route with 401', async () => {
      const req = new NextRequest(new URL('http://localhost:3000/api/cron/daily-review'), {
        headers: { authorization: 'Bearer invalid_secret' },
      });
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });
  });
});
