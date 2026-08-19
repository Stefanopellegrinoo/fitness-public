/**
 * Tests for Token Service
 * Tests JWT decoding, expiration tracking, and validation
 * 
 * NOTE: These tests are written for future test runner setup (vitest/jest)
 * Run with: npm test (once vitest is installed)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  decodeToken,
  isTokenExpired,
  getUserIdFromToken,
  getEmailFromToken,
  getRefreshTime,
} from './token.service';

/**
 * Helper to create test JWT tokens
 * In real scenarios, use actual JWTs from backend
 */
function createTestToken(
  exp: number,
  payload: Record<string, any> = {}
): string {
  // Note: These are not valid JWTs (no signature), just for testing decode logic
  // Real tests would use valid JWTs or mock jwt-decode
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64');
  const body = Buffer.from(
    JSON.stringify({ exp, iat: Math.floor(Date.now() / 1000), ...payload })
  ).toString('base64');
  return `${header}.${body}.fake-signature`;
}

describe('Token Service', () => {
  describe('decodeToken', () => {
    it('should decode valid token and extract exp claim', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 3600; // 1 hour
      const exp = now + expiresIn;

      const token = createTestToken(exp, { userId: 'user-123', email: 'test@example.com' });
      const tokenInfo = decodeToken(token);

      expect(tokenInfo.expiresAt).toBeDefined();
      expect(tokenInfo.isExpired).toBe(false);
      expect(tokenInfo.payload).toBeDefined();
      expect(tokenInfo.payload?.userId).toBe('user-123');
      expect(tokenInfo.payload?.email).toBe('test@example.com');
    });

    it('should return null for empty token', () => {
      const tokenInfo = decodeToken('');

      expect(tokenInfo.expiresAt).toBeNull();
      expect(tokenInfo.expiresIn).toBeNull();
      expect(tokenInfo.isExpired).toBe(true);
      expect(tokenInfo.payload).toBeNull();
    });

    it('should handle malformed tokens gracefully', () => {
      const tokenInfo = decodeToken('not-a-valid-jwt');

      expect(tokenInfo.isExpired).toBe(true);
      expect(tokenInfo.payload).toBeNull();
      // Should not throw
    });

    it('should mark token as expired if exp is in the past', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now - 3600; // Expired 1 hour ago

      const token = createTestToken(exp);
      const tokenInfo = decodeToken(token);

      expect(tokenInfo.isExpired).toBe(true);
    });

    it('should calculate expiresIn correctly', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiresInSeconds = 1800; // 30 minutes
      const exp = now + expiresInSeconds;

      const token = createTestToken(exp);
      const tokenInfo = decodeToken(token);

      // Allow 1 second tolerance for test execution time
      expect(tokenInfo.expiresIn).toBeLessThanOrEqual(expiresInSeconds * 1000 + 1000);
      expect(tokenInfo.expiresIn).toBeGreaterThan(expiresInSeconds * 1000 - 2000);
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired token', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now - 3600; // Expired
      const token = createTestToken(exp);

      expect(isTokenExpired(token)).toBe(true);
    });

    it('should return false for valid token', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600; // 1 hour remaining
      const token = createTestToken(exp);

      expect(isTokenExpired(token)).toBe(false);
    });

    it('should respect buffer parameter', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 30; // 30 seconds remaining

      const token = createTestToken(exp);

      // Without buffer: not expired
      expect(isTokenExpired(token, 0)).toBe(false);

      // With 60 second buffer: expired (30s < 60s buffer)
      expect(isTokenExpired(token, 60000)).toBe(true);
    });

    it('should return true for empty token', () => {
      expect(isTokenExpired('')).toBe(true);
    });
  });

  describe('getUserIdFromToken', () => {
    it('should extract userId from token payload', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600;
      const token = createTestToken(exp, { userId: 'user-abc-123' });

      expect(getUserIdFromToken(token)).toBe('user-abc-123');
    });

    it('should return null if userId not in token', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600;
      const token = createTestToken(exp); // No userId

      expect(getUserIdFromToken(token)).toBeNull();
    });

    it('should return null for malformed token', () => {
      expect(getUserIdFromToken('invalid-token')).toBeNull();
    });
  });

  describe('getEmailFromToken', () => {
    it('should extract email from token payload', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600;
      const token = createTestToken(exp, { email: 'user@example.com' });

      expect(getEmailFromToken(token)).toBe('user@example.com');
    });

    it('should return null if email not in token', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600;
      const token = createTestToken(exp); // No email

      expect(getEmailFromToken(token)).toBeNull();
    });
  });

  describe('getRefreshTime', () => {
    it('should return time 1 minute before expiration', () => {
      const now = Date.now();
      const nowSeconds = Math.floor(now / 1000);
      const exp = nowSeconds + 3600; // 1 hour from now

      const token = createTestToken(exp);
      const refreshTime = getRefreshTime(token);

      // Should be ~59 minutes from now (3600 - 60 seconds)
      const oneMinute = 60000;
      const expectedRefreshTime = now + (3600 - 60) * 1000;

      expect(refreshTime).toBeLessThanOrEqual(expectedRefreshTime + 1000);
      expect(refreshTime).toBeGreaterThan(expectedRefreshTime - 2000);
    });

    it('should not return time in the past', () => {
      const now = Date.now();
      const nowSeconds = Math.floor(now / 1000);
      const exp = nowSeconds + 30; // 30 seconds from now

      const token = createTestToken(exp);
      const refreshTime = getRefreshTime(token);

      // Expiration is soon (30s), buffer is 60s, so refresh time should be "now"
      expect(refreshTime).toBeGreaterThanOrEqual(now);
    });

    it('should return a time at or before now for an already-expired token (refresh immediately, not null)', () => {
      // getRefreshTime() only returns null when the token has NO exp claim at
      // all (nothing to schedule against). An already-expired token still has
      // a valid exp claim, so it clamps to Date.now() via
      // Math.max(Date.now(), expiresAt - buffer) — meaning "refresh right
      // now", which is the correct signal for a proactive-refresh scheduler.
      const now = Math.floor(Date.now() / 1000);
      const exp = now - 3600; // Already expired
      const token = createTestToken(exp);

      const refreshTime = getRefreshTime(token);
      expect(refreshTime).not.toBeNull();
      expect(refreshTime).toBeLessThanOrEqual(Date.now());
      expect(refreshTime).toBeGreaterThan(Date.now() - 2000);
    });

    it('should return null for empty token', () => {
      expect(getRefreshTime('')).toBeNull();
    });
  });
});
