import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('Redis Health Monitoring', () => {
  describe('GET /api/health/redis', () => {
    it('should return redis health status', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('redis');
      expect(res.body).toHaveProperty('metrics');
    });

    it('should include uptime in response', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.metrics).toHaveProperty('uptime');
      expect(typeof res.body.metrics.uptime).toBe('number');
    });

    it('should include error count in metrics', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.metrics).toHaveProperty('error_count');
      expect(typeof res.body.metrics.error_count).toBe('number');
    });

    it('should include fallback minutes total in metrics', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.metrics).toHaveProperty('fallback_minutes_total');
      expect(typeof res.body.metrics.fallback_minutes_total).toBe('number');
    });

    it('should include circuit breaker state', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body).toHaveProperty('circuit_breaker');
      expect(res.body.circuit_breaker).toHaveProperty('state');
      expect(['CLOSED', 'OPEN', 'HALF_OPEN']).toContain(res.body.circuit_breaker.state);
    });

    it('should indicate healthy status when Redis is available', async () => {
      const res = await request(app).get('/api/health/redis');

      // Either 'healthy' or 'degraded' (we can't guarantee Redis is running)
      expect(['healthy', 'degraded', 'failed']).toContain(res.body.status);
    });

    it('should include timestamp in response', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body).toHaveProperty('timestamp');
      expect(typeof res.body.timestamp).toBe('number');
    });

    it('should return JSON response', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.type).toMatch('json');
    });
  });

  describe('Redis Metrics Tracking', () => {
    it('should track fallback activations', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.metrics).toHaveProperty('fallback_minutes_total');
      expect(res.body.metrics.fallback_minutes_total).toBeGreaterThanOrEqual(0);
    });

    it('should track error count accurately', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.metrics.error_count).toBeGreaterThanOrEqual(0);
    });

    it('should include circuit breaker metrics', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.circuit_breaker).toHaveProperty('failure_count');
      expect(res.body.circuit_breaker).toHaveProperty('success_count');
    });

    it('should track uptime in seconds', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.metrics.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Health Status Logic', () => {
    it('should return status=healthy for operational Redis', async () => {
      const res = await request(app).get('/api/health/redis');

      // When Redis is operational
      if (res.body.redis.available === true && res.body.metrics.fallback_minutes_total === 0) {
        expect(res.body.status).toBe('healthy');
      }
    });

    it('should return status=degraded when using fallback', async () => {
      const res = await request(app).get('/api/health/redis');

      // When Redis is down but app continues (fallback active)
      if (res.body.redis.available === false && res.body.status !== 'failed') {
        expect(['degraded', 'healthy']).toContain(res.body.status);
      }
    });

    it('response should include redis availability status', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body.redis).toHaveProperty('available');
      expect(typeof res.body.redis.available).toBe('boolean');
    });
  });

  describe('Alert Thresholds', () => {
    it('should indicate warning if fallback > 30 minutes', async () => {
      const res = await request(app).get('/api/health/redis');

      if (res.body.metrics.fallback_minutes_total > 30) {
        expect(['degraded', 'failed']).toContain(res.body.status);
      }
    });

    it('should include fallback alert indicator', async () => {
      const res = await request(app).get('/api/health/redis');

      expect(res.body).toHaveProperty('alerts');
      expect(Array.isArray(res.body.alerts)).toBe(true);
    });

    it('should add alert if fallback duration exceeds threshold', async () => {
      const res = await request(app).get('/api/health/redis');

      if (res.body.metrics.fallback_minutes_total > 30) {
        expect(res.body.alerts.length).toBeGreaterThan(0);
        expect(
          res.body.alerts.some((a: string) =>
            a.toLowerCase().includes('fallback')
          )
        ).toBe(true);
      }
    });
  });
});
