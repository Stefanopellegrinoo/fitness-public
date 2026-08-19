/**
 * Prisma Connection Initialization with Retry Logic
 * 
 * Implements exponential backoff retry strategy for database connection failures.
 * This ensures that temporary database unavailability doesn't immediately crash
 * the application.
 */

import { PrismaClient } from '@prisma/client';

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 30000, // 30 seconds
};

/**
 * Creates a Prisma client with retry logic
 * 
 * @param config - Retry configuration
 * @returns Promise<PrismaClient> when connection succeeds
 * @throws Error after max retries exhausted
 */
export async function createPrismaWithRetry(
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<PrismaClient> {
  const prisma = new PrismaClient();

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      // Try to connect
      await prisma.$queryRaw`SELECT 1`;
      console.log('[Prisma] Successfully connected to database');
      return prisma;
    } catch (err: any) {
      const isLastAttempt = attempt === config.maxRetries;
      const delay = calculateBackoffDelay(attempt, config);

      if (isLastAttempt) {
        console.error(
          `[Prisma] Failed to connect after ${config.maxRetries} attempts: ${err.message}`
        );
        await prisma.$disconnect();
        throw new Error(`Failed to connect to database: ${err.message}`);
      }

      console.warn(
        `[Prisma] Connection attempt ${attempt}/${config.maxRetries} failed: ${err.message}. ` +
        `Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  // Should never reach here
  throw new Error('Unexpected error in retry logic');
}

/**
 * Calculates exponential backoff delay with jitter
 * 
 * Formula: min(maxDelay, initialDelay * 2^(attempt-1) + randomJitter)
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.initialDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * config.initialDelayMs;
  const delay = exponentialDelay + jitter;

  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
