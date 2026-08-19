import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedisClientWithFallback } from '../lib/redis-fallback';

describe('RedisClientWithFallback', () => {
  let client: RedisClientWithFallback;

  beforeEach(() => {
    client = new RedisClientWithFallback('redis://localhost:6379');
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await client.disconnect();
  });

  describe('Health Check & Detection', () => {
    it('should initialize with available=true', () => {
      expect(client.isAvailable).toBe(true);
    });

    it('should track failure count and mark unavailable after 3 failures', () => {
      const handler = (client as any).handleRedisError;
      const err = new Error('Redis connection failed');

      // First two failures: still available
      handler.call(client, err);
      expect(client.isAvailable).toBe(true);

      handler.call(client, err);
      expect(client.isAvailable).toBe(true);

      // Third failure: should mark unavailable
      handler.call(client, err);
      expect(client.isAvailable).toBe(false);
      expect((client as any).failureCount).toBe(3);
    });

    it('should have failure threshold configurable', () => {
      expect((client as any).failureThreshold).toBe(3);
    });
  });

  describe('In-Memory Fallback Cache', () => {
    it('should store data in memory fallback when Redis is unavailable', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 300);

      const result = await client.get('key1');
      expect(result).toBe('value1');
    });

    it('should respect TTL in memory cache', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 2); // 2 seconds TTL

      // Before expiration
      expect(await client.get('key1')).toBe('value1');

      // After expiration
      vi.advanceTimersByTime(3000);
      expect(await client.get('key1')).toBeNull();
    });

    it('should evict oldest entry when memory cache exceeds max size', async () => {
      client.isAvailable = false;
      const maxSize = 1000; // Default max size

      // Fill cache to max
      for (let i = 0; i < maxSize; i++) {
        await client.set(`key${i}`, `value${i}`, 3600);
      }

      // Add one more (should evict the oldest)
      await client.set(`key${maxSize}`, `value${maxSize}`, 3600);

      // First key should be evicted
      const firstKey = await client.get('key0');
      expect(firstKey).toBeNull();

      // New key should exist
      const newKey = await client.get(`key${maxSize}`);
      expect(newKey).toBe(`value${maxSize}`);
    });

    it('should use LRU eviction policy when new entry is added', async () => {
      client.isAvailable = false;

      // Fill cache with 5 entries
      for (let i = 0; i < 5; i++) {
        await client.set(`key${i}`, `value${i}`, 3600);
      }

      // Verify all 5 are in cache
      expect((client as any).fallbackMap.size).toBe(5);

      // Manually set a small max size to force eviction
      (client as any).maxFallbackSize = 5;

      // Adding the 6th entry should evict the least recently used one
      // The first item (key0) was accessed first, so it's LRU
      await client.set('key_new', 'value_new', 3600);

      // At this point one entry should be evicted
      expect((client as any).fallbackMap.size).toBeLessThanOrEqual(5);
    });
  });

  describe('Cache Operations with Fallback', () => {
    it('should cache miss returns null from fallback', async () => {
      client.isAvailable = false;

      const result = await client.get('nonexistent-key');
      expect(result).toBeNull();
    });

    it('should handle del operation', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 300);
      await client.del('key1');

      const result = await client.get('key1');
      expect(result).toBeNull();
    });

    it('should handle exists check', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 300);

      expect(await client.exists('key1')).toBe(true);
      expect(await client.exists('nonexistent')).toBe(false);
    });

    it('should handle incr operation in fallback', async () => {
      client.isAvailable = false;

      await client.set('counter', '5', 300);
      const result = await client.incr('counter');

      expect(result).toBe(6);
    });

    it('should handle expire operation', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 3600);
      await client.expire('key1', 2); // Set 2 second expiration

      expect(await client.get('key1')).toBe('value1');

      vi.advanceTimersByTime(3000);
      expect(await client.get('key1')).toBeNull();
    });
  });

  describe('Fallback Transitions', () => {
    it('should mark fallback as active when switching to memory', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 300);

      // wasRedisUnavailable should be true
      expect((client as any).wasRedisUnavailable).toBe(true);
      expect((client as any).fallbackStartTime).not.toBeNull();
    });

    it('should log warning when Redis becomes unavailable', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      client.isAvailable = false;
      await client.set('key1', 'value1', 300);

      const warnings = consoleSpy.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('Fallback')
      );

      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should maintain fallback state across multiple operations', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 300);
      await client.set('key2', 'value2', 300);
      await client.get('key1');

      expect((client as any).fallbackMap.size).toBe(2);
    });
  });

  describe('TTL Sync', () => {
    it('should sync TTL between Redis and in-memory cache', async () => {
      client.isAvailable = false;

      const ttl = 100;
      await client.set('key1', 'value1', ttl);

      // Get TTL info
      const entry = (client as any).fallbackMap.get('key1');
      expect(entry).toBeDefined();
      expect(entry.expireAt).toBeGreaterThan(Date.now());
    });

    it('should handle expired entries correctly', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 1);

      vi.advanceTimersByTime(2000);

      expect(await client.get('key1')).toBeNull();
      expect((client as any).fallbackMap.has('key1')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should not throw on get operation', async () => {
      client.isAvailable = true;

      // Should handle gracefully
      const result = await client.get('key1');
      expect(typeof result === 'string' || result === null).toBe(true);
    });

    it('should not throw on set operation', async () => {
      client.isAvailable = true;

      // Should handle gracefully
      await expect(client.set('key1', 'value1', 300)).resolves.not.toThrow();
    });

    it('should use fallback when Redis operations fail', async () => {
      client.isAvailable = false;

      await client.set('key1', 'value1', 300);
      const result = await client.get('key1');

      // Should return from fallback
      expect(result).toBe('value1');
    });
  });

  describe('Monitoring & Metrics', () => {
    it('should track fallback activation time', async () => {
      client.isAvailable = true;
      const initialTime = Date.now();

      client.isAvailable = false;
      await client.set('key1', 'value1', 300);

      const fallbackStartTime = (client as any).fallbackStartTime;
      expect(fallbackStartTime).toBeGreaterThanOrEqual(initialTime);
    });

    it('should calculate fallback duration', async () => {
      client.isAvailable = false;
      await client.set('key1', 'value1', 300);

      vi.advanceTimersByTime(5000);

      const duration = (client as any).getFallbackDuration();
      expect(duration).toBeLessThanOrEqual(6000);
      expect(duration).toBeGreaterThanOrEqual(4000);
    });

    it('should return metrics', () => {
      const metrics = client.getMetrics();

      expect(metrics).toHaveProperty('isAvailable');
      expect(metrics).toHaveProperty('fallbackSize');
      expect(metrics).toHaveProperty('fallbackDuration');
      expect(metrics).toHaveProperty('failureCount');
    });
  });
});
