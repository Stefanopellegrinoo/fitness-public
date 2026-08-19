/**
 * Authentication Type Definitions
 * Core interfaces for user, auth state, and request/response shapes
 */

/**
 * Authenticated user object
 */
export interface User {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * Authentication state in context
 */
export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  tokenExpiresAt: number | null; // Unix timestamp in milliseconds for access token expiration
  isInitializing: boolean; // True while restoring auth state from localStorage on app startup
}

/**
 * Login request payload
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Register request payload
 */
export interface RegisterRequest {
  email: string;
  password: string;
}

/**
 * Authentication response from backend
 * Tokens come via HttpOnly Set-Cookie headers + also in response body for client-side storage
 */
export interface AuthResponse {
  user: User;
  token?: string; // Optional: backend may return token for client-side storage
}

/**
 * Context value interface for useAuth hook
 */
export interface AuthContextValue extends AuthState {
  login(data: LoginRequest): Promise<void>;
  register(data: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
}
