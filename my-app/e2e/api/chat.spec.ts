import { test, expect } from '@playwright/test';
import { loginWithCredentials } from '../support/auth';

const DB_REQUIRED = process.env.PLAYWRIGHT_DB === 'true';

test.describe('Chat lifecycle (DB-backed)', () => {
  test.skip(!DB_REQUIRED, 'Set PLAYWRIGHT_DB=true and ensure DB/migrations are applied');

  test('create, list, get, post message, list messages, edit, delete', async ({ request, baseURL }) => {
    await loginWithCredentials(request, baseURL!);

    const createRes = await request.post(`${baseURL}/api/chat/create`);
    expect(createRes.status()).toBe(200);
    const { id: chatId, folder } = await createRes.json();
    expect(chatId).toBeTruthy();
    expect(folder).toBeTruthy();

    const listRes = await request.get(`${baseURL}/api/chat/list`);
    expect(listRes.status()).toBe(200);
    const chats = await listRes.json();
    expect(Array.isArray(chats)).toBeTruthy();
    expect(chats.find((c: any) => c.id === chatId)).toBeTruthy();

    const getRes = await request.get(`${baseURL}/api/chat/${chatId}`);
    expect(getRes.status()).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.chat.id).toBe(chatId);
    expect(Array.isArray(getJson.messages)).toBeTruthy();

    const postMsgRes = await request.post(`${baseURL}/api/messages`, {
      data: { content: 'Hello RAG', chatId, role: 'user' },
    });
    expect(postMsgRes.status()).toBe(200);
    const postMsgJson = await postMsgRes.json();
    expect(postMsgJson.success).toBeTruthy();
    const messageId = postMsgJson.message.id as string;

    const listMsgRes = await request.get(`${baseURL}/api/messages/chatMessages/${chatId}`);
    expect(listMsgRes.status()).toBe(200);
    const listMsgJson = await listMsgRes.json();
    expect(Array.isArray(listMsgJson.messages)).toBeTruthy();
    expect(listMsgJson.messages.some((m: any) => m.id === messageId)).toBeTruthy();

    const editRes = await request.put(`${baseURL}/api/messages/${messageId}/edit`, {
      data: { content: 'Updated content' },
    });
    expect(editRes.status()).toBe(200);
    const editJson = await editRes.json();
    expect(editJson.success).toBeTruthy();

    const delRes = await request.delete(`${baseURL}/api/chat/${chatId}/delete`);
    expect(delRes.status()).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.success).toBeTruthy();

    const getAfterDel = await request.get(`${baseURL}/api/chat/${chatId}`);
    expect(getAfterDel.status()).toBe(404);
  });
});

