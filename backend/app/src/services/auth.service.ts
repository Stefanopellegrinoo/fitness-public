/**
 * Unified Authentication Service
 * 
 * Consolidates all authentication operations:
 * - User registration
 * - User login validation
 * - Token generation and verification
 * - User lookup by ID
 * - Password verification
 * 
 * All auth logic flows through this single service,
 * eliminating duplication across routes and middleware.
 */

import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../config/env.config';
import { UnauthorizedError, ConflictError } from '../middlewares/error.middleware';
import { RegisterInput, LoginInput } from '../validations/auth.validation';

// Single source of truth for JWT secrets: the validated env config.
// Reading process.env directly here allowed sign/verify to use different
// values when env.config had parsed before .env was loaded. Presence is
// enforced by the schema in env.config (loud failure at startup).
const JWT_SECRET = env.JWT_SECRET;
// Dedicated secret for refresh tokens (must differ from JWT_SECRET)
const JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET;

const JWT_ACCESS_EXPIRES_IN = '15m'; // 15 minutes
const JWT_REFRESH_EXPIRES_IN = '7d'; // 7 days

export interface TokenPayload {
  userId: string;
  email: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
  };
  accessToken: string;
  refreshToken: string;
}

/**
 * Unified Authentication Service
 */
class AuthService {
  /**
   * Registers a new user with hashed password
   */
  async register(input: RegisterInput): Promise<AuthResponse> {
    const { email, password } = input;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictError('User already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens({
      userId: user.id,
      email: user.email,
    });

    return {
      user: { id: user.id, email: user.email },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Authenticates user with email and password
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    const { email, password } = input;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens({
      userId: user.id,
      email: user.email,
    });

    return {
      user: { id: user.id, email: user.email },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Retrieves user by ID with minimal data
   */
  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
      },
    });

    return user;
  }

  /**
   * Generates access and refresh tokens
   */
  generateTokens(payload: TokenPayload) {
    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_ACCESS_EXPIRES_IN,
      algorithm: 'HS256',
    });

    // FIX: Refresh token usa secreto separado
    const refreshToken = jwt.sign(
      { userId: payload.userId },
      JWT_REFRESH_SECRET, // secreto dedicado
      { expiresIn: JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Verifies and decodes access token
   */
  verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  }

  /**
   * Verifies and decodes refresh token
   * FIX (2026-04-08): Usa JWT_REFRESH_SECRET
   */
  verifyRefreshToken(token: string): { userId: string } {
    return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string };
  }
}

// Export singleton instance
export const authService = new AuthService();
export default AuthService;
