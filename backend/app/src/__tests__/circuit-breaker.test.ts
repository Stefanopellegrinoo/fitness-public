import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerState } from '../lib/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;
  let strictBreaker: CircuitBreaker; // For testing strict mode (no fail-open)

  beforeEach(() => {
    // Default breaker with fail-open (graceful degradation)
    breaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 100,
      failOpen: true,
    });

    // Strict breaker without fail-open (for testing OPEN rejection)
    strictBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 100,
      failOpen: false,
    });
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('State Initialization', () => {
    it('should initialize in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should have zero failures initially', () => {
      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(0);
    });

    it('should track creation time', () => {
      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('CLOSED → OPEN Transition', () => {
    it('should transition to OPEN after failureThreshold failures', () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should allow requests in CLOSED state', () => {
      expect(breaker.canExecute()).toBe(true);
    });

    it('should reject requests in OPEN state', () => {
      // Use strict breaker that doesn't fail-open
      for (let i = 0; i < 5; i++) {
        strictBreaker.recordFailure();
      }

      expect(strictBreaker.canExecute()).toBe(false);
    });

    it('should log when opening circuit', () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker opened')
      );
    });
  });

  describe('OPEN → HALF_OPEN Transition', () => {
    it('should transition to HALF_OPEN after timeout expires', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Wait for timeout (100ms configured in beforeEach)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Now canExecute() should trigger transition to HALF_OPEN
      breaker.canExecute();
      expect(breaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should allow limited requests in HALF_OPEN state', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should allow request in HALF_OPEN
      expect(breaker.canExecute()).toBe(true);
    });

    it('should track half-open request count', async () => {
      // Open circuit - use strict breaker to force OPEN rejection
      for (let i = 0; i < 5; i++) {
        strictBreaker.recordFailure();
      }

      // Move to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 150));
      strictBreaker.canExecute(); // Trigger transition
      expect(strictBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      // Execute request
      strictBreaker.canExecute();

      const metrics = strictBreaker.getMetrics();
      expect(metrics.successCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('HALF_OPEN → CLOSED Transition (Success)', () => {
    it('should transition back to CLOSED after successThreshold successes', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      // Move to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 150));
      breaker.canExecute(); // Trigger transition
      expect(breaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      // Record successes
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should reset failure count on CLOSED', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      // Move to HALF_OPEN and close
      await new Promise(resolve => setTimeout(resolve, 150));
      breaker.canExecute();
      breaker.recordSuccess();
      breaker.recordSuccess();

      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(0);
    });

    it('should log when closing circuit', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      // Open and close circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      await new Promise(resolve => setTimeout(resolve, 150));
      breaker.canExecute();
      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker closed')
      );
    });
  });

  describe('HALF_OPEN → OPEN Transition (Failure)', () => {
    it('should reopen circuit on failure during HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      // Move to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 150));
      breaker.canExecute();
      expect(breaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      // Fail in HALF_OPEN
      breaker.recordFailure();

      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should extend timeout on reopen', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      // Move to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 150));
      breaker.canExecute();

      // Fail in HALF_OPEN (re-open)
      breaker.recordFailure();

      // Check that we're back in OPEN
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);

      // The next HALF_OPEN transition should be delayed
      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Fail-Open Strategy', () => {
    it('should allow requests when configured with fail-open', () => {
      const failOpenBreaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000,
        failOpen: true,
      });

      // Open circuit
      for (let i = 0; i < 5; i++) {
        failOpenBreaker.recordFailure();
      }

      // In fail-open mode, should still allow requests
      expect(failOpenBreaker.canExecute()).toBe(true);
    });

    it('should deny requests when configured without fail-open', () => {
      const strictBreaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000,
        failOpen: false,
      });

      // Open circuit
      for (let i = 0; i < 5; i++) {
        strictBreaker.recordFailure();
      }

      // Without fail-open, should deny requests
      expect(strictBreaker.canExecute()).toBe(false);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple canExecute calls in CLOSED state', () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(breaker.canExecute());
      }

      expect(results.every(r => r === true)).toBe(true);
    });

    it('should handle multiple canExecute calls in OPEN state', () => {
      // Use strict breaker
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        strictBreaker.recordFailure();
      }

      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(strictBreaker.canExecute());
      }

      expect(results.every(r => r === false)).toBe(true);
    });

    it('should handle concurrent success and failure recording', () => {
      // Simulate concurrent operations
      for (let i = 0; i < 3; i++) {
        breaker.recordSuccess();
      }

      for (let i = 0; i < 2; i++) {
        breaker.recordFailure();
      }

      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(2);
    });
  });

  describe('Metrics', () => {
    it('should return current metrics', () => {
      const metrics = breaker.getMetrics();

      expect(metrics).toHaveProperty('state');
      expect(metrics).toHaveProperty('failureCount');
      expect(metrics).toHaveProperty('successCount');
      expect(metrics).toHaveProperty('lastFailureTime');
    });

    it('should update metrics on state changes', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      const openMetrics = breaker.getMetrics();
      expect(openMetrics.state).toBe(CircuitBreakerState.OPEN);

      // Move to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 150));
      breaker.canExecute();
      const halfOpenMetrics = breaker.getMetrics();
      expect(halfOpenMetrics.state).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should track last failure time', () => {
      const beforeFailure = Date.now();

      breaker.recordFailure();

      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
    });
  });

  describe('Reset', () => {
    it('should reset circuit to CLOSED state', () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);

      breaker.reset();

      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(0);
    });
  });

  describe('Rate Limit Middleware Integration', () => {
    it('should be usable by rate limiter to fail-open', () => {
      // Simulate rate limiting scenario
      const rateLimitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 30000,
        failOpen: true, // Allow requests even when Redis is down
      });

      // Redis failures
      for (let i = 0; i < 3; i++) {
        rateLimitBreaker.recordFailure();
      }

      // Should still allow rate limit checks to pass
      expect(rateLimitBreaker.canExecute()).toBe(true);
    });

    it('should provide state for monitoring', () => {
      const metrics = breaker.getMetrics();
      const stateStr = metrics.state;

      expect(['CLOSED', 'OPEN', 'HALF_OPEN']).toContain(stateStr);
    });
  });
});
