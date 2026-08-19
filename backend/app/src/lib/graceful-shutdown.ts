/**
 * Graceful Shutdown Manager
 * 
 * Coordinates clean shutdown of the application by:
 * 1. Stopping HTTP server (no new connections)
 * 2. Waiting for in-flight requests to complete (up to timeout)
 * 3. Closing Redis connections
 * 4. Closing Prisma database connections
 */

import { Server } from 'http';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

interface ShutdownConfig {
  httpTimeoutMs: number;
  redisTimeoutMs: number;
  prismaTimeoutMs: number;
}

const DEFAULT_CONFIG: ShutdownConfig = {
  httpTimeoutMs: 30000,
  redisTimeoutMs: 20000,
  prismaTimeoutMs: 30000,
};

export class GracefulShutdownManager {
  private isShuttingDown = false;
  private requestCount = 0;

  constructor(
    private server: Server,
    private prisma: PrismaClient,
    private redis: Redis,
    private config: ShutdownConfig = DEFAULT_CONFIG
  ) {}

  /**
   * Registers signal handlers for SIGTERM and SIGINT
   */
  public registerHandlers(): void {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
  }

  /**
   * Increments in-flight request counter
   */
  public trackRequest(): void {
    this.requestCount++;
  }

  /**
   * Decrements in-flight request counter
   */
  public releaseRequest(): void {
    this.requestCount--;
  }

  /**
   * Executes graceful shutdown sequence
   */
  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      console.log(`[Shutdown] Already shutting down, ignoring ${signal}`);
      return;
    }

    this.isShuttingDown = true;
    console.log(`[Shutdown] Received ${signal}, starting graceful shutdown...`);
    console.log(`[Shutdown] In-flight requests: ${this.requestCount}`);

    try {
      // Step 1: Stop HTTP server (prevents new connections)
      await this.closeHttpServer();

      // Step 2: Close Redis (prevents new cache operations)
      await this.closeRedis();

      // Step 3: Close Prisma (prevents new database operations)
      await this.closePrisma();

      console.log('[Shutdown] Graceful shutdown completed successfully');
      // Don't exit in test mode (vitest doesn't allow process.exit)
      if (process.env.NODE_ENV !== 'test') {
        process.exit(0);
      }
    } catch (err) {
      console.error('[Shutdown] Error during graceful shutdown:', err);
      // Don't exit in test mode (vitest doesn't allow process.exit)
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }
  }

  /**
   * Closes HTTP server and waits for in-flight requests
   */
  private closeHttpServer(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Shutdown] HTTP server closure timeout exceeded');
        resolve();
      }, this.config.httpTimeoutMs);

      this.server.close(() => {
        clearTimeout(timeout);
        console.log('[Shutdown] HTTP server closed');
        resolve();
      });

      // Also log if there are still in-flight requests
      const checkInterval = setInterval(() => {
        if (this.requestCount > 0) {
          console.log(`[Shutdown] Waiting for ${this.requestCount} in-flight requests...`);
        }
      }, 5000);

      // Clean up interval on completion
      this.server.once('close', () => {
        clearInterval(checkInterval);
      });
    });
  }

  /**
   * Closes Redis connection
   */
  private async closeRedis(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Shutdown] Redis closure timeout exceeded');
        resolve();
      }, this.config.redisTimeoutMs);

      this.redis.quit((err) => {
        clearTimeout(timeout);
        if (err) {
          console.warn('[Shutdown] Redis closure error:', err.message);
        } else {
          console.log('[Shutdown] Redis closed');
        }
        resolve();
      });
    });
  }

  /**
   * Closes Prisma connection
   */
  private async closePrisma(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Shutdown] Prisma closure timeout exceeded');
        resolve();
      }, this.config.prismaTimeoutMs);

      this.prisma
        .$disconnect()
        .then(() => {
          clearTimeout(timeout);
          console.log('[Shutdown] Prisma disconnected');
          resolve();
        })
        .catch((err) => {
          clearTimeout(timeout);
          console.warn('[Shutdown] Prisma disconnection error:', err.message);
          resolve();
        });
    });
  }
}
