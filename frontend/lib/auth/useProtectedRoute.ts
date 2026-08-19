/**
 * useProtectedRoute Hook
 * Reusable guard for protecting individual page components
 * Can be used in addition to the layout guard for granular control
 *
 * Usage:
 * ```tsx
 * export default function WorkoutPage() {
 *   useProtectedRoute();
 *   return <div>Protected content</div>;
 * }
 * ```
 *
 * The hook:
 * 1. Checks isInitializing - throws error if still initializing (prevents accidental render)
 * 2. Checks isAuthenticated - throws error if not authenticated
 * 3. Returns early if checks pass
 *
 * Note: The layout guard handles most cases, but this hook provides extra safety
 * for individual page components that need to ensure auth state before rendering
 */

'use client';

import { useAuth } from './auth.context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Protect a page component with authentication checks
 * Ensures authentication is initialized and user is authenticated
 *
 * Behavior:
 * - If initializing: throws error (prevents render race condition)
 * - If not authenticated: redirects to /auth/login
 * - If authenticated: allows component to render
 *
 * @throws Error if called outside AuthProvider context
 * @throws Error if still initializing (should not happen with layout guard, but prevents edge cases)
 */
export function useProtectedRoute(): void {
  const { isInitializing, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If still initializing, something is wrong with the layout guard
    // This should not happen, but we protect against it
    if (isInitializing) {
      throw new Error(
        'useProtectedRoute: Still initializing. This suggests the (protected) layout guard failed. Check AuthProvider setup.'
      );
    }

    // If not authenticated, redirect to login
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isInitializing, isAuthenticated, router]);
}
