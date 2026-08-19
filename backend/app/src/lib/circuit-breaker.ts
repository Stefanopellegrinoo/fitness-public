/**
 * CircuitBreakerState
 * - CLOSED: Normal operation, requests go through
 * - OPEN: Too many failures, requests are rejected (or allowed with failOpen)
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Failures before opening circuit
  successThreshold: number; // Successes in HALF_OPEN before closing
  timeout: number; // Milliseconds before trying to recover (HALF_OPEN)
  failOpen?: boolean; // If true, allow requests when OPEN (graceful degradation)
}

export interface CircuitBreakerMetrics {
  state: string;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
}

/**
 * CircuitBreaker
 * Implements the Circuit Breaker pattern for fault tolerance.
 * Protects against cascading failures in distributed systems.
 *
 * State transitions:
 * - CLOSED → OPEN: After failureThreshold consecutive failures
 * - OPEN → HALF_OPEN: After timeout elapses (allow test requests)
 * - HALF_OPEN → CLOSED: After successThreshold successes (recovery confirmed)
 * - HALF_OPEN → OPEN: If failure occurs during recovery test
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = Date.now();
  private lastOpenTime: number = 0;

  private config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config.failureThreshold,
      successThreshold: config.successThreshold,
      timeout: config.timeout,
      failOpen: config.failOpen ?? true, // Default to fail-open for graceful degradation
    };
  }

  /**
   * Check if execution is allowed
   */
  canExecute(): boolean {
    const currentTime = Date.now();
    const timeSinceOpen = currentTime - this.lastOpenTime;

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        // Check if we should transition to HALF_OPEN
        if (timeSinceOpen >= this.config.timeout) {
          this.transitionToHalfOpen();
          return true;
        }
        // If failOpen is enabled, allow the request anyway
        return this.config.failOpen;

      case CircuitBreakerState.HALF_OPEN:
        // Allow requests in HALF_OPEN to test recovery
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.successCount++;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Check if we've recovered enough
      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      // Continue operating normally
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // Check if we've hit the failure threshold
        if (this.failureCount >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;

      case CircuitBreakerState.HALF_OPEN:
        // Single failure in HALF_OPEN reopens the circuit
        this.transitionToOpen();
        break;

      case CircuitBreakerState.OPEN:
        // Already open, just track more failures
        break;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Reset circuit to CLOSED state
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastOpenTime = 0;
    console.log('[CircuitBreaker] Reset to CLOSED state');
  }

  // ====== PRIVATE STATE TRANSITIONS ======

  private transitionToOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.lastOpenTime = Date.now();
    this.successCount = 0;

    console.warn(
      `[CircuitBreaker] Circuit breaker opened after ${this.failureCount} failures`
    );
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.failureCount = 0;
    this.successCount = 0;

    console.log('[CircuitBreaker] Circuit breaker entering HALF_OPEN state (testing recovery)');
  }

  private transitionToClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;

    console.log(
      `[CircuitBreaker] Circuit breaker closed after ${this.config.successThreshold} successes`
    );
  }
}
