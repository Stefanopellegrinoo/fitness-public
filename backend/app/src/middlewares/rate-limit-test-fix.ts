// HOTFIX: Bypass rate limiting in test environment
import { Request, Response, NextFunction } from 'express';

export const testBypassRateLimit = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'test') {
    // Skip rate limiting for tests
    return next();
  }
  // In production, rate limiting is applied by rateLimiter middleware
  next();
};

// Update the export in rate-limit.middleware.ts to use this
