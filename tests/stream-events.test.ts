import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mock, test } from 'node:test';

test('Twitch webhook verifies signatures, channel and subscription before recording events', async () => {
  const secret = 'test-eventsub-secret';
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let dbReads = 0;
  const state: Record<string, string | null> = { online_subscription_id: 'sub-online', offline_subscription_id: 'sub-offline' };
  mock.module(new URL('../src/lib/polls/twitch.ts', import.meta.url).href, { namedExports: { eventSecret: () => secret } });
  mock.module(new URL('../src/lib/supabase.ts', import.meta.url).href, { namedExports: {
    getServiceSupabase: () => ({
      from: (table: string) => ({
        select: () => ({ eq: () => ({ single: async () => { dbReads++; return { data: table === 'stream_poll_twitch' ? { broadcaster_id: 'channel' } : state, error: null }; } }) }),
        update: (values: Record<string, string>) => ({ eq: async () => { Object.assign(state, values); return { error: null }; } }),
      }),
      rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: null }; },
    }),
  } });
  try {
    const { POST } = await import('../src/app/api/twitch/stream-events/route');
    function signed(body: object, kind: string, valid = true) {
      const raw = JSON.stringify(body), id = 'event-id', timestamp = new Date().toISOString();
      const signature = createHmac('sha256', valid ? secret : 'wrong').update(id + timestamp + raw).digest('hex');
      return new Request('http://localhost/api/twitch/stream-events', { method: 'POST', body: raw, headers: {
        'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp,
        'twitch-eventsub-message-signature': `sha256=${signature}`, 'twitch-eventsub-message-type': kind,
      } });
    }
    const online = { id: 'sub-online', type: 'stream.online', version: '1', condition: { broadcaster_user_id: 'channel' } };
    const event = { broadcaster_user_id: 'channel', id: 'stream-1', started_at: '2026-11-01T10:00:00Z' };
    assert.equal((await POST(signed({ subscription: online, event }, 'notification', false))).status, 403);
    assert.equal(dbReads, 0);
    assert.equal((await POST(signed({ subscription: { ...online, condition: { broadcaster_user_id: 'other' } }, event }, 'notification'))).status, 403);
    assert.equal((await POST(signed({ subscription: { ...online, id: 'old-id' }, event }, 'notification'))).status, 204);
    assert.equal(calls.length, 0);
    const challenge = await POST(signed({ subscription: online, challenge: 'challenge-text' }, 'webhook_callback_verification'));
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), 'challenge-text');
    assert.equal((await POST(signed({ subscription: online, event }, 'notification'))).status, 204);
    assert.equal(calls[0].name, 'music_stream_event');
    assert.equal(calls[0].args.p_type, 'online');
    assert.equal(calls[0].args.p_stream_id, 'stream-1');
    assert.equal((await POST(signed({ subscription: online, event: { broadcaster_user_id: 'channel' } }, 'notification'))).status, 400);
    assert.equal((await POST(signed({ subscription: { ...online, type: 'stream.offline', id: 'sub-offline' } }, 'revocation'))).status, 204);
    assert.equal(calls[1].name, 'music_stream_revoke');
    assert.equal(calls[1].args.p_subscription, 'sub-offline');
  } finally { mock.restoreAll(); }
});
