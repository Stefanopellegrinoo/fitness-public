/**
 * Token Service
 * Handles JWT decoding, expiration tracking, and token validation
 * Uses jwt-decode library to extract claims without signature verification
 */

import { jwtDecode } from 'jwt-decode';

/**
 * Decoded JWT payload structure
 */
interface JWTPayload {
  exp?: number; // Unix timestamp in seconds
  iat?: number; // Unix timestamp in seconds
  userId?: string;
  email?: string;
  [key: string]: any;
}

/**
 * Token info structure returned after decoding
 */
export interface TokenInfo {
  expiresAt: number | null; // Unix timestamp in milliseconds
  expiresIn: number | null; // Milliseconds until expiration
  isExpired: boolean;
  payload: JWTPayload | null;
}

/**
 * Decode JWT and extract claims
 * Returns null payload if decoding fails (malformed token)
 * @param token - JWT token string
 * @returns TokenInfo with expiration details
 */
export function decodeToken(token: string): TokenInfo {
  if (!token) {
    return {
      expiresAt: null,
      expiresIn: null,
      isExpired: true,
      payload: null,
    };
  }

  try {
    const payload = jwtDecode<JWTPayload>(token);

    // Extract exp claim (seconds) and convert to milliseconds
    const expSeconds = payload.exp;
    const expiresAt = expSeconds ? expSeconds * 1000 : null;

    // Calculate time remaining
    const now = Date.now();
    const expiresIn = expiresAt ? Math.max(0, expiresAt - now) : null;
    const isExpired = expiresIn !== null ? expiresIn <= 0 : true;

    return {
      expiresAt,
      expiresIn,
      isExpired,
      payload,
    };
  } catch (error) {
    // Malformed token or decode error
    console.warn('Failed to decode token:', error);
    return {
      expiresAt: null,
      expiresIn: null,
      isExpired: true,
      payload: null,
    };
  }
}

/**
 * Check if token is expired
 * Includes optional buffer (default 0) to check if expires soon
 * @param token - JWT token string
 * @param bufferMs - Milliseconds to add as buffer (e.g., 60000 for 1 minute)
 * @returns boolean - true if token is expired or will expire within buffer
 */
export function isTokenExpired(token: string, bufferMs: number = 0): boolean {
  const tokenInfo = decodeToken(token);

  if (tokenInfo.expiresAt === null) {
    // No expiration found - treat as expired
    return true;
  }

  // Token is expired if expiration time minus buffer is in the past.
  // NOTE: must compare against `expiresAt` (raw, unclamped), not
  // `expiresIn` — decodeToken() clamps expiresIn to Math.max(0, ...), so an
  // already-expired token always has expiresIn === 0. Comparing
  // `expiresIn < bufferMs` with the default bufferMs of 0 then evaluates
  // `0 < 0`, which is always false, so already-expired tokens were never
  // detected as expired.
  return tokenInfo.expiresAt - bufferMs <= Date.now();
}

/**
 * Extract userId from token (if present)
 * @param token - JWT token string
 * @returns userId or null if not found
 */
export function getUserIdFromToken(token: string): string | null {
  const tokenInfo = decodeToken(token);
  return tokenInfo.payload?.userId || null;
}

/**
 * Extract email from token (if present)
 * @param token - JWT token string
 * @returns email or null if not found
 */
export function getEmailFromToken(token: string): string | null {
  const tokenInfo = decodeToken(token);
  return tokenInfo.payload?.email || null;
}

/**
 * Calculate refresh time (expiration minus 1 minute buffer)
 * Used for proactive token refresh scheduling
 * @param token - JWT token string
 * @returns Unix timestamp in milliseconds when refresh should occur, or null
 */
export function getRefreshTime(token: string): number | null {
  const tokenInfo = decodeToken(token);

  if (tokenInfo.expiresAt === null) {
    return null;
  }

  // Refresh 1 minute (60000 ms) before actual expiration
  const refreshBuffer = 60000;
  return Math.max(Date.now(), tokenInfo.expiresAt - refreshBuffer);
}

/**
 * Token service object with all methods
 */
export const tokenService = {
  decodeToken,
  isTokenExpired,
  getUserIdFromToken,
  getEmailFromToken,
  getRefreshTime,
};
