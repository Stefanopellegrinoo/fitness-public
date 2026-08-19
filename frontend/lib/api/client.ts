/**
 * API Client with 401 Refresh Interceptor
 * Wraps all fetch calls with automatic token refresh on 401
 * 
 * This client:
 * 1. Automatically includes credentials (cookies)
 * 2. Handles 401 responses by calling refresh() and retrying
 * 3. Prevents duplicate refresh calls with pending queue
 * 4. Handles network errors and missing refresh endpoint gracefully
 */

import { API_TIMEOUT, DEFAULT_FETCH_OPTIONS } from './config';
import { authService } from './auth.service';
import { handleApiError, ApiError } from './error.handler';

/**
 * Track if refresh is currently in progress
 * Prevents multiple simultaneous refresh attempts
 */
let refreshPromise: Promise<void> | null = null;

/**
 * API client function that handles 401 refresh automatically
 * @param url - Full API URL
 * @param options - Fetch options (without credentials, will be added automatically)
 * @returns Response from fetch, potentially after refresh attempt
 * @throws Does not throw - returns original response if refresh fails
 */
export async function apiClient(
  url: string,
  options?: RequestInit
): Promise<Response> {
  // Merge options with defaults, ensure credentials included
  const fetchOptions: RequestInit = {
    ...DEFAULT_FETCH_OPTIONS,
    ...options,
    credentials: 'include', // Always include cookies for auth
  };

  // Set timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  fetchOptions.signal = controller.signal;

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    // Not a 401, return as-is
    if (response.status !== 401) {
      return response;
    }

    // 401 detected: attempt refresh
    return await handleUnauthorized(url, fetchOptions);
  } catch (error) {
    clearTimeout(timeoutId);

    // Network error or abort - return a synthetic 401 response
    // to let caller decide how to handle
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Request timeout' }), {
        status: 408,
        statusText: 'Request Timeout',
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.error('API client error:', error);
    return new Response(JSON.stringify({ error: 'Network error' }), {
      status: 0,
      statusText: 'Network error',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle 401 Unauthorized response
 * Attempts refresh and retries original request
 * @param url - Original request URL
 * @param options - Original fetch options
 * @returns Response from retry, or original 401 if refresh fails
 */
async function handleUnauthorized(
  url: string,
  options: RequestInit
): Promise<Response> {
  // If refresh already in progress, wait for it
  if (refreshPromise) {
    try {
      await refreshPromise;
    } catch (error) {
      // Refresh failed, return 401
      console.warn('Token refresh in progress failed:', error);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    // Start refresh
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });

    try {
      await refreshPromise;
    } catch (error) {
      // Refresh failed, return 401
      console.warn('Token refresh failed:', error);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Refresh succeeded, retry original request
  try {
    // Remove signal from old request to get fresh timeout
    const { signal, ...cleanOptions } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const retryResponse = await fetch(url, {
      ...cleanOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return retryResponse;
  } catch (error) {
    console.error('Retry after refresh failed:', error);
    return new Response(JSON.stringify({ error: 'Network error' }), {
      status: 0,
      statusText: 'Network error',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Perform token refresh
 * Calls backend refresh endpoint and updates localStorage
 * @throws ApiError if refresh endpoint returns error
 */
async function performRefresh(): Promise<void> {
  try {
    // Call authService.refresh() which handles the actual refresh logic
    await authService.refresh();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      'AUTH_ERROR',
      'Token refresh failed',
      error instanceof Error ? error : 'Unknown error',
      undefined,
      401
    );
  }
}

/**
 * Create a fetch wrapper for a specific service
 * Simplifies API service implementations
 * 
 * Usage:
 * ```
 * const response = await serviceFetch('/workouts', {
 *   method: 'POST',
 *   body: JSON.stringify(data)
 * });
 * ```
 */
export function serviceFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  return apiClient(url, options);
}

/**
 * API client service object
 */
export const client = {
  fetch: apiClient,
  serviceFetch,
};
