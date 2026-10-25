import type { APIRequestContext } from '@playwright/test';

export async function loginWithCredentials(request: APIRequestContext, baseURL: string, email = 'test@example.com') {
  const csrfRes = await request.get(`${baseURL}/api/auth/csrf`);
  if (csrfRes.status() !== 200) throw new Error(`CSRF fetch failed: ${csrfRes.status()}`);
  const { csrfToken } = await csrfRes.json();

  const form = new URLSearchParams();
  form.set('csrfToken', csrfToken);
  form.set('email', email);
  form.set('password', 'test');
  form.set('callbackUrl', '/');

  const loginRes = await request.post(`${baseURL}/api/auth/callback/credentials`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: form.toString(),
  });

  if (![200, 302].includes(loginRes.status())) {
    const txt = await loginRes.text();
    throw new Error(`Login failed: ${loginRes.status()} ${txt}`);
  }
}

