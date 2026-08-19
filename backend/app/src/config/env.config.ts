import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env by absolute path so the result never depends on process.cwd().
// This file lives in src/config/ (dist/config/ when compiled), so the app
// root containing .env is two levels up in both layouts. A cwd-relative
// dotenv.config() silently loaded nothing when tests or tools ran from a
// different directory, making the schema fall back to defaults.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url().default('postgresql://localhost/test'),
  // No silent defaults for secrets: a fallback value here turns a missing
  // .env into an "invalid signature" failure that is impossible to diagnose.
  // Failing loudly at startup is the correct behavior.
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  // Access and refresh tokens MUST NOT share the same secret
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  REDIS_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  VAPID_PUBLIC_KEY: z.string().min(1, 'VAPID_PUBLIC_KEY is required').optional(),
  VAPID_PRIVATE_KEY: z.string().min(1, 'VAPID_PRIVATE_KEY is required').optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(1000), // Increased for development
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required').optional().default('sk-test-placeholder'),
  OFF_BASE_URL: z.string().url().default('https://world.openfoodfacts.org'),
  OFF_SEARCH_URL: z.string().url().default('https://search.openfoodfacts.org'),
  OFF_USER_AGENT: z.string().default('KineticFitness/1.0 (soporte@kinetic.app)'),
  OFF_TIMEOUT_MS: z.coerce.number().default(4000),
});

export type Env = z.infer<typeof EnvSchema>;

class Config {
  private static instance: Config;
  public readonly env: Env;

  private constructor() {
    try {
      this.env = EnvSchema.parse(process.env);
      this.validateProductionConfig();
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('Environment validation failed:', error.flatten().fieldErrors);
      } else {
        console.error('Unknown environment validation error:', error);
      }
      process.exit(1);
    }
  }

  private validateProductionConfig(): void {
    if (this.env.NODE_ENV === 'production') {
      const weakSecrets = ['secret', 'password', '123456', 'qwerty', 'development-only-secret', 'dev-only-insecure-key', 'test-jwt-secret-key-at-least-16', 'test-refresh-secret-key-at-least-16'];
      if (weakSecrets.includes(this.env.JWT_SECRET)) {
        console.error('FATAL: JWT_SECRET is using a weak or default key in production');
        process.exit(1);
      }

      if (weakSecrets.includes(this.env.JWT_REFRESH_SECRET)) {
        console.error('FATAL: JWT_REFRESH_SECRET is using a weak or default key in production');
        process.exit(1);
      }

      if (this.env.JWT_SECRET.length < 32) {
        console.error(`FATAL: JWT_SECRET must be at least 32 characters in production (currently ${this.env.JWT_SECRET.length})`);
        process.exit(1);
      }

      if (this.env.JWT_REFRESH_SECRET.length < 32) {
        console.error(`FATAL: JWT_REFRESH_SECRET must be at least 32 characters in production (currently ${this.env.JWT_REFRESH_SECRET.length})`);
        process.exit(1);
      }

      if (this.env.JWT_SECRET === this.env.JWT_REFRESH_SECRET) {
        console.error('FATAL: JWT_SECRET and JWT_REFRESH_SECRET must be different secrets in production');
        process.exit(1);
      }

      console.log('\u2705 Production environment validated');
    } else {
      console.warn('\u26a0\ufe0f  Development/Test environment active');
    }
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  public static get env(): Env {
    return Config.getInstance().env;
  }
}

export const env = Config.env;
export default Config;