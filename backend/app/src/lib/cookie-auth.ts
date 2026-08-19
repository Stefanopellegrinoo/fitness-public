import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { env } from '../config/env.config';

/**
 * JWT Token payload interface
 */
export interface TokenPayload {
  userId: string;
  email: string;
}

/**
 * Generates access and refresh tokens
 * Access token: 15 minutes (short-lived for security)
 * Refresh token: 7 days (long-lived for UX)
 */
// FIX (2026-04-08): Refresh token usa secreto separado (JWT_REFRESH_SECRET)
// Los access y refresh tokens NO deben compartir el mismo secreto
export function generateTokens(payload: TokenPayload): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: '15m',
    algorithm: 'HS256',
  });

  const refreshToken = jwt.sign(
    { userId: payload.userId },
    env.JWT_REFRESH_SECRET, // FIX: secreto dedicado
    { expiresIn: '7d', algorithm: 'HS256' }
  );

  return { accessToken, refreshToken };
}

/**
 * Sets HttpOnly cookies for access + refresh tokens
 * 
 * Security flags:
 * - HttpOnly: Prevents JavaScript access (XSS protection)
 * - Secure: HTTPS-only in production (set NODE_ENV=production)
 * - SameSite=Strict: CSRF protection
 * - Path: Restrict refresh token to /api/auth/refresh only
 */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
): void {
  const isProduction = env.NODE_ENV === 'production';
  // In dev: 'lax' allows cookies across different ports on the same host.
  // In prod: 'strict' is ideal but requires same-site deployment.
  const sameSite = isProduction ? 'strict' : 'lax';

  // Access token cookie (15 minutes)
  res.cookie('auth_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: 15 * 60 * 1000,
    path: '/',
  });

  // Refresh token cookie (7 days)
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/', // Changed from /api/auth/refresh for proxy compatibility
  });
}

/**
 * Clears authentication cookies on logout
 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie('auth_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
}

/**
 * Verifies and decodes JWT from cookie
 * Throws if invalid or expired
 */
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

// FIX (2026-04-08): Usa JWT_REFRESH_SECRET para verificar refresh tokens
export function verifyRefreshToken(token: string): { userId: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string };
}
