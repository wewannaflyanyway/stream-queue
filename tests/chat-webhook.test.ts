import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mock, test } from 'node:test';

test('chat commands are dispatched only for signed messages from the connected channel', async () => {
  let enabled = true;
  let calls = 0;
  let queued: (() => Promise<void>) | undefined;
  const secret = 'local-test-secret';
  mock.module('next/server', { namedExports: { after: (callback: () => Promise<void>) => { queued = callback; } } });
  mock.module(new URL('../src/lib/supabase.ts', import.meta.url).href, { namedExports: { getServiceSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { broadcaster_id: '10', subscription_id: 'sub', music_commands_enabled: enabled }, error: null }) }) }) }) }) } });
  mock.module(new URL('../src/lib/polls/twitch.ts', import.meta.url).href, { namedExports: { eventSecret: () => secret } });
  mock.module(new URL('../src/lib/polls/server.ts', import.meta.url).href, { namedExports: { pollRpc: async () => null, pollResponseError: () => new Response(null, { status: 503 }) } });
  mock.module(new URL('../src/lib/chat/twitch-commands.ts', import.meta.url).href, { namedExports: { handleTwitchMusicCommand: async (event: { userId: string; login: string }) => { calls++; assert.equal(event.userId, '42'); assert.equal(event.login, 'viewer'); } } });
  try {
    const { POST } = await import('../src/app/api/twitch/eventsub/route');
    const body = JSON.stringify({ subscription: { id: 'sub', type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '10', user_id: '10' } }, event: { broadcaster_user_id: '10', chatter_user_id: '42', chatter_user_login: 'viewer', message_id: 'message-1', message: { text: '!sr test' } } });
    const request = (signatureValid: boolean) => {
      const id = 'delivery-1'; const timestamp = new Date().toISOString();
      const signature = 'sha256=' + createHmac('sha256', signatureValid ? secret : 'wrong').update(id + timestamp + body).digest('hex');
      return new Request('https://example.test/api/twitch/eventsub', { method: 'POST', body, headers: { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp, 'twitch-eventsub-message-signature': signature, 'twitch-eventsub-message-type': 'notification' } });
    };
    assert.equal((await POST(request(false))).status, 403);
    assert.equal(calls, 0);
    assert.equal((await POST(request(true))).status, 204);
    assert.equal(calls, 0);
    assert.ok(queued);
    await queued();
    assert.equal(calls, 1);
    enabled = false;
    assert.equal((await POST(request(true))).status, 204);
    assert.equal(calls, 1);
  } finally { mock.restoreAll(); }
});
