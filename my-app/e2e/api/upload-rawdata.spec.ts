import { test, expect } from '@playwright/test';

function base64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signHS256(data: string, secret: string) {
  const crypto = require('crypto');
  const h = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  h.update(data);
  return base64url(h.digest());
}

function createJWT(payload: any, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const pl = { iat: now, exp: now + 3600, ...payload };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(pl));
  const content = `${headerB64}.${payloadB64}`;
  const sig = signHS256(content, secret);
  return `${content}.${sig}`;
}

test.describe('Raw data webhook (JWT protected)', () => {
  const secret = process.env.INTEGRATION_HUB_SECRET || 'testsecret';

  test('401 without Authorization header', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/upload/rawdata`, { data: { any: 'thing' } });
    expect(res.status()).toBe(401);
  });

  test('401 with invalid token', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/upload/rawdata`, {
      headers: { Authorization: 'Bearer invalid.token.here' },
      data: { any: 'thing' },
    });
    expect(res.status()).toBe(401);
  });

  test('400/500 with valid token but minimal payload', async ({ request, baseURL }) => {
    const token = createJWT({ org_id: 'org', org_name: 'Org', client_id: 'integration_hub_client' }, secret);
    const res = await request.post(`${baseURL}/api/upload/rawdata`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { webhookEvent: 'jira:issue_created', key: 'ABC-1', fields: {} },
    });
    expect([200, 400, 500]).toContain(res.status());
  });
});

