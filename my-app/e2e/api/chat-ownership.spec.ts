import { test, expect, request as pwrequest } from '@playwright/test';
import { loginWithCredentials } from '../support/auth';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

test.describe('Chat ownership (DB-backed)', () => {
  test.skip(!DB_REQUIRED, 'Set PLAYWRIGHT_DB=true and ensure DB is migrated');

  test('user cannot access another user\'s chat', async ({ request, baseURL }) => {
    await loginWithCredentials(request, baseURL! , 'userA@example.com');
    const create = await request.post(`${baseURL}/api/chat/create`);
    expect(create.status()).toBe(200);
    const { id: chatId } = await create.json();

    const ctxB = await pwrequest.newContext({ baseURL });
    await loginWithCredentials(ctxB, baseURL!, 'userB@example.com');

    const getAsB = await ctxB.get(`${baseURL}/api/chat/${chatId}`);
    expect([403, 404]).toContain(getAsB.status());
  });
});

