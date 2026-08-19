import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.config';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
    }
  }
}

/**
 * JWT authentication middleware
 * Reads token from HttpOnly cookie, verifies signature, attaches user to req
 * 
 * Security note: This middleware reads from req.cookies which is only
 * available after cookieParser middleware has been set up in app.ts
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    // Security: read the token ONLY from the HttpOnly cookie. Accepting an
    // Authorization: Bearer header would let a JS-readable token bypass the
    // XSS protection that HttpOnly cookies provide, so we deliberately do not.
    const token = req.cookies?.auth_token;

    if (!token) {
      res.status(401).json({ error: 'No authentication token found' });
      return;
    }

    // Verify JWT signature and expiration
    const payload = jwt.verify(token, env.JWT_SECRET);

    // Attach user to request for downstream handlers
    req.user = payload as { userId: string; email: string };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired' });
    } else if (error.name === 'JsonWebTokenError') {
      res.status(401).json({ error: 'Invalid token signature' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}