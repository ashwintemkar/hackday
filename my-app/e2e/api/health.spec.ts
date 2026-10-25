import { test, expect } from '@playwright/test';

test.describe('Health', () => {
  test('GET /api/health returns healthy payload', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/health`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('status');
    expect(json.status).toBe('healthy');
    expect(json).toHaveProperty('timestamp');
    expect(json).toHaveProperty('environment');
    expect(json).toHaveProperty('uptime');
    expect(json).toHaveProperty('memory');
  });

  test('HEAD /api/health responds 200', async ({ request, baseURL }) => {
    const res = await request.fetch(`${baseURL}/api/health`, { method: 'HEAD' });
    expect(res.status()).toBe(200);
  });
});
