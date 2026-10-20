import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose/jwt/verify';

const PUBLIC_PATHS = [
  '/login',
  '/api/login',
  '/api/health',
  '/manifest.webmanifest',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/favicon.ico',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets, icon files, and exempt public endpoints
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    // If an already-authenticated user navigates to /login, redirect to /
    if (pathname === '/login') {
      const session = request.cookies.get('session')?.value;
      if (session && process.env.SESSION_SECRET) {
        try {
          const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
          const { payload } = await jwtVerify(session, secret, { algorithms: ['HS256'] });
          if (payload.auth) {
            return NextResponse.redirect(new URL('/', request.url));
          }
        } catch {
          // Token invalid, allow staying on /login
        }
      }
    }
    return NextResponse.next();
  }

  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

  const sessionToken = request.cookies.get('session')?.value;
  let isAuthenticated = isCronAuth;

  if (!isAuthenticated && sessionToken && process.env.SESSION_SECRET) {
    try {
      const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
      const { payload } = await jwtVerify(sessionToken, secret, {
        algorithms: ['HS256'],
      });
      isAuthenticated = payload.auth === true;
    } catch {
      isAuthenticated = false;
    }
  }

  if (!isAuthenticated) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static Next.js assets
     */
    '/((?!_next/static|_next/image).*)',
  ],
};
