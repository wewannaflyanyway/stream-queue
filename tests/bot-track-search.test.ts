import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeSpotifyLink, resolveBotTextSearch, spotifyTrackId, type BotSpotifyTrack } from '../src/lib/bot-track-search';

function track(name: string, artist: string): BotSpotifyTrack {
  return { id: name, name, uri: `spotify:track:${name}`, artists: [{ name: artist }], duration_ms: 180000, explicit: false };
}

test('uses the first Spotify result even when the name differs or several songs match', async () => {
  for (const query of ['тошно stedd', 'stray kids la la la', 'Numb', 'Linkin Park - Numb']) {
    const calls: string[] = [];
    const result = await resolveBotTextSearch(query, async value => {
      calls.push(value);
      return [track('Spotify first', 'Artist'), track('Another result', 'Artist')];
    });
    assert.deepEqual(calls, [query]);
    assert.equal(result.kind, 'match');
    if (result.kind === 'match') assert.equal(result.track.name, 'Spotify first');
  }
});

test('handles empty and malformed Spotify results and propagates service errors', async () => {
  assert.equal((await resolveBotTextSearch('unknown', async () => [])).kind, 'not_found');
  const result = await resolveBotTextSearch('unknown', async () => [{ ...track('bad', 'x'), artists: [] }, track('valid', 'x')]);
  assert.equal(result.kind, 'match');
  if (result.kind === 'match') assert.equal(result.track.name, 'valid');
  await assert.rejects(resolveBotTextSearch('unknown', async () => { throw new Error('Spotify 429'); }), /429/);
});

test('recognizes only track URLs and Spotify track URIs', () => {
  const id = '5aEzGuXQrhQxgG20NM2b26';
  for (const value of [`https://open.spotify.com/track/${id}?si=abc`, `https://open.spotify.com/intl-ru/track/${id}/`, `open.spotify.com/track/${id}`, `spotify:track:${id}`]) assert.equal(spotifyTrackId(value), id);
  for (const value of [`https://notspotify.com/track/${id}`, `https://open.spotify.com/album/${id}`, 'https://open.spotify.com/track/bad', 'hello world']) assert.equal(spotifyTrackId(value), null);
  assert.equal(looksLikeSpotifyLink('https://open.spotify.com/album/example'), true);
  assert.equal(looksLikeSpotifyLink('artist track'), false);
});
