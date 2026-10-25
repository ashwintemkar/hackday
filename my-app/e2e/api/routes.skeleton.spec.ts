import { test, expect } from '@playwright/test';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

test.describe('API routes (DB-backed) [skeleton]', () => {
  test.skip(!DB_REQUIRED, 'Set PLAYWRIGHT_DB=true and ensure DB/migrations to run these');

  test('POST /api/chat/create creates a chat (requires DB)', async ({ request, baseURL }) => {
    const signin = await request.post(`${baseURL}/api/auth/callback/credentials`, {
      form: { email: 'test@example.com', password: 'pw' },
    });
    expect(signin.status()).toBe(302);

    const res = await request.post(`${baseURL}/api/chat/create`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('folder');
  });
});

