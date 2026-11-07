import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('widget uses current session requests and never guesses for duplicate tracks', async () => {
  const originalFetch = globalThis.fetch;
  let state: { online: boolean; session_id: string | null; manual_offline_since: string | null } = { online: true, session_id: 'current', manual_offline_since: null };
  let queue: string[] = ['next'];
  let queueOk = true;
  let playerStatus = 200;
  let failRequests = false;
  const rows = [
    { id: 'old', spotify_uri: 'current', status: 'approved', stream_session_id: 'old', sender_name: 'viewer2', created_at: '2026-11-01T10:00:00Z' },
    { id: 'played', spotify_uri: 'current', status: 'played', stream_session_id: 'current', sender_name: 'viewer2', created_at: '2026-11-04T09:00:00Z' },
    { id: 'new', spotify_uri: 'current', status: 'approved', stream_session_id: 'current', sender_name: 'viewer1', created_at: '2026-11-04T10:00:00Z' },
    { id: 'next', spotify_uri: 'next', status: 'approved', stream_session_id: 'current', sender_name: 'viewer3', created_at: '2026-11-04T10:01:00Z' },
    { id: 'pending', spotify_uri: 'next', status: 'pending', stream_session_id: 'current', sender_name: 'viewer4', created_at: '2026-11-04T10:02:00Z' },
  ];
  mock.module(new URL('../src/lib/spotify.ts', import.meta.url).href, { namedExports: { getStreamerAccessToken: async () => 'test-token', fetchWithTimeout: (...args: Parameters<typeof fetch>) => fetch(...args) } });
  mock.module(new URL('../src/lib/stream/lifecycle.ts', import.meta.url).href, { namedExports: { readStreamState: async () => state } });
  mock.module(new URL('../src/lib/supabase.ts', import.meta.url).href, { namedExports: {
    getServiceSupabase: () => ({ from: (table: string) => {
      if (table === 'stream_settings') return { select: () => ({ eq: () => ({ single: async () => ({ data: {} }) }) }) };
      let filtered = [...rows];
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filtered = filtered.filter(row => row[key as keyof typeof row] === value); return query; },
        in: (key: string, values: string[]) => { filtered = filtered.filter(row => values.includes(row[key as keyof typeof row])); return query; },
        is: (key: string, value: null) => { filtered = filtered.filter(row => row[key as keyof typeof row] === value); return query; },
        gte: (key: string, value: string) => { filtered = filtered.filter(row => row[key as keyof typeof row] >= value); return query; },
        limit: () => query,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: failRequests ? null : filtered, error: failRequests ? new Error('DB unavailable') : null }).then(resolve, reject),
      };
      return query;
    } }),
  } });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('currently-playing')) {
      if (playerStatus !== 200) return new Response(null, { status: playerStatus });
      return Response.json({ is_playing: true, item: { uri: 'current', name: 'Song', artists: [{ name: 'Artist' }] } });
    }
    if (!queueOk) return new Response(null, { status: 503 });
    return Response.json({ queue: queue.map(uri => ({ uri, name: uri, artists: [{ name: 'Artist' }] })) });
  };
  try {
    const { GET } = await import('../src/app/api/spotify/now-playing/route');
    const get = () => GET(new Request('http://localhost/api/spotify/now-playing'));
    let result = await (await get()).json();
    assert.equal(result.current.orderedBy, 'viewer1');
    assert.equal(result.next.orderedBy, 'viewer3');
    queue = ['current', 'next'];
    result = await (await get()).json();
    assert.equal(result.current.orderedBy, null);
    assert.equal(result.next.orderedBy, null);
    queue = ['next'];
    queueOk = false;
    result = await (await get()).json();
    assert.equal(result.current.orderedBy, null);
    queueOk = true;
    failRequests = true;
    result = await (await get()).json();
    assert.equal(result.current.orderedBy, null);
    failRequests = false;
    state = { online: false, session_id: 'old', manual_offline_since: null };
    result = await (await get()).json();
    assert.equal(result.current.orderedBy, null);
    playerStatus = 204;
    result = await (await get()).json();
    assert.equal(result.isPlaying, false);
    assert.equal(result.error, undefined);
    playerStatus = 429;
    result = await (await get()).json();
    assert.ok(result.error);
  } finally {
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});
