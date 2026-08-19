import { Request, Response, Router } from 'express';
import { redisMetrics } from '../lib/redis-metrics';
import { CircuitBreakerState } from '../lib/circuit-breaker';

const healthRouter = Router();

/**
 * GET /api/health/redis
 * Returns Redis health status, metrics, and circuit breaker state
 */
healthRouter.get('/redis', (_req: Request, res: Response) => {
  const metrics = redisMetrics.getMetrics();

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'failed' = 'healthy';
  const alerts: string[] = [];

  // Alert if fallback is too long
  if (metrics.fallback_minutes_total > 30) {
    status = 'degraded';
    alerts.push(`Redis fallback active for ${metrics.fallback_minutes_total} minutes`);
  }

  // Alert if currently in fallback
  if (redisMetrics.isCurrentlyInFallback()) {
    if (metrics.current_fallback_seconds > 60) {
      status = 'degraded';
    }
  }

  res.json({
    status,
    redis: {
      available: !redisMetrics.isCurrentlyInFallback(),
    },
    metrics: {
      uptime: metrics.uptime,
      error_count: metrics.error_count,
      fallback_minutes_total: metrics.fallback_minutes_total,
      current_fallback_seconds: metrics.current_fallback_seconds,
      fallback_activations_count: metrics.fallback_activations_count,
    },
    circuit_breaker: {
      // This would be populated from actual circuit breaker instance
      // For now, we provide a placeholder structure
      state: CircuitBreakerState.CLOSED,
      failure_count: 0,
      success_count: 0,
    },
    alerts,
    timestamp: Date.now(),
  });
});

export default healthRouter;
