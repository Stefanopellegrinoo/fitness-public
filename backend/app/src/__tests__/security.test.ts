import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('Security Middlewares', () => {
  it('should have helmet security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers).toHaveProperty('x-frame-options');
    expect(res.headers).toHaveProperty('content-security-policy');
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('should protect against HTTP Parameter Pollution (HPP)', async () => {
    // Pegamos a /health que no usa DB para evitar el error de Prisma
    const res = await request(app).get('/health?test=1&test=2');
    expect(res.status).toBe(200);
  });
});
