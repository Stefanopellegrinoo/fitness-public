/**
 * Authentication Service
 * Handles auth API calls and token refresh with pending queue for concurrent 401s
 */

import { buildApiUrl, API_TIMEOUT, DEFAULT_FETCH_OPTIONS } from './config';
import { User, AuthResponse, LoginRequest, RegisterRequest } from '../auth/types';
import { handleApiError, ApiError } from './error.handler';
import { saveAuthData } from '../auth/storage';
import { decodeToken } from '../auth/token.service';

/**
 * Pending refresh queue to prevent multiple simultaneous refresh requests
 */
interface PendingRefresh {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: ApiError) => void;
}

let pendingRefresh: PendingRefresh | null = null;

/**
 * Register a new user with email and password
 * @param data - RegisterRequest with email and password
 * @returns Promise<AuthResponse> with user data and optional token
 * @throws ApiError if registration fails
 */
/**
 * FIX (2026-04-08): El backend responde { data: { user } }, no { token, user }.
 * El token viene via Set-Cookie HttpOnly — no en el body.
 * Se eliminó el intento de saveAuthData con token ya que nunca viene en el body.
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const url = buildApiUrl('/auth/register');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...DEFAULT_FETCH_OPTIONS,
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(data),
      credentials: 'include',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }

    // Backend response shape: { data: { user: { id, email } } }
    const result = await response.json();
    const user = result?.data?.user ?? result?.user ?? result;

    return { user } as AuthResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    throw handleApiError(error);
  }
}

/**
 * Login with email and password
 * @param data - LoginRequest with email and password
 * @returns Promise<AuthResponse> with user data and optional token
 * @throws ApiError if login fails
 */
export async function login(data: LoginRequest): Promise<AuthResponse> {
  const url = buildApiUrl('/auth/login');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...DEFAULT_FETCH_OPTIONS,
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(data),
      credentials: 'include',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }

    // Backend response shape: { data: { user: { id, email } } }
    const result = await response.json();
    const user = result?.data?.user ?? result?.user ?? result;

    return { user } as AuthResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    throw handleApiError(error);
  }
}

/**
 * Logout user
 * Clears tokens on backend
 * @returns Promise<void>
 * @throws ApiError if logout fails
 */
export async function logout(): Promise<void> {
  const url = buildApiUrl('/auth/logout');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...DEFAULT_FETCH_OPTIONS,
      method: 'POST',
      signal: controller.signal,
      credentials: 'include', // Include cookies in request
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    throw handleApiError(error);
  }
}

/**
 * Refresh access token
 * Called when 401 is detected or proactively before expiration
 * Prevents multiple concurrent refresh requests via pending queue
 * Updates localStorage with new token if returned by backend
 * @returns Promise<void> - new token set via Set-Cookie and stored locally
 * @throws ApiError if refresh fails
 */
export async function refresh(): Promise<void> {
  // If refresh already in progress, queue this request
  if (pendingRefresh) {
    return pendingRefresh.promise;
  }

  // Create promise for this refresh attempt
  let resolveRefresh: (() => void) | undefined;
  let rejectRefresh: ((error: ApiError) => void) | undefined;

  const refreshPromise = new Promise<void>((resolve, reject) => {
    resolveRefresh = resolve;
    rejectRefresh = reject;
  });

  // This promise exists ONLY so concurrent callers can queue behind one
  // round-trip. When nobody queues — the ordinary case, and always the case on
  // a cold page load — its rejection has no listener, and a refresh that fails
  // surfaces as an UNHANDLED rejection even though the caller below catches the
  // `throw` perfectly well. MEASURED: every visit to /login or /register
  // without a session raised an uncaught "Your session expired" at someone who
  // never had a session.
  //
  // A no-op handler marks it as observed. Callers that DO await it still get
  // the rejection: attaching a handler does not consume it.
  refreshPromise.catch(() => {});

  pendingRefresh = {
    promise: refreshPromise,
    resolve: resolveRefresh!,
    reject: rejectRefresh!,
  };

  try {
    const url = buildApiUrl('/auth/refresh');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch(url, {
      ...DEFAULT_FETCH_OPTIONS,
      method: 'POST',
      signal: controller.signal,
      credentials: 'include', // Include cookies in request
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = handleApiError({}, response.status);
      pendingRefresh = null;
      rejectRefresh?.(error);
      throw error;
    }

    // If backend returned new token + user, update storage
    try {
      const result = (await response.json()) as {
        token?: string;
        user?: User;
      };
      if (result.token && result.user) {
        saveAuthData(result.token, result.user);
      }
    } catch (parseError) {
      // Response OK but couldn't parse - that's fine, token is in httpOnly cookie
      console.warn('Failed to parse refresh response:', parseError);
    }

    // Clear pending refresh queue - all queued requests can now retry
    pendingRefresh = null;
    resolveRefresh?.();
  } catch (error) {
    pendingRefresh = null;
    const apiError = error instanceof ApiError ? error : handleApiError(error);
    rejectRefresh?.(apiError);
    throw apiError;
  }
}

/**
 * Get current authenticated user
 * Called during app initialization
 * @returns Promise<User> with user data
 * @throws ApiError if request fails or user is not authenticated
 */
/**
 * FIX (2026-04-08): El backend responde { data: { user: {...} } }.
 * Antes hacía `return data as User` que retornaba el wrapper completo, no el User.
 */
export async function getCurrentUser(): Promise<User> {
  const url = buildApiUrl('/auth/me');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...DEFAULT_FETCH_OPTIONS,
      method: 'GET',
      signal: controller.signal,
      credentials: 'include',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    // Backend shape: { data: { user: { id, email, ... } } }
    const result = await response.json();
    const user = result?.data?.user ?? result?.data ?? result;
    return user as User;
  } catch (error) {
    clearTimeout(timeoutId);
    throw handleApiError(error);
  }
}

/**
 * Fetch interceptor that handles 401 responses
 * Attempts refresh if 401 detected, then retries original request
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Promise<Response> from original or retried request
 */
export async function fetchWithRefresh(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const response = await fetch(url, { ...options, credentials: 'include' });

  // If not 401, return as-is
  if (response.status !== 401) {
    return response;
  }

  // 401 detected: attempt refresh
  try {
    await refresh();

    // Retry original request with new token
    const retryResponse = await fetch(url, { ...options, credentials: 'include' });
    return retryResponse;
  } catch (error) {
    // Refresh failed: return original 401 response
    // Caller should handle by redirecting to login
    return response;
  }
}

/**
 * Auth service object with all methods
 */
export const authService = {
  register,
  login,
  logout,
  refresh,
  getCurrentUser,
  fetchWithRefresh,
};
