'use client';

/**
 * Authentication Context and Provider
 * Provee el estado de usuario y métodos de auth a toda la app via useAuth hook.
 *
 * ARQUITECTURA (cookie-only):
 * - El backend usa HttpOnly cookies (auth_token + refresh_token)
 * - El frontend NO puede leer el JWT de la cookie (es HttpOnly por diseño / seguridad)
 * - La inicialización se hace via GET /auth/me — si hay cookie válida, retorna el user
 * - Si /auth/me da 401, se intenta refresh automático via POST /auth/refresh
 * - Si el refresh falla, el usuario no está autenticado
 *
 * FIX (2026-04-08): Se eliminó el esquema híbrido (localStorage + cookie).
 * El init anterior leía un token de localStorage que nunca se guardaba → siempre fallaba
 * al refrescar la página aunque hubiera una cookie válida de sesión.
 */

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import {
  User,
  AuthState,
  LoginRequest,
  RegisterRequest,
  AuthContextValue,
} from './types';
import { authService } from '@/lib/api/auth.service';
import { isAuthError } from '@/lib/api/error.handler';

/**
 * Auth context - provides user and auth methods
 */
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Auth provider component
 * Wraps the app to provide authentication state and methods
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    tokenExpiresAt: null,
    isInitializing: true,
  });

  const initializationAttemptedRef = useRef(false);

  /**
   * Initialize auth on app startup
   *
   * Flujo:
   * 1. GET /auth/me → si 200: usuario autenticado (cookie auto-enviada por browser)
   * 2. Si 401 → POST /auth/refresh → si ok: reintentar /auth/me
   * 3. Si todo falla → estado unauthenticated
   *
   * La cookie 'auth_token' se envía automáticamente por el browser
   * porque el cliente usa credentials: 'include'
   */
  useEffect(() => {
    if (initializationAttemptedRef.current) return;
    initializationAttemptedRef.current = true;

    const initializeAuth = async () => {
      try {
        // Intentar obtener el usuario actual via cookie
        const user = await authService.getCurrentUser();

        setAuthState({
          user,
          isLoading: false,
          isAuthenticated: true,
          tokenExpiresAt: null, // No podemos leer el exp de una HttpOnly cookie
          isInitializing: false,
        });
      } catch (error) {
        // GET /auth/me falló — intentar refresh si es error de auth
        if (isAuthError(error)) {
          try {
            await authService.refresh();

            // Refresh exitoso: reintentar /auth/me
            const user = await authService.getCurrentUser();

            setAuthState({
              user,
              isLoading: false,
              isAuthenticated: true,
              tokenExpiresAt: null,
              isInitializing: false,
            });
          } catch {
            // Refresh también falló → usuario no autenticado
            setAuthState({
              user: null,
              isLoading: false,
              isAuthenticated: false,
              tokenExpiresAt: null,
              isInitializing: false,
            });
          }
        } else {
          // Error de red u otro error no relacionado con auth
          console.error('Error durante inicialización de auth:', error);
          if (error instanceof Error) {
            console.error('Mensaje de error:', error.message);
            if ('statusCode' in error) console.error('Status Code:', (error as any).statusCode);
          }
          setAuthState({
            user: null,
            isLoading: false,
            isAuthenticated: false,
            tokenExpiresAt: null,
            isInitializing: false,
          });
        }
      }
    };

    initializeAuth();
  }, []);

  /**
   * Handle login
   */
  const handleLogin = async (data: LoginRequest) => {
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true }));

      const response = await authService.login(data);
      setAuthState({
        user: response.user,
        isLoading: false,
        isAuthenticated: true,
        tokenExpiresAt: null, // Token en HttpOnly cookie, no accesible
        isInitializing: false,
      });
    } catch (error) {
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
      }));
      throw error;
    }
  };

  /**
   * Handle register
   */
  const handleRegister = async (data: RegisterRequest) => {
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true }));

      const response = await authService.register(data);

      setAuthState({
        user: response.user,
        isLoading: false,
        isAuthenticated: true,
        tokenExpiresAt: null,
        isInitializing: false,
      });
    } catch (error) {
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
      }));
      throw error;
    }
  };

  /**
   * Handle logout
   */
  const handleLogout = async () => {
    try {
      await authService.logout();
    } finally {
      // Limpiar estado local incluso si el logout falla en el servidor
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        tokenExpiresAt: null,
        isInitializing: false,
      });
    }
  };

  const contextValue: AuthContextValue = {
    ...authState,
    login: handleLogin,
    register: handleRegister,
    logout: handleLogout,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth hook
 * Access authentication state and methods from anywhere in the app
 * @returns AuthContextValue con user, isLoading, isAuthenticated, tokenExpiresAt, isInitializing, y métodos de auth
 * @throws Error if used outside AuthProvider
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
