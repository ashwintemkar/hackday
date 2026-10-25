import { test, expect } from '@playwright/test';
import { loginWithCredentials } from '../support/auth';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

test.describe('Upload validations (DB-backed)', () => {
  test.skip(!DB_REQUIRED, 'Set PLAYWRIGHT_DB=true and ensure DB is migrated');

  test('init requires fields; complete complains about missing chunks', async ({ request, baseURL }) => {
    await loginWithCredentials(request, baseURL!);

    const create = await request.post(`${baseURL}/api/chat/create`);
    const { id: chatId } = await create.json();

    const initBad = await request.post(`${baseURL}/api/upload/init`, { data: { filename: 'a' } });
    expect(initBad.status()).toBe(400);

    const fileId = `file-${Date.now()}`;
    const initOk = await request.post(`${baseURL}/api/upload/init`, { data: { filename: 'a.txt', fileSize: 10, totalChunks: 2, chatId, fileId } });
    expect(initOk.status()).toBe(200);

    const completeBad = await request.post(`${baseURL}/api/upload/complete`, { data: { fileId, chatId, filename: 'a.txt' } });
    expect(completeBad.status()).toBe(400);
  });
});

