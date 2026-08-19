import { Redis } from 'ioredis';
import { env } from '../config/env.config';

const REDIS_URL = env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    keyPrefix: 'kinetic:',
});

redis.on('error', (err) => {
    console.error('[Redis Error] Could not connect or error occurred:', err);
});

redis.on('connect', () => {
    console.log('[Redis] Connected successfully to', REDIS_URL);
});

// Invalidate cache keys by pattern (use with caution)
export async function invalidateByPattern(pattern: string): Promise<number> {
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            console.log(`[Redis] Invalidating ${keys.length} keys matching "${pattern}"`);
            await redis.del(...keys);
            return keys.length;
        }
        return 0;
    }
    catch (err) {
        console.error('[Redis] Error invalidating pattern', pattern, err);
        throw err;
    }
}

// Simple in-memory fallback for caching async functions
// @ts-ignore - lru-cache v5 types might be tricky in this setup
import LRU from 'lru-cache';

const memoryCache = new LRU<string, any>({
    max: 500,
    maxAge: 1000 * 60 * 5, // 5 minutes (v5 uses maxAge instead of ttl)
});

// Helper for caching async functions with Redis fallback
export async function withCache<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    // Try Redis first
    try {
        const cached = await redis.get(key);
        if (cached) {
            return JSON.parse(cached);
        }
    }
    catch (redisErr: any) {
        // Redis down - fallback to memory
        const memCached = memoryCache.get(key);
        if (memCached) {
            console.warn(`[Redis Fallback] Using memory cache for ${key}`);
            return memCached;
        }
        console.warn('[Redis] Error reading cache, falling back to memory:', redisErr.message);
    }

    // Fetch fresh data
    const result = await fetcher();

    // Store in cache
    try {
        if (result !== undefined && result !== null) {
            await redis.setex(key, ttlSeconds, JSON.stringify(result));
        }
    }
    catch (setErr: any) {
        // Redis down - store in memory
        console.warn('[Redis] Error setting cache, falling back to memory:', setErr.message);
        memoryCache.set(key, result, { ttl: Math.min(ttlSeconds * 1000, 1000 * 60 * 5) }); // Max 5 min in memory
    }

    return result;
}
