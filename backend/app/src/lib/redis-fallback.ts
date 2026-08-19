import { Redis } from 'ioredis';
import { env } from '../config/env.config';

interface CacheEntry {
  value: string;
  expireAt: number;
}

/**
 * RedisClientWithFallback
 * Provides Redis operations with automatic in-memory fallback when Redis is unavailable.
 * - Health check every 10s
 * - In-memory cache with TTL and LRU eviction (max 1000 entries)
 * - Wrapped commands: get, set, del, exists, incr, expire
 */
export class RedisClientWithFallback {
  private redis: Redis;
  public isAvailable: boolean = true;

  private fallbackMap = new Map<string, CacheEntry>();
  private maxFallbackSize = 1000;
  private accessTimes = new Map<string, number>(); // For LRU tracking

  private failureCount = 0;
  private lastFailureTime = 0;
  private failureThreshold = 3;

  private fallbackStartTime: number | null = null;
  private wasRedisUnavailable = false;

  constructor(url: string) {
    const redisUrl = url || env.REDIS_URL || 'redis://localhost:6379';

    this.redis = new Redis(redisUrl, {
      enableReadyCheck: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry indefinitely
    });

    this.setupRedisListeners();
    this.startHealthCheck();
  }

  private setupRedisListeners(): void {
    this.redis.on('error', (err: Error) => {
      this.handleRedisError(err);
    });

    this.redis.on('connect', () => {
      if (this.wasRedisUnavailable) {
        const fallbackDuration = this.getFallbackDuration();
        console.log(`[Redis] Recovered from fallback. Fallback duration: ${fallbackDuration}ms`);
        this.wasRedisUnavailable = false;
        this.fallbackStartTime = null;
      }

      this.isAvailable = true;
      this.failureCount = 0;
      console.log('[Redis] Connected successfully');
    });

    this.redis.on('close', () => {
      console.warn('[Redis] Connection closed');
      this.isAvailable = false;
    });
  }

  private handleRedisError(err: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      if (!this.wasRedisUnavailable) {
        console.warn(
          `[Redis] Marked unavailable after ${this.failureCount} consecutive failures`
        );
        this.wasRedisUnavailable = true;
        this.fallbackStartTime = Date.now();
      }
      this.isAvailable = false;
    }
  }

  private startHealthCheck(): void {
    setInterval(() => {
      this.healthCheck();
    }, 10000); // Every 10 seconds
  }

  private async healthCheck(): Promise<void> {
    try {
      await this.redis.ping();

      if (!this.isAvailable) {
        this.isAvailable = true;
        this.failureCount = 0;
        console.log('[Redis] Health check passed - Redis is available');
      }
    } catch (err) {
      if (this.isAvailable) {
        console.warn('[Redis] Health check failed - switching to fallback');
      }
      this.isAvailable = false;
    }
  }

  private getFallbackDuration(): number {
    if (this.fallbackStartTime === null) return 0;
    return Date.now() - this.fallbackStartTime;
  }

  // ====== PUBLIC COMMANDS ======

  /**
   * Get a value from Redis or fallback cache
   */
  async get(key: string): Promise<string | null> {
    try {
      if (this.isAvailable) {
        return await this.redis.get(key);
      }
    } catch (err) {
      console.warn(`[Redis] Get failed for key '${key}', using fallback`);
      this.isAvailable = false;
    }

    return this.getFallback(key);
  }

  /**
   * Set a value in Redis or fallback cache
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      if (this.isAvailable) {
        await this.redis.setex(key, ttlSeconds, value);
        return;
      }
    } catch (err) {
      console.warn(`[Redis] Set failed for key '${key}', using fallback`);
      this.isAvailable = false;
    }

    if (!this.wasRedisUnavailable) {
      console.warn(`[Fallback] Cache SET activated for key '${key}'`);
      this.wasRedisUnavailable = true;
      this.fallbackStartTime = Date.now();
    }

    this.setFallback(key, value, ttlSeconds);
  }

  /**
   * Delete a key from Redis or fallback cache
   */
  async del(key: string): Promise<number> {
    try {
      if (this.isAvailable) {
        return await this.redis.del(key);
      }
    } catch (err) {
      console.warn(`[Redis] Del failed for key '${key}', using fallback`);
      this.isAvailable = false;
    }

    const existed = this.fallbackMap.has(key);
    this.fallbackMap.delete(key);
    this.accessTimes.delete(key);
    return existed ? 1 : 0;
  }

  /**
   * Check if a key exists in Redis or fallback cache
   */
  async exists(key: string): Promise<boolean> {
    try {
      if (this.isAvailable) {
        const result = await this.redis.exists(key);
        return result > 0;
      }
    } catch (err) {
      console.warn(`[Redis] Exists check failed for key '${key}', using fallback`);
      this.isAvailable = false;
    }

    const entry = this.fallbackMap.get(key);
    if (!entry) return false;

    if (entry.expireAt < Date.now()) {
      this.fallbackMap.delete(key);
      this.accessTimes.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Increment a numeric value in Redis or fallback cache
   */
  async incr(key: string): Promise<number> {
    try {
      if (this.isAvailable) {
        return await this.redis.incr(key);
      }
    } catch (err) {
      console.warn(`[Redis] Incr failed for key '${key}', using fallback`);
      this.isAvailable = false;
    }

    const entry = this.fallbackMap.get(key);

    let value = 0;
    if (entry && entry.expireAt > Date.now()) {
      value = parseInt(entry.value, 10);
      if (isNaN(value)) value = 0;
    }

    const newValue = value + 1;
    this.setFallback(key, newValue.toString(), 3600); // 1 hour default

    return newValue;
  }

  /**
   * Set expiration on a key in Redis or fallback cache
   */
  async expire(key: string, seconds: number): Promise<void> {
    try {
      if (this.isAvailable) {
        await this.redis.expire(key, seconds);
        return;
      }
    } catch (err) {
      console.warn(`[Redis] Expire failed for key '${key}', using fallback`);
      this.isAvailable = false;
    }

    const entry = this.fallbackMap.get(key);
    if (entry) {
      entry.expireAt = Date.now() + seconds * 1000;
    }
  }

  // ====== FALLBACK HELPERS ======

  private getFallback(key: string): string | null {
    const entry = this.fallbackMap.get(key);

    if (!entry) return null;

    // Check expiration
    if (entry.expireAt < Date.now()) {
      this.fallbackMap.delete(key);
      this.accessTimes.delete(key);
      return null;
    }

    // Update access time for LRU
    this.accessTimes.set(key, Date.now());

    return entry.value;
  }

  private setFallback(key: string, value: string, ttlSeconds: number): void {
    // If already at max size, evict LRU entry
    if (
      this.fallbackMap.size >= this.maxFallbackSize &&
      !this.fallbackMap.has(key)
    ) {
      this.evictLRUEntry();
    }

    this.fallbackMap.set(key, {
      value,
      expireAt: Date.now() + ttlSeconds * 1000,
    });

    // Update access time for LRU
    this.accessTimes.set(key, Date.now());
  }

  private evictLRUEntry(): void {
    let lruKey: string | null = null;
    let oldestTime = Infinity;

    // Find least recently used key
    for (const [key, time] of this.accessTimes.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.fallbackMap.delete(lruKey);
      this.accessTimes.delete(lruKey);
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      console.error('[Redis] Error during disconnect:', err);
      await this.redis.disconnect();
    }

    this.fallbackMap.clear();
    this.accessTimes.clear();
  }

  /**
   * Get fallback metrics
   */
  getMetrics() {
    return {
      isAvailable: this.isAvailable,
      fallbackSize: this.fallbackMap.size,
      fallbackDuration: this.fallbackStartTime ? this.getFallbackDuration() : 0,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
