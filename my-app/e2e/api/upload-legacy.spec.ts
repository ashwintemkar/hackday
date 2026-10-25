import { test, expect } from '@playwright/test';
import { loginWithCredentials } from '../support/auth';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

test.describe('Legacy upload (DB-backed)', () => {
  test.skip(!DB_REQUIRED, 'Set PLAYWRIGHT_DB=true and ensure DB/migrations are applied');

  test('upload simple text file and receive processed record', async ({ request, baseURL }) => {
    await loginWithCredentials(request, baseURL!);

    const createRes = await request.post(`${baseURL}/api/chat/create`);
    expect(createRes.status()).toBe(200);
    const { id: chatId } = await createRes.json();

    const buffer = Buffer.from('Hello from Playwright test');
    const res = await request.post(`${baseURL}/api/upload`, {
      multipart: {
        chatId,
        file: {
          name: 'hello.txt',
          mimeType: 'text/plain',
          buffer,
        },
      },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBeTruthy();
    expect(json.file).toBeTruthy();
    expect(json.originalFile).toBeTruthy();
    expect(String(json.file.path)).toContain('/test/');
    expect(String(json.originalFile.path)).toContain('/test/');
  });
});
