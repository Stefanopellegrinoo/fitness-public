/**
 * Protected Routes Layout
 * Client-side guard for all routes under /app/* (workout, profile, nutrition, metrics, progress)
 * Ensures authentication is initialized and user is authenticated before rendering content
 * Shows loading spinner during initialization, redirects to /auth/login if not authenticated
 */

'use client';

import { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth.context';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/fitness/app-shell';

interface ProtectedLayoutProps {
  children: ReactNode;
}

/**
 * Protected Layout Component
 * Wraps all protected route pages with authentication checks
 * 
 * Guard Logic:
 * 1. If isInitializing → show loading spinner (don't render content yet)
 * 2. If isInitializing === false AND !isAuthenticated → redirect to /auth/login
 * 3. Else → render protected content
 *
 * This provides defense-in-depth with middleware (request level) + client guard (navigation level)
 */
export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const { isInitializing, isAuthenticated } = useAuth();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Wait for hydration and initialization
  if (!isMounted || isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">Cargando tu perfil...</p>
        </div>
      </div>
    );
  }

  // Initialization complete - check authentication
  if (!isAuthenticated) {
    // Not authenticated - redirect to login
    // Note: Middleware should have caught this, but client guard provides extra safety
    router.replace('/login');
    return null;
  }

  // Authenticated and initialized - render protected content
  return <AppShell>{children}</AppShell>;
}
