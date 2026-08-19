import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GracefulShutdownManager } from '../lib/graceful-shutdown';
import { Server } from 'http';

/**
 * `Server#close` and `Server#once` are chainable: both return the server.
 * These mocks used to return `undefined`, which only ever "worked" because
 * the test files were never type-checked. Returning the fake keeps every
 * mock honest against the contract `GracefulShutdownManager` programs
 * against, instead of against a shape that exists nowhere.
 */
type ServerCloseCallback = (err?: Error) => void;
type ServerListener = (...args: unknown[]) => void;

describe('Graceful Shutdown Manager', () => {
  let mockServer: Partial<Server>;
  let mockPrisma: any;
  let mockRedis: any;

  const asServer = () => mockServer as Server;

  beforeEach(() => {
    // Mock server
    mockServer = {
      close: vi.fn((callback?: ServerCloseCallback) => {
        if (callback) setTimeout(callback, 10);
        return asServer();
      }),
      once: vi.fn((event: string | symbol, listener: ServerListener) => {
        if (event === 'close') {
          setTimeout(listener, 50);
        }
        return asServer();
      }),
    };

    // Mock Prisma
    mockPrisma = {
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    // Mock Redis
    mockRedis = {
      quit: vi.fn((callback) => {
        setTimeout(callback, 10);
      }),
    };
  });

  describe('Signal Handler Registration', () => {
    it('should register SIGTERM and SIGINT handlers', () => {
      const onSpy = vi.spyOn(process, 'on');
      
      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      manager.registerHandlers();

      // Should register both signals
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

      onSpy.mockRestore();
    });
  });

  describe('Request Tracking', () => {
    it('should track in-flight requests', () => {
      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      expect(manager['requestCount']).toBe(0);

      manager.trackRequest();
      expect(manager['requestCount']).toBe(1);

      manager.trackRequest();
      expect(manager['requestCount']).toBe(2);

      manager.releaseRequest();
      expect(manager['requestCount']).toBe(1);

      manager.releaseRequest();
      expect(manager['requestCount']).toBe(0);
    });

    it('should handle multiple request tracking', () => {
      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      for (let i = 0; i < 5; i++) {
        manager.trackRequest();
      }
      expect(manager['requestCount']).toBe(5);

      for (let i = 0; i < 3; i++) {
        manager.releaseRequest();
      }
      expect(manager['requestCount']).toBe(2);
    });
  });

  describe('Configuration', () => {
    it('should use default timeouts if not provided', () => {
      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      expect(manager['config'].httpTimeoutMs).toBe(30000);
      expect(manager['config'].redisTimeoutMs).toBe(20000);
      expect(manager['config'].prismaTimeoutMs).toBe(30000);
    });

    it('should accept custom timeouts', () => {
      const customConfig = {
        httpTimeoutMs: 45000,
        redisTimeoutMs: 25000,
        prismaTimeoutMs: 35000,
      };

      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis,
        customConfig
      );

      expect(manager['config']).toEqual(customConfig);
    });

    it('should respect individual timeout overrides', () => {
      const config = {
        httpTimeoutMs: 60000,
        redisTimeoutMs: 20000,
        prismaTimeoutMs: 30000,
      };

      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis,
        config
      );

      expect(manager['config'].httpTimeoutMs).toBe(60000);
      expect(manager['config'].redisTimeoutMs).toBe(20000);
    });
  });

  describe('Shutdown Idempotency', () => {
    it('should only shutdown once even if called multiple times', async () => {
      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      // Simulate calling shutdown twice
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      try {
        await manager['shutdown']('SIGTERM');
      } catch {
        // Expected: process.exit throws
      }

      expect(manager['isShuttingDown']).toBe(true);

      // Second call should be ignored
      const serverCloseSpy = vi.spyOn(mockServer, 'close');
      serverCloseSpy.mockClear();

      try {
        await manager['shutdown']('SIGTERM');
      } catch {
        // Expected
      }

      expect(serverCloseSpy).not.toHaveBeenCalled();

      exitSpy.mockRestore();
    });
  });

  describe('Shutdown Sequence', () => {
    it('should call close methods in correct order', async () => {
      const callOrder: string[] = [];

      mockServer.close = vi.fn((callback?: ServerCloseCallback) => {
        callOrder.push('http-close');
        if (callback) setTimeout(callback, 10);
        return asServer();
      });

      mockRedis.quit = vi.fn((callback) => {
        callOrder.push('redis-quit');
        setTimeout(callback, 10);
      });

      mockPrisma.$disconnect = vi.fn(() => {
        callOrder.push('prisma-disconnect');
        return Promise.resolve();
      });

      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      try {
        await manager['shutdown']('SIGTERM');
      } catch {
        // Expected: process.exit
      }

      // Verify order: HTTP → Redis → Prisma
      expect(callOrder[0]).toBe('http-close');
      expect(callOrder[1]).toBe('redis-quit');
      expect(callOrder[2]).toBe('prisma-disconnect');

      exitSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis closure errors gracefully', async () => {
      const redisError = new Error('Redis connection error');
      mockRedis.quit = vi.fn((callback) => {
        setTimeout(() => callback(redisError), 10);
      });

      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      try {
        await manager['shutdown']('SIGTERM');
      } catch {
        // Expected
      }

      // Should exit with code 0 despite Redis error (it's just logged)
      // The shutdown continues
      exitSpy.mockRestore();
    });

    it('should handle Prisma disconnection errors gracefully', async () => {
      const prismaError = new Error('Prisma disconnection error');
      mockPrisma.$disconnect = vi.fn().mockRejectedValue(prismaError);

      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis
      );

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      try {
        await manager['shutdown']('SIGTERM');
      } catch {
        // Expected
      }

      // Should still complete shutdown
      expect(mockPrisma.$disconnect).toHaveBeenCalled();

      exitSpy.mockRestore();
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout if HTTP server takes too long', async () => {
      mockServer.close = vi.fn(() => {
        // Never calls the callback (simulates hanging)
        return asServer();
      });

      const config = {
        httpTimeoutMs: 100, // Short timeout for testing
        redisTimeoutMs: 20000,
        prismaTimeoutMs: 30000,
      };

      const manager = new GracefulShutdownManager(
        mockServer as Server,
        mockPrisma,
        mockRedis,
        config
      );

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      try {
        await manager['shutdown']('SIGTERM');
      } catch {
        // Expected
      }

      // Server close should still be called
      expect(mockServer.close).toHaveBeenCalled();

      exitSpy.mockRestore();
    });
  });
});
