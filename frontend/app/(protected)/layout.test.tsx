/**
 * Protected Layout Tests
 * Tests for client-side route guard layout component
 * Verifies that:
 * - Shows loading spinner during initialization
 * - Shows loading spinner during hydration
 * - Redirects to /login when not authenticated after initialization
 * - Renders children (wrapped in AppShell) when authenticated and initialized
 * - Distinguishes between isInitializing=true and isAuthenticated=false
 *
 * NOTE: Ported from jest.mock/jest.fn to vi.mock/vi.fn (this project uses
 * Vitest, not Jest) and updated to the current layout contract:
 * - Loading copy is "Cargando tu perfil..." (Spanish), not "Loading your profile..."
 * - Redirect target is '/login', not '/auth/login' (matches proxy.ts)
 * - Authenticated content is wrapped in <AppShell>, which renders BottomNav
 *   in addition to children — assertions target the children text, which
 *   AppShell still renders regardless of that extra chrome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProtectedLayout from '@/app/(protected)/layout';
import { useAuth } from '@/lib/auth/auth.context';
import { useRouter } from 'next/navigation';

// Mock useAuth
vi.mock('@/lib/auth/auth.context');

// Mock next/navigation. Needs an explicit factory (not a bare automock):
// authenticated renders go through <AppShell>, which calls usePathname()
// internally (via BottomNav too) — a bare `vi.mock('next/navigation')`
// automock would override the global setupFile factory and leave
// usePathname() returning undefined, crashing AppShell's `.startsWith()` call.
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  usePathname: () => '/dashboard',
}));

describe('ProtectedLayout', () => {
  const mockReplace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
    } as unknown as ReturnType<typeof useRouter>);
  });

  const TestChildren = () => <div>Protected Content</div>;

  it('should show loading spinner when isInitializing is true', () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: true,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    render(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    expect(screen.getByText('Cargando tu perfil...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should show loading spinner during initial mount (hydration), then render content', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      user: { id: '1', email: 'test@example.com', createdAt: '2024-01-01' },
    } as unknown as ReturnType<typeof useAuth>);

    // First render shows loading (before the `isMounted` useEffect runs),
    // even though isInitializing is already false — the layout also waits
    // for hydration via its own isMounted state.
    render(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    // After useEffect marks isMounted=true, should show content
    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('should render children when authenticated and initialized', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      user: { id: '1', email: 'test@example.com', createdAt: '2024-01-01' },
    } as unknown as ReturnType<typeof useAuth>);

    render(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('should redirect to /login when not authenticated after initialization', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    render(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });

    // Children should not be rendered
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should distinguish between isInitializing=true and isAuthenticated=false', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: true,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    const { rerender } = render(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    // Case 1: isInitializing=true (show spinner, not redirect)
    expect(screen.getByText('Cargando tu perfil...')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();

    // Case 2: isInitializing=false + isAuthenticated=false (redirect to login)
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    rerender(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });

  it('should handle transition from initializing=true to initialized and authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: true,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    const { rerender } = render(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    expect(screen.getByText('Cargando tu perfil...')).toBeInTheDocument();

    // After initialization: authenticated
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      user: { id: '1', email: 'test@example.com', createdAt: '2024-01-01' },
    } as unknown as ReturnType<typeof useAuth>);

    rerender(
      <ProtectedLayout>
        <TestChildren />
      </ProtectedLayout>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });
});
