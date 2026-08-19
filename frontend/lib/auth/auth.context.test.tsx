/**
 * Tests for Authentication Context
 * Covers initialization, login/logout, and the cookie-only refresh flow.
 *
 * REWRITTEN (2026-07-22): the previous version of this file tested a
 * hybrid localStorage+cookie architecture (storage.getAuthData,
 * tokenService.decodeToken/getRefreshTime, a `storage` window-event
 * multi-tab sync) that no longer exists. auth.context.tsx was refactored
 * (see its own "FIX (2026-04-08)" comment) to a cookie-only model:
 * - Init calls GET /auth/me (authService.getCurrentUser); on 401 it calls
 *   POST /auth/refresh and retries once.
 * - login/register/logout only touch React state; the JWT lives in an
 *   HttpOnly cookie the frontend can never read, so tokenExpiresAt is
 *   always null and nothing is ever written to localStorage.
 * - There is no proactive refresh timer and no storage-event multi-tab
 *   sync — those were both part of the old architecture and were removed.
 * This file was previously untestable (it imported @testing-library/user-event,
 * which was never installed) and, per its own docblock, was "written for
 * documentation" and never actually run — so none of the old assertions were
 * ever verified against real behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthProvider, useAuth } from './auth.context';
import { authService } from '@/lib/api/auth.service';
import { ApiError } from '@/lib/api/error.handler';
import { User, AuthResponse } from './types';

// Mock the entire auth.service module — auth.context.tsx only ever talks to
// `authService.{getCurrentUser,login,register,logout,refresh}`.
vi.mock('@/lib/api/auth.service');

function AuthStatus() {
  const { isInitializing, isAuthenticated, user, tokenExpiresAt } = useAuth();
  if (isInitializing) return <div>status:initializing</div>;
  return (
    <div>
      status:{isAuthenticated ? 'authenticated' : 'unauthenticated'}
      {user ? ` user:${user.email}` : ''}
      {' '}tokenExpiresAt:{tokenExpiresAt === null ? 'null' : tokenExpiresAt}
    </div>
  );
}

describe('AuthProvider', () => {
  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    createdAt: '2026-01-01T00:00:00Z',
  };

  const authError = () =>
    new ApiError('AUTH_ERROR', 'Your session expired. Please login again.', undefined, undefined, 401);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should start with isInitializing=true, then settle to false', async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue(mockUser);

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>
      );

      expect(screen.getByText('status:initializing')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText('status:initializing')).not.toBeInTheDocument();
      });
    });

    it('should restore the authenticated user from GET /auth/me on mount', async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue(mockUser);

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
      });
      expect(screen.getByText(/user:test@example\.com/)).toBeInTheDocument();
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('should remain unauthenticated when GET /auth/me fails with a non-auth error (no refresh attempt)', async () => {
      vi.mocked(authService.getCurrentUser).mockRejectedValue(new Error('network down'));

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/status:unauthenticated/)).toBeInTheDocument();
      });
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('should attempt refresh when GET /auth/me returns an auth error, then retry and authenticate', async () => {
      vi.mocked(authService.getCurrentUser)
        .mockRejectedValueOnce(authError())
        .mockResolvedValueOnce(mockUser);
      vi.mocked(authService.refresh).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(authService.refresh).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
      });
      expect(authService.getCurrentUser).toHaveBeenCalledTimes(2);
    });

    it('should clear state if refresh also fails during initialization', async () => {
      vi.mocked(authService.getCurrentUser).mockRejectedValue(authError());
      vi.mocked(authService.refresh).mockRejectedValue(new Error('Refresh failed'));

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/status:unauthenticated/)).toBeInTheDocument();
      });
    });
  });

  describe('Login', () => {
    async function renderAndWaitForInit() {
      vi.mocked(authService.getCurrentUser).mockRejectedValue(new Error('not logged in'));

      render(
        <AuthProvider>
          <AuthStatus />
          <LoginButton />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/status:unauthenticated/)).toBeInTheDocument();
      });
    }

    function LoginButton() {
      const { login } = useAuth();
      return (
        <button onClick={() => login({ email: 'test@example.com', password: 'password' })}>
          Login
        </button>
      );
    }

    it('should log the user in and update state on success', async () => {
      const mockResponse: AuthResponse = { user: mockUser };
      vi.mocked(authService.login).mockResolvedValue(mockResponse);

      await renderAndWaitForInit();

      const user = userEvent.setup();
      await user.click(screen.getByText('Login'));

      await waitFor(() => {
        expect(authService.login).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password',
        });
        expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
      });
      expect(screen.getByText(/user:test@example\.com/)).toBeInTheDocument();
    });

    it('should keep tokenExpiresAt as null after login (token lives only in an HttpOnly cookie)', async () => {
      const mockResponse: AuthResponse = { user: mockUser };
      vi.mocked(authService.login).mockResolvedValue(mockResponse);

      await renderAndWaitForInit();

      const user = userEvent.setup();
      await user.click(screen.getByText('Login'));

      await waitFor(() => {
        expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
      });
      expect(screen.getByText(/tokenExpiresAt:null/)).toBeInTheDocument();
    });
  });

  describe('Logout', () => {
    function LogoutButton() {
      const { logout } = useAuth();
      return <button onClick={() => logout().catch(() => {})}>Logout</button>;
    }

    async function renderAuthenticatedAndWaitForInit() {
      vi.mocked(authService.getCurrentUser).mockResolvedValue(mockUser);

      render(
        <AuthProvider>
          <AuthStatus />
          <LogoutButton />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
      });
    }

    it('should log the user out and clear state', async () => {
      vi.mocked(authService.logout).mockResolvedValue(undefined);

      await renderAuthenticatedAndWaitForInit();

      const user = userEvent.setup();
      await user.click(screen.getByText('Logout'));

      await waitFor(() => {
        expect(authService.logout).toHaveBeenCalled();
        expect(screen.getByText(/status:unauthenticated/)).toBeInTheDocument();
      });
    });

    it('should clear state even if the logout API call fails', async () => {
      vi.mocked(authService.logout).mockRejectedValue(new Error('Logout failed'));

      await renderAuthenticatedAndWaitForInit();

      const user = userEvent.setup();
      await user.click(screen.getByText('Logout'));

      await waitFor(() => {
        expect(authService.logout).toHaveBeenCalled();
        expect(screen.getByText(/status:unauthenticated/)).toBeInTheDocument();
      });
    });
  });

  describe('Cross-tab session sync (removed in the cookie-only architecture)', () => {
    it('does not re-fetch or change auth state on a window "storage" event', async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue(mockUser);

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
      });

      const callsBeforeEvent = vi.mocked(authService.getCurrentUser).mock.calls.length;

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'auth_token',
          newValue: null,
          url: window.location.href,
        })
      );

      // Give any (hypothetical) listener a macrotask to react — there should be none.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(authService.getCurrentUser).mock.calls.length).toBe(callsBeforeEvent);
      expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
    });
  });

  describe('Proactive token refresh (removed in the cookie-only architecture)', () => {
    it('never schedules a refresh timer and keeps tokenExpiresAt null even when authenticated', async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue(mockUser);

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/status:authenticated/)).toBeInTheDocument();
      });

      // Cookie-only architecture: the JWT is HttpOnly, so the client cannot
      // decode an expiration claim to schedule anything against.
      expect(screen.getByText(/tokenExpiresAt:null/)).toBeInTheDocument();
      expect(authService.refresh).not.toHaveBeenCalled();
    });
  });
});
