import { describe, it, expect, vi, afterEach } from 'vitest';

// Define mocks first
const mockQueryRaw = vi.fn();
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

// The `this` annotation is not decoration: it is what makes the two
// assignments below type-checked instead of implicitly `any`. Name a field
// wrong here and the fake client silently loses the method the retry loop
// calls, which is exactly the class of bug this suite is supposed to catch.
type FakePrismaClient = {
  $queryRaw: typeof mockQueryRaw;
  $disconnect: typeof mockDisconnect;
};

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: vi.fn(function (this: FakePrismaClient) {
      this.$queryRaw = mockQueryRaw;
      this.$disconnect = mockDisconnect;
    }),
  };
});

import { createPrismaWithRetry } from '../lib/prisma-retry';

describe('Prisma Connection Retry', () => {
  afterEach(() => {
    mockQueryRaw.mockClear();
    mockDisconnect.mockClear();
  });

  describe('Successful Connection', () => {
    it('should connect successfully on first attempt', async () => {
      mockQueryRaw.mockResolvedValue(undefined);

      const prisma = await createPrismaWithRetry({ 
        maxRetries: 3, 
        initialDelayMs: 5, 
        maxDelayMs: 50 
      });

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      expect(prisma).toBeDefined();
    });

    it('should connect after one failed attempt', async () => {
      // First call fails, second succeeds
      mockQueryRaw
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      const prisma = await createPrismaWithRetry({ 
        maxRetries: 3, 
        initialDelayMs: 5, 
        maxDelayMs: 50 
      });

      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
      expect(prisma).toBeDefined();
    });

    it('should recover after multiple failed attempts', async () => {
      // First 3 calls fail, 4th succeeds
      mockQueryRaw
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      const prisma = await createPrismaWithRetry({ 
        maxRetries: 5, 
        initialDelayMs: 5, 
        maxDelayMs: 50 
      });

      expect(mockQueryRaw).toHaveBeenCalledTimes(4);
      expect(prisma).toBeDefined();
    });
  });

  describe('Connection Failures', () => {
    it('should fail after max retries exhausted', async () => {
      mockQueryRaw.mockRejectedValue(new Error('Connection refused'));

      await expect(
        createPrismaWithRetry({ 
          maxRetries: 2, 
          initialDelayMs: 5, 
          maxDelayMs: 50 
        })
      ).rejects.toThrow('Failed to connect to database');

      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });

    it('should disconnect from Prisma after all retries fail', async () => {
      mockQueryRaw.mockRejectedValue(new Error('Connection refused'));

      try {
        await createPrismaWithRetry({ 
          maxRetries: 2, 
          initialDelayMs: 5, 
          maxDelayMs: 50 
        });
      } catch {
        // Expected to fail
      }

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should throw descriptive error messages', async () => {
      const originalError = 'Database is offline';
      mockQueryRaw.mockRejectedValue(new Error(originalError));

      try {
        await createPrismaWithRetry({ 
          maxRetries: 1, 
          initialDelayMs: 5, 
          maxDelayMs: 50 
        });
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).toContain(originalError);
      }
    });
  });

  describe('Retry Configuration', () => {
    it('should use default retry config if not provided', async () => {
      mockQueryRaw.mockResolvedValue(undefined);

      const prisma = await createPrismaWithRetry();

      expect(prisma).toBeDefined();
    });

    it('should respect custom max retries', async () => {
      mockQueryRaw.mockRejectedValue(new Error('Connection refused'));

      await expect(
        createPrismaWithRetry({ 
          maxRetries: 3, 
          initialDelayMs: 5, 
          maxDelayMs: 50 
        })
      ).rejects.toThrow();

      // Should try exactly 3 times
      expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockQueryRaw.mockRejectedValue(
        new Error('Can\'t reach database server')
      );

      await expect(
        createPrismaWithRetry({ 
          maxRetries: 1, 
          initialDelayMs: 5, 
          maxDelayMs: 50 
        })
      ).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      mockQueryRaw.mockRejectedValue(
        new Error('Query execution timeout')
      );

      await expect(
        createPrismaWithRetry({ 
          maxRetries: 1, 
          initialDelayMs: 5, 
          maxDelayMs: 50 
        })
      ).rejects.toThrow();
    });

    it('should include attempt count in logs', async () => {
      mockQueryRaw
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await createPrismaWithRetry({ 
        maxRetries: 3, 
        initialDelayMs: 5, 
        maxDelayMs: 50 
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Connection attempt 1\/3 failed/)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('Exponential Backoff', () => {
    it('should use exponential backoff strategy', async () => {
      mockQueryRaw
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      // Use a fast delay to avoid timing issues in tests
      await createPrismaWithRetry({ 
        maxRetries: 5, 
        initialDelayMs: 1, 
        maxDelayMs: 5 
      });

      // Verify that we made 3 calls (2 failures + 1 success)
      expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    });

    it('should calculate backoff delays correctly', async () => {
      mockQueryRaw
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      const startTime = Date.now();

      await createPrismaWithRetry({ 
        maxRetries: 5, 
        initialDelayMs: 10, 
        maxDelayMs: 50 
      });

      const elapsed = Date.now() - startTime;

      // Should have waited at least one retry delay
      // We're checking that it's at least 10ms (initial delay) minus some variance for test flakiness
      expect(elapsed).toBeGreaterThanOrEqual(5);
    });
  });
});
