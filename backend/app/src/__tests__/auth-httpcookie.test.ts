import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import * as bcrypt from 'bcrypt';

/**
 * `@types/superagent` types every response header as `string`, but Node emits
 * `Set-Cookie` as a repeated header and supertest hands it back as an array.
 * Reading `res.headers['set-cookie']` therefore lies to the compiler.
 *
 * This narrows it with a real runtime check instead of a cast, so a shape
 * change fails loudly here rather than turning `.find(...)` into a crash in
 * whichever test happens to run first.
 */
function setCookies(res: request.Response): string[] {
  const raw: unknown = res.headers['set-cookie'];

  if (!Array.isArray(raw)) {
    throw new Error(
      `expected Set-Cookie to be an array, got ${typeof raw}: ${String(raw)}`
    );
  }

  return raw.map((cookie) => {
    if (typeof cookie !== 'string') {
      throw new Error(
        `expected every Set-Cookie entry to be a string, got ${typeof cookie}`
      );
    }
    return cookie;
  });
}

/**
 * Integration tests for HttpOnly cookie-based authentication
 * Tests that JWT tokens are set in HttpOnly secure cookies instead of response body
 */
describe('HttpOnly Cookie Authentication', () => {
  // Test user data
  const testUser = {
    email: 'httpcookie.test@example.com',
    password: 'SecurePass123!',
    hashedPassword: '', // Will be set in beforeEach
  };

  beforeEach(async () => {
    // Hash test password
    testUser.hashedPassword = await bcrypt.hash(testUser.password, 10);

    // Clean up: remove test user if exists
    try {
      await prisma.user.deleteMany({
        where: { email: testUser.email },
      });
    } catch (err) {
      // Ignore if table doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up: remove test user
    try {
      await prisma.user.deleteMany({
        where: { email: testUser.email },
      });
    } catch (err) {
      // Ignore
    }
  });

  describe('POST /api/auth/login', () => {
    it('should set HttpOnly cookie on successful login', async () => {
      // Create test user
      await prisma.user.create({
        data: {
          email: testUser.email,
          password: testUser.hashedPassword,
        },
      });

      // Login
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(res.status).toBe(200);

      // Check that response does NOT contain token in body (important for security!)
      expect(res.body.token).toBeUndefined();
      expect(res.body.data?.token).toBeUndefined();

      // Check Set-Cookie header. The raw read stays so the shape itself is
      // still asserted, not just assumed by the helper.
      const rawSetCookie: unknown = res.headers['set-cookie'];
      expect(rawSetCookie).toBeDefined();
      expect(Array.isArray(rawSetCookie)).toBe(true);

      const setCookieHeader = setCookies(res);

      // Find auth_token cookie
      const authTokenCookie = setCookieHeader.find((cookie: string) =>
        cookie.startsWith('auth_token=')
      );
      expect(authTokenCookie).toBeDefined();

      // Verify HttpOnly flag
      expect(authTokenCookie).toContain('HttpOnly');

      // Verify SameSite flag: Strict in production (CSRF protection), Lax in dev
      // (lets the cookie flow across different localhost ports for the frontend).
      const expectedSameSite =
        process.env.NODE_ENV === 'production' ? 'SameSite=Strict' : 'SameSite=Lax';
      expect(authTokenCookie).toContain(expectedSameSite);

      // Verify Secure flag (in production, should be present)
      if (process.env.NODE_ENV === 'production') {
        expect(authTokenCookie).toContain('Secure');
      }

      // Verify Max-Age or Expires is set
      expect(authTokenCookie).toMatch(/(?:Max-Age|Expires)/);
    });

    it('should not accept Authorization header (only cookies)', async () => {
      // Create test user
      const user = await prisma.user.create({
        data: {
          email: testUser.email,
          password: testUser.hashedPassword,
        },
      });

      // First, login to get a token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      // Extract token from Set-Cookie header
      const setCookieHeader = setCookies(loginRes);
      const authTokenCookie = setCookieHeader.find((cookie: string) =>
        cookie.startsWith('auth_token=')
      );

      // Try to use the token in Authorization header (should NOT work)
      // The middleware should only accept HttpOnly cookies
      const tokenMatch = authTokenCookie?.match(/auth_token=([^;]+)/);
      const token = tokenMatch?.[1];

      // This should fail because auth middleware reads from cookies, not headers
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it('should accept requests with HttpOnly cookie automatically', async () => {
      // Create test user
      await prisma.user.create({
        data: {
          email: testUser.email,
          password: testUser.hashedPassword,
        },
      });

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(loginRes.status).toBe(200);

      // Extract cookie from login response
      const cookie = loginRes.headers['set-cookie'];

      // Make authenticated request using the cookie
      const res = await request(app)
        .get('/api/me')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data?.user?.email).toBe(testUser.email);
    });

    it('should reject request without HttpOnly cookie', async () => {
      const res = await request(app).get('/api/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear HttpOnly cookie on logout', async () => {
      // Create test user
      await prisma.user.create({
        data: {
          email: testUser.email,
          password: testUser.hashedPassword,
        },
      });

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      const cookie = loginRes.headers['set-cookie'];

      // Logout with cookie
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookie);

      expect(logoutRes.status).toBe(200);

      // Check that response clears the cookie
      expect(logoutRes.headers['set-cookie']).toBeDefined();
      const setCookieHeader = setCookies(logoutRes);

      // Cookie should have Max-Age=0 to expire it
      const expireCookie = setCookieHeader.find((cookie: string) =>
        cookie.includes('auth_token=')
      );
      expect(expireCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    });

    it('should accept valid logout request with authenticated user', async () => {
      // Create test user
      await prisma.user.create({
        data: {
          email: testUser.email,
          password: testUser.hashedPassword,
        },
      });

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      const cookie = loginRes.headers['set-cookie'];

      // Logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookie);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.data?.message).toBeDefined();
    });
  });

  describe('Refresh Token Rotation', () => {
    it('should set both access and refresh token cookies scoped to Path=/', async () => {
      // Create test user
      await prisma.user.create({
        data: {
          email: testUser.email,
          password: testUser.hashedPassword,
        },
      });

      // Login
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      const setCookieHeader = setCookies(res);

      // Check for both auth_token and refresh_token cookies
      const authTokenCookie = setCookieHeader.find((cookie: string) =>
        cookie.startsWith('auth_token=')
      );
      const refreshTokenCookie = setCookieHeader.find((cookie: string) =>
        cookie.startsWith('refresh_token=')
      );

      expect(authTokenCookie).toBeDefined();
      expect(refreshTokenCookie).toBeDefined();

      // Both cookies use Path=/ : the refresh cookie was broadened from
      // /api/auth/refresh to / for reverse-proxy compatibility (2026-04-08).
      expect(authTokenCookie).toContain('Path=/');
      expect(refreshTokenCookie).toContain('Path=/');
    });
  });

  describe('CORS with credentials', () => {
    it('should allow credentials in CORS requests', async () => {
      const res = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'http://localhost:3000');

      // CORS headers should indicate credentials are allowed
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('XSS Protection', () => {
    it('should prevent localStorage access with HttpOnly flag', async () => {
      // This is a conceptual test - the actual XSS protection
      // is enforced by browser with HttpOnly flag
      // We verify the flag is set in actual test

      const user = await prisma.user.create({
        data: {
          email: testUser.email,
          password: testUser.hashedPassword,
        },
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      const setCookieHeader = setCookies(res);
      const authTokenCookie = setCookieHeader.find((cookie: string) =>
        cookie.startsWith('auth_token=')
      );

      // Verify HttpOnly flag prevents JavaScript access
      expect(authTokenCookie).toContain('HttpOnly');
    });
  });
});
