import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { setAuthCookies, clearAuthCookies } from '../lib/cookie-auth';
import { authMiddleware } from '../middlewares/auth.middleware';
import { validateAuthInput, validate } from '../validations/auth.validation';
import { asyncHandler } from '../middlewares/error.middleware';

const router = Router();

/**
 * POST /api/auth/register
 * Registers a new user and sets HttpOnly authentication cookies
 */
router.post(
  '/register',
  validateAuthInput('register'),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    // Register user via unified AuthService
    const { user, accessToken, refreshToken } = await authService.register({
      email,
      password,
    });

    // Set HttpOnly cookies
    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({ data: { user } });
  })
);

/**
 * POST /api/auth/login
 * Authenticates user and sets HttpOnly authentication cookies
 */
router.post(
  '/login',
  validateAuthInput('login'),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    // Login via unified AuthService
    const { user, accessToken, refreshToken } = await authService.login({
      email,
      password,
    });

    // Set HttpOnly cookies
    setAuthCookies(res, accessToken, refreshToken);

    res.json({ data: { user } });
  })
);

/**
 * POST /api/auth/logout
 * Clears authentication cookies — no auth required
 *
 * FIX (2026-04-08): Se eliminó authMiddleware del logout.
 * Si el token está expirado, el middleware rechazaba la request con 401 antes
 * de poder limpiar las cookies → el usuario quedaba atrapado sin poder salir.
 * Logout siempre debe poder ejecutarse.
 */
router.post(
  '/logout',
  asyncHandler(async (_req: Request, res: Response) => {
    // Clear HttpOnly cookies unconditionally
    clearAuthCookies(res);

    res.json({ data: { message: 'Logged out successfully' } });
  })
);

/**
 * POST /api/auth/refresh
 * Refreshes the access token using refresh token from secure cookie
 */
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token not found' });
      return;
    }

    try {
      // Verify refresh token
      const decoded = authService.verifyRefreshToken(refreshToken);

      // Get user from database
      const user = await authService.getUserById(decoded.userId);

      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      // Generate new tokens
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
        authService.generateTokens({
          userId: user.id,
          email: user.email,
        });

      // Update cookies with new tokens
      setAuthCookies(res, newAccessToken, newRefreshToken);

      res.json({ data: { user: { id: user.id, email: user.email }, message: 'Token refreshed' } });
    } catch (error) {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  })
);

/**
 * GET /api/auth/me
 * Returns current authenticated user (via HttpOnly cookie)
 */
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.getUserById(req.user!.userId);

    res.json({
      data: { user },
    });
  })
);

export default router;
