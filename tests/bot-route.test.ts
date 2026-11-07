import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import type { BotSpotifyTrack } from '../src/lib/bot-track-search';

test('chat requests use Spotify ranking, preserve links and handle Spotify errors', async () => {
  const saved: Record<string, unknown>[] = [];
  const spotifyRequests: string[] = [];
  let queueCalls = 0;
  let candidates: BotSpotifyTrack[] = [];
  let searchStatus = 200;
  let queueStatus = 204;
  const track: BotSpotifyTrack = {
    id: '5aEzGuXQrhQxgG20NM2b26', uri: 'spotify:track:5aEzGuXQrhQxgG20NM2b26',
    name: 'Numb', artists: [{ name: 'Linkin Park' }], duration_ms: 180000, explicit: false,
  };

  mock.module(new URL('../src/lib/supabase.ts', import.meta.url).href, { namedExports: {
    getServiceSupabase: () => ({ from: (table: string) => table === 'stream_settings'
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: { is_accepting: true, auto_approve: true, explicit_mode: 'allow', max_queue_size: 15, max_duration_sec: 600, cooldown_user_sec: 0, prevent_duplicates: false, banned_words: '', banned_artists: '' } }) }) }) }
      : { select: () => ({ eq: () => ({ eq: async () => ({ count: 0, error: null }) }) }), insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => { saved.push(row); return { data: { id: `request-${saved.length}` }, error: null }; } }) }),
        update: (row: Record<string, unknown>) => ({ eq: async (_key: string, id: string) => { Object.assign(saved[Number(id.split('-')[1]) - 1], row); return { error: null }; } }) } }),
  } });
  mock.module(new URL('../src/lib/spotify.ts', import.meta.url).href, { namedExports: {
    getStreamerAccessToken: async () => 'test-token',
    fetchWithTimeout: async (requestUrl: string) => {
      spotifyRequests.push(requestUrl);
      if (requestUrl.includes('/v1/me/player/queue')) { queueCalls++; return new Response(null, { status: queueStatus }); }
      if (requestUrl.includes('/v1/tracks/')) return Response.json(track);
      if (searchStatus !== 200) return Response.json({}, { status: searchStatus });
      const query = new URL(requestUrl).searchParams.get('q');
      return Response.json({ tracks: { items: query === 'artist:"Numb" track:"Linkin Park"' ? [] : candidates } });
    },
  } });
  mock.module(new URL('../src/lib/stream/lifecycle.ts', import.meta.url).href, { namedExports: { reconcileStreamState: async () => null } });
  mock.module(new URL('../src/lib/chat/mode.ts', import.meta.url).href, { namedExports: { musicCommandsEnabled: async () => false } });
  mock.module(new URL('../src/lib/enqueue-request.ts', import.meta.url).href, { namedExports: { enqueueRequest: async (_db: unknown, id: string) => { queueCalls++; if (queueStatus !== 204) return 'not_available'; saved[Number(id.split('-')[1]) - 1].status = 'approved'; return 'queued'; } } });
  try {
    const { GET } = await import('../src/app/api/bot/route');
    const run = async (query: string) => {
      const url = new URL('http://localhost/api/bot');
      url.searchParams.set('query', query);
      url.searchParams.set('user', 'viewer');
      return (await GET(new NextRequest(url))).text();
    };

    candidates = [];
    assert.match(await run('Opening Theme Ben-10 Classic'), /трек не найден/);
    assert.equal(saved.length, 0);
    assert.equal(queueCalls, 0);

    candidates = [track];
    assert.match(await run('Linkin Park - Numb'), /Linkin Park - Numb.*добавлен в очередь/);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].spotify_uri, track.uri);
    assert.equal(queueCalls, 1);
    const searches = spotifyRequests.filter(url => url.includes('/v1/search')).map(url => new URL(url).searchParams.get('q'));
    assert.ok(searches.includes('Linkin Park - Numb'));

    const searchesBeforeLink = spotifyRequests.filter(url => url.includes('/v1/search')).length;
    assert.match(await run(`https://open.spotify.com/track/${track.id}?si=example`), /Linkin Park - Numb.*добавлен в очередь/);
    assert.equal(saved.length, 2);
    assert.equal(queueCalls, 2);
    assert.equal(spotifyRequests.filter(url => url.includes('/v1/search')).length, searchesBeforeLink);

    queueStatus = 503;
    assert.match(await run('Linkin Park - Numb'), /отправлен на модерацию/);
    assert.equal(saved.length, 3);
    assert.equal(saved[2].status, 'pending');
    assert.equal(queueCalls, 3);

    assert.match(await run('https://open.spotify.com/album/invalid'), /не удалось распознать ссылку/);
    assert.equal(saved.length, 3);
    assert.equal(queueCalls, 3);

    searchStatus = 429;
    assert.match(await run('another query'), /системная ошибка/);
    assert.equal(saved.length, 3);
    assert.equal(queueCalls, 3);
  } finally {
    mock.restoreAll();
  }
});
