import { NextRequest, NextResponse } from 'next/server';

// Route groups don't appear in URLs: app/(protected)/workout maps to /workout,
// so the matcher lists the group's children without the group name.
export const config = {
  matcher: [
    '/',
    '/workout/:path*',
    '/profile/:path*',
    '/nutrition/:path*',
    '/metrics/:path*',
    '/progress/:path*',
  ],
};

// Request-level gate for protected routes. Only checks that the HttpOnly
// `auth_token` cookie set by the backend is PRESENT — real JWT validation
// happens client-side in AuthProvider via /api/auth/me.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get('auth_token')?.value;

  if (!accessToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
