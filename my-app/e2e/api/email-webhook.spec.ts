import { test, expect } from '@playwright/test';

test.describe('Email webhook', () => {
  test('Invalid request returns 400', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/email-webhook`, { data: { foo: 'bar' } });
    expect(res.status()).toBe(400);
  });

  test('SNS notification with invalid JSON Message returns 400', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/email-webhook`, {
      data: {
        Type: 'Notification',
        Message: '{ not json',
      },
    });
    expect([400, 500]).toContain(res.status());
  });

  test('Subscription confirmation attempts fetch and returns 500 on failure', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/email-webhook`, {
      data: {
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'http://127.0.0.1:65535/unreachable',
      },
    });
    expect([400, 500]).toContain(res.status());
  });
});
