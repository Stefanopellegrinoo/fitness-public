/**
 * useProtectedRoute Hook Tests
 * Tests for client-side route protection hook
 * Verifies that:
 * - Hook redirects when not authenticated
 * - Hook throws when still initializing
 * - Hook allows rendering when authenticated and initialized
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';
import { useAuth } from '@/lib/auth/auth.context';
import { useRouter } from 'next/navigation';

// Mock useAuth hook
vi.mock('@/lib/auth/auth.context');

// Mock useRouter
vi.mock('next/navigation');

describe('useProtectedRoute', () => {
  const mockPush = vi.fn();
  const mockReplace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: mockReplace,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it('should not throw or redirect when initialized and authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      user: { id: '1', email: 'test@example.com', createdAt: '2024-01-01' },
    } as unknown as ReturnType<typeof useAuth>);

    expect(() => {
      renderHook(() => useProtectedRoute());
    }).not.toThrow();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('should redirect to /login when not authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    renderHook(() => useProtectedRoute());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });

  it('should throw error when still initializing', () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: true,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    // Mock console.error to suppress error output in test logs
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useProtectedRoute());
    }).toThrow('useProtectedRoute: Still initializing');

    consoleErrorSpy.mockRestore();
  });

  it('should redirect even if initialized but not yet authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    renderHook(() => useProtectedRoute());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });

  it('should re-evaluate when isAuthenticated changes from false to true', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: false,
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    const { rerender } = renderHook(() => useProtectedRoute());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });

    // Update to authenticated
    vi.mocked(useAuth).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      user: { id: '1', email: 'test@example.com', createdAt: '2024-01-01' },
    } as unknown as ReturnType<typeof useAuth>);

    rerender();

    // Should not redirect again
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});
