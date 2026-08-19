import { Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../lib/redis';
import { env } from '../config/env.config';

const rateLimitMiddleware = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  // In test mode: allow unlimited requests
  limit: process.env.NODE_ENV === 'test' ? Infinity : env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - ioredis client is compatible
    sendCommand: (...args: string[]) => redis.call(...args),
  }),
  message: {
    status: 429,
    message: 'Too many requests, please try again later.',
  },
});

export const rateLimiter = rateLimitMiddleware;

const OFF_PROXY_WINDOW_MS = 60_000;
const OFF_PROXY_MAX = 30;

export const offProxyLimiter = rateLimit({
  windowMs: OFF_PROXY_WINDOW_MS,
  limit: process.env.NODE_ENV === 'test' ? Infinity : OFF_PROXY_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - ioredis client is compatible
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix: 'rl:off:',
  }),
  message: { status: 429, message: 'Demasiadas consultas a la base de alimentos externa, probá de nuevo en un momento.' },
});
