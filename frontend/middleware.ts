/**
 * Next.js Middleware for Route Protection
 * Validates access tokens for protected routes at the request level
 * Redirects unauthenticated requests to /login with a redirect parameter
 *
 * FIX #1 (2026-04-08): Cookie name corregido de 'accessToken' → 'auth_token'
 * FIX #2 (2026-04-08): Matchers corregidos — los grupos de ruta (protected) en Next.js
 *   NO incluyen el nombre del grupo en la URL. app/(protected)/workout → /workout
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Protected route matcher configuration
 * Rutas bajo app/(protected)/* mapean sin el prefijo del grupo:
 *   app/(protected)/workout → /workout
 *   app/(protected)/profile → /profile
 *   etc.
 */
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

/**
 * Middleware function
 * Checks for valid auth_token in request cookies (HttpOnly cookie set by backend)
 * If missing, redirects to /login with original path as redirect param
 *
 * NOTE: Solo verifica PRESENCIA del cookie, no su validez.
 * La validación JWT real ocurre en el AuthProvider (client-side) via /api/auth/me
 *
 * @param request - NextRequest object containing cookies, headers, and pathname
 * @returns NextResponse: allow request to proceed OR redirect to /login
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // FIX: El backend setea 'auth_token', no 'accessToken'
  const accessToken = request.cookies.get('auth_token')?.value;

  if (!accessToken) {
    // No token found - redirect to login with original path as redirect param
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Token exists - allow request to proceed
  // El AuthProvider validará el token llamando a /api/auth/me
  return NextResponse.next();
}
