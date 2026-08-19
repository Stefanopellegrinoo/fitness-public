/**
 * API Configuration
 * Centralized configuration for backend API communication
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/backend-api'

// Default fetch options applied to all API calls
export const DEFAULT_FETCH_OPTIONS: RequestInit = {
  headers: {
    'Content-Type': 'application/json',
  },
};

// Request timeout in milliseconds
export const API_TIMEOUT = 10000; // 10 seconds

/**
 * Validate environment configuration
 * @throws {Error} if critical env vars are missing
 */
export function validateApiConfig(): void {
  if (!process.env.NEXT_PUBLIC_API_BASE_URL) {
    console.warn(
      'NEXT_PUBLIC_API_BASE_URL not set, using default: /backend-api'
    );
  }
}

/**
 * Build full API endpoint URL
 * @param endpoint - API endpoint path (e.g., '/dashboard/summary', '/routines')
 * @returns Full URL for the API endpoint
 */
export function buildApiUrl(endpoint: string): string {
  // Remove leading slash from endpoint and trailing slash from base URL
  const cleanBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBase}${cleanEndpoint}`;
}
