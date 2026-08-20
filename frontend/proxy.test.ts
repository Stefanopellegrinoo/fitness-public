/**
 * Proxy tests (Next.js request-level auth protection).
 * - Protected routes require auth_token in cookies
 * - Missing token redirects to /login with a redirect parameter
 * - Present token allows the request to proceed
 */

import { describe, it, expect } from 'vitest';
import { proxy, config } from '@/proxy';
import { NextRequest, NextResponse } from 'next/server';

describe('proxy', () => {
  describe('config.matcher', () => {
    it('should match protected route patterns', () => {
      const patterns = config.matcher;
      expect(patterns).toContain('/workout/:path*');
      expect(patterns).toContain('/profile/:path*');
      expect(patterns).toContain('/nutrition/:path*');
      expect(patterns).toContain('/metrics/:path*');
      expect(patterns).toContain('/progress/:path*');
    });
  });

  describe('proxy(request)', () => {
    /**
     * Helper: Create a mock NextRequest
     */
    function createRequest(
      pathname: string,
      options?: { cookies?: Record<string, string> }
    ): NextRequest {
      const url = new URL(`http://localhost:3000${pathname}`);
      const request = new NextRequest(url);

      // Mock cookies
      if (options?.cookies) {
        Object.entries(options.cookies).forEach(([key, value]) => {
          request.cookies.set(key, value);
        });
      }

      return request;
    }

    it('should redirect to /login when auth_token is missing', () => {
      const request = createRequest('/workout');
      const response = proxy(request);

      expect(response).toBeInstanceOf(NextResponse);
      expect(response?.status).toBe(307); // Redirect status
      expect(response?.headers.get('location')).toContain('/login');
      expect(response?.headers.get('location')).toContain('redirect=%2Fworkout');
    });

    it('should include redirect parameter pointing to original pathname', () => {
      const request = createRequest('/profile/edit');
      const response = proxy(request);

      const location = response?.headers.get('location') || '';
      expect(location).toContain('redirect=%2Fprofile%2Fedit');
    });

    it('should allow request to proceed when auth_token is present', () => {
      const request = createRequest('/workout', {
        cookies: { auth_token: 'valid-token-abc123' },
      });
      const response = proxy(request);

      expect(response).toBeInstanceOf(NextResponse);
      expect(response?.status).toBe(200); // NextResponse.next() returns 200
    });

    it('should allow request to proceed for any protected route with valid token', () => {
      const protectedRoutes = [
        '/workout',
        '/profile',
        '/nutrition',
        '/metrics',
        '/progress',
        '/workout/details',
        '/profile/settings',
      ];

      protectedRoutes.forEach((route) => {
        const request = createRequest(route, {
          cookies: { auth_token: 'test-token' },
        });
        const response = proxy(request);
        expect(response?.status).toBe(200);
      });
    });

    it('should redirect even if auth_token is empty string', () => {
      const request = createRequest('/workout', {
        cookies: { auth_token: '' },
      });
      const response = proxy(request);

      expect(response?.status).not.toBe(200);
      expect(response?.headers.get('location')).toContain('/login');
    });

    it('should redirect if auth_token cookie is missing entirely', () => {
      // Simulate a request where the cookie was never set / already expired and removed
      const request = createRequest('/nutrition');
      const response = proxy(request);

      expect(response?.headers.get('location')).toContain('/login');
    });
  });
});
