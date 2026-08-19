import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom ships no ResizeObserver, and recharts' responsive container constructs
// one on mount -- without this, any test that renders a chart dies on a
// ReferenceError before it can assert anything. Observing nothing is the right
// stub: charts read zero-size in jsdom either way, and the assertions are about
// the data reaching them, not about layout.
// A plain class, NOT a vi.fn(): a test file calling `vi.resetAllMocks()` in its
// own `beforeEach` strips the implementation off every mock function including
// this one, and `new ResizeObserver()` then yields an object with no `observe`
// -- an unhandled TypeError from inside recharts, in a file that never
// mentioned ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub });

// Mock next/router
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock next/navigation for App Router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/app/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
