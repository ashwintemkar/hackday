import { test, expect } from '@playwright/test';
import { loginWithCredentials } from '../support/auth';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

test.describe('Messages validations and edit (DB-backed)', () => {
  test.skip(!DB_REQUIRED, 'Set PLAYWRIGHT_DB=true and ensure DB is migrated');

  test('validations and 404 on edit of non-existent message', async ({ request, baseURL }) => {
    await loginWithCredentials(request, baseURL!);

    const createChat = await request.post(`${baseURL}/api/chat/create`);
    expect(createChat.status()).toBe(200);
    const { id: chatId } = await createChat.json();

    const bad1 = await request.post(`${baseURL}/api/messages`, { data: {} });
    expect(bad1.status()).toBe(400);

    const bad2 = await request.post(`${baseURL}/api/messages`, { data: { content: 'hi' } });
    expect(bad2.status()).toBe(400);

    const ok = await request.post(`${baseURL}/api/messages`, { data: { content: 'first', chatId, role: 'user' } });
    expect(ok.status()).toBe(200);

    const edit404 = await request.put(`${baseURL}/api/messages/non-existent/edit`, { data: { content: 'x' } });
    expect(edit404.status()).toBe(404);
  });
});

