import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('verified chat commands use Twitch user ID and are processed once per message', async () => {
  const seen = new Set<string>();
  const songs: unknown[][] = [];
  const cancellations: unknown[][] = [];
  const sent: Record<string, unknown>[] = [];
  let enabled = true;
  mock.module(new URL('../src/lib/supabase.ts', import.meta.url).href, { namedExports: { getServiceSupabase: () => ({ rpc: async (_name: string, args: { p_message: string }) => { if (!enabled || seen.has(args.p_message)) return { data: false, error: null }; seen.add(args.p_message); return { data: true, error: null }; } }) } });
  mock.module(new URL('../src/lib/polls/twitch.ts', import.meta.url).href, { namedExports: { helix: async (_path: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return Response.json({ data: [{ is_sent: true }] }); } } });
  mock.module(new URL('../src/lib/chat/song-request.ts', import.meta.url).href, { namedExports: { requestSong: async (...args: unknown[]) => { songs.push(args); return new Response('Заказ принят'); } } });
  mock.module(new URL('../src/lib/chat/cancel-request.ts', import.meta.url).href, { namedExports: { cancelPendingRequest: async (...args: unknown[]) => { cancellations.push(args); return 'Отменено'; } } });
  mock.module(new URL('../src/lib/chat/position.ts', import.meta.url).href, { namedExports: { positionText: async () => 'Позиция' } });
  mock.module(new URL('../src/lib/chat/now-playing.ts', import.meta.url).href, { namedExports: { nowPlayingText: async () => 'Сейчас играет' } });
  try {
    const { handleTwitchMusicCommand } = await import('../src/lib/chat/twitch-commands');
    const event = { broadcasterId: '10', subscriptionId: 'sub', userId: '42', login: 'viewer', messageId: 'message-1', text: '!sr test song' };
    await handleTwitchMusicCommand(event);
    await handleTwitchMusicCommand(event);
    assert.deepEqual(songs, [['test song', 'viewer', '42']]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].sender_id, '10');
    assert.equal(sent[0].reply_parent_message_id, 'message-1');
    await handleTwitchMusicCommand({ ...event, messageId: 'message-2', text: '!wrongsong' });
    assert.deepEqual(cancellations, [['viewer', '42']]);
    enabled = false;
    await handleTwitchMusicCommand({ ...event, messageId: 'message-3' });
    assert.equal(sent.length, 2);
  } finally { mock.restoreAll(); }
});
