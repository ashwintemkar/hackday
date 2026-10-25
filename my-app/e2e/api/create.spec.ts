import { test, expect } from '@playwright/test';
import { loginWithCredentials } from '../support/auth';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

test.describe('Embeddings create endpoint', () => {
  test('POST /api/create without proper files returns 400', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/create`, {
      data: { chatId: 'non-existent' },
    });
    expect([400, 404]).toContain(res.status());
  });

  test.skip(!DB_REQUIRED, 'DB-backed path');
  test('POST /api/create with chat but no documents returns 400', async ({ request, baseURL }) => {
    await loginWithCredentials(request, baseURL!);
    const createChat = await request.post(`${baseURL}/api/chat/create`);
    expect(createChat.status()).toBe(200);
    const { id: chatId } = await createChat.json();

    const res = await request.post(`${baseURL}/api/create`, { data: { chatId } });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/No valid documents/i);
  });
});

