/**
 * API Error Handling
 * Centralized error classes and utilities for API communication
 */

export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'SERVER_ERROR'
  | 'NOT_FOUND'
  | 'TIMEOUT';

/**
 * Typed API error class
 * Distinguishes between network, validation, auth, server, and timeout errors
 */
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    public message: string,
    public originalError?: unknown,
    public validationErrors?: Record<string, string>,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ApiError';
    // Maintain prototype chain for instanceof checks
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Parse error response body and extract message
 */
async function parseErrorBody(
  response: Response
): Promise<{ message?: string; errors?: Record<string, string> }> {
  try {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return await response.json();
    }
    return { message: response.statusText };
  } catch {
    return { message: response.statusText };
  }
}

/**
 * Handle fetch errors and convert to ApiError
 * @param error - Error from fetch or response processing (can be the JSON body of an error response)
 * @param statusCode - HTTP status code (if from response)
 * @returns ApiError instance
 */
export function handleApiError(
  error: unknown,
  statusCode?: number
): ApiError {
  // Extract message and errors from body if possible
  let bodyMessage: string | undefined;
  let validationErrors: Record<string, string> | undefined;

  if (error && typeof error === 'object') {
    const errorObj = error as Record<string, any>;
    // The backend answers with two shapes: flat (`{ error: "<string>" }`, express
    // error handler) and nested (`{ error: { message } }`, route handlers). The
    // nested one must be read BEFORE the bare `error`, or the whole object wins.
    // `message` is a parameter property on ApiError, assigned after super() and so
    // never stringified — anything but a string falls back to the per-status copy.
    const rawMessage = errorObj.message || errorObj.error?.message || errorObj.error || (errorObj.data?.message) || (errorObj.data?.error);
    bodyMessage = typeof rawMessage === 'string' ? rawMessage : undefined;
    validationErrors = errorObj.errors || errorObj.data?.errors;
  }

  // Network/timeout errors from fetch
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout') || message.includes('time')) {
      return new ApiError(
        'TIMEOUT',
        'Connection timeout. Please check your internet and try again.',
        error,
        undefined,
        408
      );
    }

    if (
      message.includes('network') ||
      message.includes('failed to fetch') ||
      message.includes('networkconnection')
    ) {
      return new ApiError(
        'NETWORK_ERROR',
        'Network error. You may be offline. Please check your connection.',
        error,
        undefined,
        0
      );
    }

    // Fallback for other TypeErrors
    return new ApiError(
      'NETWORK_ERROR',
      'Failed to connect to server. Please try again.',
      error,
      undefined,
      0
    );
  }

  // Already an ApiError
  if (error instanceof ApiError) {
    return error;
  }

  // HTTP status code errors
  if (statusCode) {
    if (statusCode === 400) {
      return new ApiError(
        'VALIDATION_ERROR',
        bodyMessage || 'Validation failed. Please check your input.',
        error,
        validationErrors,
        400
      );
    }

    if (statusCode === 401 || statusCode === 403) {
      // Use specific message if provided (e.g. "Invalid credentials"), otherwise fallback to session expired
      return new ApiError(
        'AUTH_ERROR',
        bodyMessage || 'Your session expired. Please login again.',
        error,
        undefined,
        statusCode
      );
    }

    if (statusCode === 409) {
      return new ApiError(
        'VALIDATION_ERROR',
        bodyMessage || 'Conflict occurred. Resource already exists.',
        error,
        undefined,
        409
      );
    }

    if (statusCode === 404) {
      return new ApiError(
        'NOT_FOUND',
        bodyMessage || 'Resource not found. It may have been deleted.',
        error,
        undefined,
        404
      );
    }

    if (statusCode >= 500) {
      return new ApiError(
        'SERVER_ERROR',
        bodyMessage || 'Server error. Please try again later.',
        error,
        undefined,
        statusCode
      );
    }
  }

  // Unknown error
  return new ApiError(
    'NETWORK_ERROR',
    bodyMessage || 'An unexpected error occurred. Please try again.',
    error,
    undefined,
    0
  );
}

/**
 * Type guard: check if error is ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError ||
    (error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      'message' in error &&
      (error as any).name === 'ApiError')
  );
}

/**
 * Type guard: check if error is timeout
 */
export function isTimeoutError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'TIMEOUT';
}

/**
 * Type guard: check if error is auth error
 */
export function isAuthError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'AUTH_ERROR';
}

/**
 * Type guard: check if error is validation error
 */
export function isValidationError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'VALIDATION_ERROR';
}

/**
 * Type guard: check if error is network error
 */
export function isNetworkError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'NETWORK_ERROR';
}

/**
 * Status of an error the API itself produced.
 *
 * Its handlers answer with a nested `{ error: { message } }` body; the express catch-all
 * and anything in front of it (proxy miss, wrong base URL, deploy skew) do not, and a
 * non-JSON body is swallowed to `{}` before it gets here. Those say nothing about the
 * resource, so they read as `undefined` and never eject a user from a live session.
 *
 * This is deliberately NARROWER than reading `statusCode`, and narrower than a
 * `code === 'NOT_FOUND'` guard: `handleApiError` assigns that code to ANY 404,
 * infrastructure included. Anything branching on a status to decide what happened to a
 * DOMAIN resource has to come through here, or the two answers diverge — which is
 * exactly what happened when `handleFinish` grew its own rule and started ejecting
 * users out of sessions that were alive.
 */
export function apiErrorStatus(error: unknown): number | undefined {
  if (!isApiError(error)) return undefined;
  const body = error.originalError as { error?: { message?: unknown } } | null | undefined;
  return typeof body?.error?.message === 'string' ? error.statusCode : undefined;
}

/**
 * Get user-friendly error message from error
 */
export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred. Please try again.';
}
