/**
 * Auth Service - Comprehensive Tests
 * 
 * Coverage:
 * - register() method: success, duplicate email, password hashing
 * - login() method: success, wrong password, user not found
 * - getUserById() method: found, not found
 * - Token generation: access token, refresh token, payload correctness
 * - Token verification: valid tokens, expired tokens, invalid tokens
 * - Error handling: ConflictError, UnauthorizedError
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import AuthService, { authService } from '../services/auth.service';
import { prisma } from '../lib/prisma';
import { UnauthorizedError, ConflictError } from '../middlewares/error.middleware';

// Mock Prisma
vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock bcrypt
vi.mock('bcrypt', () => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  sign: vi.fn(),
  verify: vi.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    password: 'hashed-password-123',
  };

  const mockHashedPassword = 'hashed-password-new';

  beforeEach(() => {
    service = new AuthService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('register()', () => {
    it('should successfully register a new user', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(null);
      (bcrypt.hash as Mock).mockResolvedValueOnce(mockHashedPassword);
      (prisma.user.create as Mock).mockResolvedValueOnce(mockUser);
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      const result = await service.register({
        email: mockUser.email,
        password: 'plaintext-password',
      });

      // Assert
      expect(result.user.id).toBe(mockUser.id);
      expect(result.user.email).toBe(mockUser.email);
      expect(result.accessToken).toBe('access-token-mock');
      expect(result.refreshToken).toBe('refresh-token-mock');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: mockUser.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext-password', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: mockUser.email,
          password: mockHashedPassword,
        },
      });
    });

    it('should throw ConflictError if user already exists', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);

      // Act & Assert
      await expect(
        service.register({
          email: mockUser.email,
          password: 'plaintext-password',
        })
      ).rejects.toThrow(ConflictError);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should hash password with correct bcrypt rounds', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(null);
      (bcrypt.hash as Mock).mockResolvedValueOnce(mockHashedPassword);
      (prisma.user.create as Mock).mockResolvedValueOnce(mockUser);
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      await service.register({
        email: mockUser.email,
        password: 'plaintext-password',
      });

      // Assert
      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext-password', 10);
    });

    it('should return tokens with user ID and email', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(null);
      (bcrypt.hash as Mock).mockResolvedValueOnce(mockHashedPassword);
      (prisma.user.create as Mock).mockResolvedValueOnce(mockUser);
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      const result = await service.register({
        email: mockUser.email,
        password: 'plaintext-password',
      });

      // Assert
      expect(jwt.sign).toHaveBeenCalledWith(
        { userId: mockUser.id, email: mockUser.email },
        expect.any(String),
        expect.objectContaining({ expiresIn: '15m', algorithm: 'HS256' })
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        { userId: mockUser.id },
        expect.any(String),
        expect.objectContaining({ expiresIn: '7d', algorithm: 'HS256' })
      );
    });
  });

  describe('login()', () => {
    it('should successfully login with correct credentials', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as Mock).mockResolvedValueOnce(true);
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      const result = await service.login({
        email: mockUser.email,
        password: 'plaintext-password',
      });

      // Assert
      expect(result.user.id).toBe(mockUser.id);
      expect(result.user.email).toBe(mockUser.email);
      expect(result.accessToken).toBe('access-token-mock');
      expect(result.refreshToken).toBe('refresh-token-mock');
    });

    it('should throw UnauthorizedError if user not found', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'plaintext-password',
        })
      ).rejects.toThrow(UnauthorizedError);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if password is incorrect', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as Mock).mockResolvedValueOnce(false);

      // Act & Assert
      await expect(
        service.login({
          email: mockUser.email,
          password: 'wrong-password',
        })
      ).rejects.toThrow(UnauthorizedError);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('should query user with only necessary fields', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as Mock).mockResolvedValueOnce(true);
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      await service.login({
        email: mockUser.email,
        password: 'plaintext-password',
      });

      // Assert
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: mockUser.email },
        select: {
          id: true,
          email: true,
          password: true,
        },
      });
    });

    it('should compare passwords using bcrypt', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as Mock).mockResolvedValueOnce(true);
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      await service.login({
        email: mockUser.email,
        password: 'plaintext-password',
      });

      // Assert
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'plaintext-password',
        mockUser.password
      );
    });
  });

  describe('getUserById()', () => {
    it('should retrieve user by ID with minimal fields', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce({
        id: mockUser.id,
        email: mockUser.email,
      });

      // Act
      const result = await service.getUserById(mockUser.id);

      // Assert
      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        select: {
          id: true,
          email: true,
        },
      });
    });

    it('should return null if user not found', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(null);

      // Act
      const result = await service.getUserById('nonexistent-id');

      // Assert
      expect(result).toBeNull();
    });

    it('should not include password field', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce({
        id: mockUser.id,
        email: mockUser.email,
      });

      // Act
      await service.getUserById(mockUser.id);

      // Assert
      const selectArg = (prisma.user.findUnique as Mock).mock.calls[0][0].select;
      expect(selectArg.password).toBeUndefined();
    });
  });

  describe('generateTokens()', () => {
    it('should generate both access and refresh tokens', () => {
      // Arrange
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      const { accessToken, refreshToken } = service.generateTokens({
        userId: mockUser.id,
        email: mockUser.email,
      });

      // Assert
      expect(accessToken).toBe('access-token-mock');
      expect(refreshToken).toBe('refresh-token-mock');
    });

    it('should use correct expiry times', () => {
      // Arrange
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      service.generateTokens({
        userId: mockUser.id,
        email: mockUser.email,
      });

      // Assert
      const [accessTokenCall, refreshTokenCall] = (jwt.sign as Mock).mock.calls;

      expect(accessTokenCall[2]).toMatchObject({
        expiresIn: '15m',
        algorithm: 'HS256',
      });

      expect(refreshTokenCall[2]).toMatchObject({
        expiresIn: '7d',
        algorithm: 'HS256',
      });
    });

    it('should include user data in access token payload', () => {
      // Arrange
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      service.generateTokens({
        userId: mockUser.id,
        email: mockUser.email,
      });

      // Assert
      const accessTokenPayload = (jwt.sign as Mock).mock.calls[0][0];
      expect(accessTokenPayload).toEqual({
        userId: mockUser.id,
        email: mockUser.email,
      });
    });

    it('should include only userId in refresh token payload', () => {
      // Arrange
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      service.generateTokens({
        userId: mockUser.id,
        email: mockUser.email,
      });

      // Assert
      const refreshTokenPayload = (jwt.sign as Mock).mock.calls[1][0];
      expect(refreshTokenPayload).toEqual({
        userId: mockUser.id,
      });
      expect(refreshTokenPayload.email).toBeUndefined();
    });
  });

  describe('verifyAccessToken()', () => {
    it('should verify and decode valid access token', () => {
      // Arrange
      const mockPayload = { userId: mockUser.id, email: mockUser.email };
      (jwt.verify as Mock).mockReturnValueOnce(mockPayload);

      // Act
      const result = service.verifyAccessToken('valid-token');

      // Assert
      expect(result).toEqual(mockPayload);
      expect(jwt.verify).toHaveBeenCalledWith(
        'valid-token',
        expect.any(String)
      );
    });

    it('should throw error if token is invalid', () => {
      // Arrange
      const error = new Error('jwt malformed');
      (jwt.verify as Mock).mockImplementationOnce(() => {
        throw error;
      });

      // Act & Assert
      expect(() => service.verifyAccessToken('invalid-token')).toThrow();
    });

    it('should throw error if token is expired', () => {
      // Arrange
      const error = new Error('jwt expired');
      (jwt.verify as Mock).mockImplementationOnce(() => {
        throw error;
      });

      // Act & Assert
      expect(() => service.verifyAccessToken('expired-token')).toThrow();
    });
  });

  describe('verifyRefreshToken()', () => {
    it('should verify and decode valid refresh token', () => {
      // Arrange
      const mockPayload = { userId: mockUser.id };
      (jwt.verify as Mock).mockReturnValueOnce(mockPayload);

      // Act
      const result = service.verifyRefreshToken('valid-refresh-token');

      // Assert
      expect(result).toEqual(mockPayload);
      expect(jwt.verify).toHaveBeenCalledWith(
        'valid-refresh-token',
        expect.any(String)
      );
    });

    /*
     * CHARACTERIZATION (2026-07-29). This slot used to hold
     * 'should only return userId from refresh token', which asserted
     * `expect(result.email).toBeUndefined()` on a mocked payload of
     * `{ userId }` -- a payload that never had an `email` to begin with. The
     * assertion was true no matter what the implementation did: the test
     * could not fail. It only came to light because the test files started
     * being type-checked, and `{ userId: string }` has no `email`.
     *
     * The guarantee its name claimed is real, but it does NOT live here.
     * `verifyRefreshToken` is `jwt.verify(...) as { userId: string }`: the
     * cast narrows the STATIC type and strips nothing at runtime, so any
     * extra claim inside a refresh token comes straight back out. What keeps
     * extra claims out of a refresh token is the SIGNER --
     * `generateTokens` signs `{ userId }` -- and that is already covered by
     * 'should include only userId in refresh token payload' above.
     *
     * So this pins the pass-through instead of pretending it is a filter.
     * Unlike the assertion it replaces, this one dies the day the verifier
     * starts narrowing -- which is the day the comment above needs deleting.
     */
    it('passes the decoded payload through unchanged, extra claims included', () => {
      // Arrange: a payload carrying more than the return type admits
      const decodedPayload = {
        userId: mockUser.id,
        email: mockUser.email,
        role: 'admin',
      };
      (jwt.verify as Mock).mockReturnValueOnce(decodedPayload);

      // Act
      const result = service.verifyRefreshToken('valid-refresh-token');

      // Assert
      expect(result.userId).toBe(mockUser.id);
      expect(result).toEqual(decodedPayload);
    });

    it('should throw error if refresh token is invalid', () => {
      // Arrange
      const error = new Error('jwt malformed');
      (jwt.verify as Mock).mockImplementationOnce(() => {
        throw error;
      });

      // Act & Assert
      expect(() => service.verifyRefreshToken('invalid-token')).toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle Prisma errors gracefully', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      // Act & Assert
      await expect(
        service.login({
          email: mockUser.email,
          password: 'plaintext-password',
        })
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle bcrypt errors gracefully', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as Mock).mockRejectedValueOnce(
        new Error('Bcrypt hashing failed')
      );

      // Act & Assert
      await expect(
        service.login({
          email: mockUser.email,
          password: 'plaintext-password',
        })
      ).rejects.toThrow('Bcrypt hashing failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty email string', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.login({
          email: '',
          password: 'plaintext-password',
        })
      ).rejects.toThrow();
    });

    it('should handle empty password string', async () => {
      // Arrange
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as Mock).mockResolvedValueOnce(false);

      // Act & Assert
      await expect(
        service.login({
          email: mockUser.email,
          password: '',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should handle very long email', async () => {
      // Arrange
      const longEmail = 'a'.repeat(200) + '@example.com';
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.login({
          email: longEmail,
          password: 'plaintext-password',
        })
      ).rejects.toThrow('Invalid credentials');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: longEmail },
        select: {
          id: true,
          email: true,
          password: true,
        },
      });
    });

    it('should handle special characters in password', async () => {
      // Arrange
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      (prisma.user.findUnique as Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as Mock).mockResolvedValueOnce(true);
      (jwt.sign as Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');

      // Act
      await service.login({
        email: mockUser.email,
        password: specialPassword,
      });

      // Assert
      expect(bcrypt.compare).toHaveBeenCalledWith(
        specialPassword,
        mockUser.password
      );
    });
  });
});
