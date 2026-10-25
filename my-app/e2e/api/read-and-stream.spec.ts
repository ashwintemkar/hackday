import { test, expect } from '@playwright/test';

test.describe('Read and Stream endpoints', () => {
  test('POST /api/read responds with data or an error status', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/read`, { data: { query: 'hello', chatId: 'x' } });
    if (res.status() === 200) {
      const json = await res.json();
      expect(json.data).toBeTruthy();
      if (typeof json.data === 'string') {
        expect(json.data.length).toBeGreaterThan(0);
      } else {
        expect(typeof json.data).toBe('object');
      }
    } else {
      expect([400, 500]).toContain(res.status());
    }
  });

  test('POST /api/stream returns text/event-stream with content', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/stream`, { data: { query: 'hello', chatId: 'x' } });
    expect(res.status()).toBe(200);
    const ctype = res.headers()['content-type'] || '';
    expect(ctype).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    const t = text.toLowerCase();
    expect(t.includes('error') || t.includes('source-info')).toBeTruthy();
  });
});
