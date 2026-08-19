import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('Rate Limiting', () => {
  it('should include rate limit headers', async () => {
    // Hit a rate-limited endpoint (after the rateLimiter middleware)
    const res = await request(app).get('/api/exercises');
    
    // En Draft-7 se usa la cabecera 'ratelimit'
    const hasRateLimit = 
      res.headers['ratelimit'] !== undefined || 
      res.headers['x-ratelimit-limit'] !== undefined;
      
    expect(hasRateLimit).toBe(true);
  });
});
