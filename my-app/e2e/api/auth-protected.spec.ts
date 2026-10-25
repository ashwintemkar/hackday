import { test, expect } from '@playwright/test';

test.describe('Auth-protected routes', () => {
  test('POST /api/chat/create requires auth', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/chat/create`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Unauthorized/i);
  });

  test('POST /api/messages requires auth', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/messages`, {
      data: { content: 'hello', chatId: 'x', role: 'user' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/chat/list requires auth', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/chat/list`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/messages/chatMessages/:chatId requires auth', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/messages/chatMessages/any`);
    expect(res.status()).toBe(401);
  });

  test('upload endpoints require auth', async ({ request, baseURL }) => {
    const init = await request.post(`${baseURL}/api/upload/init`, { data: { filename: 'a', fileSize: 1, totalChunks: 1, chatId: 'x', fileId: 'fid' } });
    expect(init.status()).toBe(401);

    const chunk = await request.post(`${baseURL}/api/upload/chunk`, { multipart: { fileId: 'fid', chunkIndex: '0', totalChunks: '1', chatId: 'x', chunk: { name: 'c', buffer: Buffer.from('a'), mimeType: 'application/octet-stream' } } });
    expect(chunk.status()).toBe(401);

    const complete = await request.post(`${baseURL}/api/upload/complete`, { data: { fileId: 'fid', chatId: 'x', filename: 'a.txt' } });
    expect(complete.status()).toBe(401);
  });
});
