import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

test('web requests use verified Spotify metadata instead of client-provided values', async () => {
  const saved: Record<string, unknown>[] = [];
  let verified = { uri: 'spotify:track:5aEzGuXQrhQxgG20NM2b26', name: 'Real track', artist: 'Real artist', durationMs: 180000, isExplicit: true };
  const settings = { is_accepting: true, auto_approve: false, max_queue_size: 15, max_duration_sec: 300, cooldown_user_sec: 0, prevent_duplicates: false, duplicate_cooldown_min: 0, explicit_mode: 'block', banned_words: '', banned_artists: '' };
  mock.module(new URL('../src/lib/spotify.ts', import.meta.url).href, { namedExports: { getSpotifyTrack: async () => verified, addTrackToSpotifyQueue: async () => true } });
  mock.module(new URL('../src/lib/stream/lifecycle.ts', import.meta.url).href, { namedExports: { reconcileStreamState: async () => null } });
  mock.module(new URL('../src/lib/supabase.ts', import.meta.url).href, { namedExports: {
    getServiceSupabase: () => ({ from: (table: string) => table === 'stream_settings'
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: settings, error: null }) }) }) }
      : { select: () => ({ eq: () => ({ eq: async () => ({ count: 0, error: null }) }) }), insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => { saved.push(row); return { data: row, error: null }; } }) }) },
    }),
  } });
  try {
    const { POST } = await import('../src/app/api/requests/route');
    const send = () => POST(new NextRequest('http://localhost/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spotify_uri: verified.uri, track_name: 'Fake', artist_name: 'Fake', duration_ms: 1, is_explicit: false, sender_name: 'viewer' }) }));
    assert.equal((await send()).status, 400);
    assert.equal(saved.length, 0);
    verified = { ...verified, isExplicit: false };
    assert.equal((await send()).status, 200);
    assert.equal(saved[0].track_name, 'Real track');
    assert.equal(saved[0].artist_name, 'Real artist');
    assert.equal(saved[0].duration_ms, 180000);
    assert.equal(saved[0].album_cover_url, '');
  } finally { mock.restoreAll(); }
});
