/**
 * Redis Metrics Tracking
 * Collects and exposes Redis health, fallback usage, and circuit breaker metrics.
 */
export class RedisMetrics {
  private startTime: number = Date.now();
  private errorCount: number = 0;
  private fallbackActivations: Array<{ startTime: number; endTime?: number }> = [];

  constructor() {}

  /**
   * Record a Redis error
   */
  recordError(): void {
    this.errorCount++;
  }

  /**
   * Mark fallback as active
   */
  startFallback(): void {
    this.fallbackActivations.push({
      startTime: Date.now(),
    });
  }

  /**
   * Mark fallback as inactive
   */
  endFallback(): void {
    if (this.fallbackActivations.length > 0) {
      const lastActivation = this.fallbackActivations[this.fallbackActivations.length - 1];
      if (!lastActivation.endTime) {
        lastActivation.endTime = Date.now();
      }
    }
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Get total fallback duration in minutes
   */
  getFallbackMinutesTotal(): number {
    let totalMs = 0;

    for (const activation of this.fallbackActivations) {
      const endTime = activation.endTime || Date.now();
      totalMs += endTime - activation.startTime;
    }

    return Math.floor(totalMs / (1000 * 60));
  }

  /**
   * Get current fallback duration in seconds (or 0 if not currently in fallback)
   */
  getCurrentFallbackSeconds(): number {
    if (this.fallbackActivations.length === 0) return 0;

    const lastActivation = this.fallbackActivations[this.fallbackActivations.length - 1];
    if (lastActivation.endTime) return 0; // Not currently in fallback

    return Math.floor((Date.now() - lastActivation.startTime) / 1000);
  }

  /**
   * Check if currently in fallback
   */
  isCurrentlyInFallback(): boolean {
    if (this.fallbackActivations.length === 0) return false;

    const lastActivation = this.fallbackActivations[this.fallbackActivations.length - 1];
    return !lastActivation.endTime;
  }

  /**
   * Get all metrics
   */
  getMetrics() {
    return {
      uptime: this.getUptime(),
      error_count: this.errorCount,
      fallback_minutes_total: this.getFallbackMinutesTotal(),
      current_fallback_seconds: this.getCurrentFallbackSeconds(),
      fallback_activations_count: this.fallbackActivations.length,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  reset(): void {
    this.startTime = Date.now();
    this.errorCount = 0;
    this.fallbackActivations = [];
  }
}

// Global singleton instance
export const redisMetrics = new RedisMetrics();
