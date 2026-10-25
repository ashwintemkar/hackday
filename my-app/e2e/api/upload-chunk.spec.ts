import { test, expect } from '@playwright/test';
import { loginWithCredentials } from '../support/auth';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

function splitBuffer(buf: Buffer, parts: number): Buffer[] {
  const out: Buffer[] = [];
  const size = Math.ceil(buf.length / parts);
  for (let i = 0; i < parts; i++) {
    out.push(buf.subarray(i * size, Math.min((i + 1) * size, buf.length)));
  }
  return out;
}

test.describe('Chunked upload (DB-backed)', () => {
  test.skip(!DB_REQUIRED, 'Set PLAYWRIGHT_DB=true and ensure DB/migrations are applied');

  test('init + chunk + complete for text file', async ({ request, baseURL }) => {
    await loginWithCredentials(request, baseURL!);

    const createRes = await request.post(`${baseURL}/api/chat/create`);
    expect(createRes.status()).toBe(200);
    const { id: chatId } = await createRes.json();

    const content = Buffer.from('This is a longer test file split across chunks');
    const chunks = splitBuffer(content, 3);
    const filename = 'chunked.txt';
    const fileId = `file-${Date.now()}`;

    const initRes = await request.post(`${baseURL}/api/upload/init`, {
      data: {
        filename,
        fileSize: content.length,
        totalChunks: chunks.length,
        chatId,
        fileId,
      },
    });
    expect(initRes.status()).toBe(200);

    for (let i = 0; i < chunks.length; i++) {
      const upRes = await request.post(`${baseURL}/api/upload/chunk`, {
        multipart: {
          fileId,
          chunkIndex: String(i),
          totalChunks: String(chunks.length),
          chatId,
          chunk: {
            name: `chunk_${i}.bin`,
            buffer: chunks[i],
            mimeType: 'application/octet-stream',
          },
        },
      });
      expect(upRes.status()).toBe(200);
      const upJson = await upRes.json();
      expect(upJson.success).toBeTruthy();
    }

    const compRes = await request.post(`${baseURL}/api/upload/complete`, {
      data: { fileId, chatId, filename },
    });
    expect(compRes.status()).toBe(200);
    const compJson = await compRes.json();
    expect(compJson.success).toBeTruthy();
    expect(compJson.file).toBeTruthy();
    expect(String(compJson.file.path)).toContain('/test/');
  });
});
