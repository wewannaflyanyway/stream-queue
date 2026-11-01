import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeSpotifyLink, resolveBotTextSearch, spotifyTrackId, type BotSpotifyTrack } from '../src/lib/bot-track-search';

function track(name: string, artist: string, id = name): BotSpotifyTrack {
  return { id, name, uri: `spotify:track:${id}`, artists: [{ name: artist }], duration_ms: 180000, explicit: false };
}

test('rejects the unrelated JOHN CENA result from the reported Ben-10 query', async () => {
  const result = await resolveBotTextSearch('Opening Theme Ben-10 Classic', async () => [
    track('JOHN CENA', 'Joey Valence & Brae'),
    track('2043 Shop Like a Billionaire Bloodbath', 'Flash Poetry'),
  ]);
  assert.equal(result.kind, 'uncertain');
});

test('matches a repeated syllable written with spaces to the original track', async () => {
  const result = await resolveBotTextSearch('stray kids la la la', async () => [track('LALALALA', 'Stray Kids'), track('LALALALA (Rock Ver.)', 'Stray Kids'), track('This & That', 'Stray Kids')]);
  assert.equal(result.kind, 'match');
  if (result.kind === 'match') assert.equal(result.track.name, 'LALALALA');
  assert.equal((await resolveBotTextSearch('stray kids la la la', async () => [track('LALALALA', 'Other Artist')])).kind, 'uncertain');
});

test('finds a relevant candidate after unrelated results and tolerates punctuation', async () => {
  const result = await resolveBotTextSearch('Opening Theme Ben-10 Classic', async () => [
    track('JOHN CENA', 'Joey Valence & Brae'),
    track('Ben 10 (Classic) Theme', 'Thomas Straiton'),
  ]);
  assert.equal(result.kind, 'match');
  if (result.kind === 'match') assert.equal(result.track.name, 'Ben 10 (Classic) Theme');
});

test('prefers exact Russian track and artist over other songs by that artist', async () => {
  const result = await resolveBotTextSearch('барбарики', async () => [
    track('Фраер', 'Михаил Круг'), track('С днём рождения', 'Барбарики'), track('Барбарики', 'Барбарики'),
  ]);
  assert.equal(result.kind, 'match');
  if (result.kind === 'match') assert.equal(result.track.name, 'Барбарики');
});

test('uses Spotify artist and track fields for both common dash orders', async () => {
  for (const query of ['Linkin Park - Numb', 'Numb — Linkin Park']) {
    const queries: string[] = [];
    const result = await resolveBotTextSearch(query, async spotifyQuery => {
      queries.push(spotifyQuery);
      return spotifyQuery === 'artist:"Linkin Park" track:"Numb"'
        ? [track('Numb', 'Linkin Park')]
        : [track('Linkin Park', 'Numb')];
    });
    assert.deepEqual(new Set(queries), new Set(['artist:"Linkin Park" track:"Numb"', 'artist:"Numb" track:"Linkin Park"']));
    // Both interpretations are genuinely possible; do not silently choose one.
    assert.equal(result.kind, 'uncertain');
    const unambiguous = await resolveBotTextSearch(query, async spotifyQuery => spotifyQuery === 'artist:"Linkin Park" track:"Numb"' ? [track('Numb', 'Linkin Park')] : []);
    assert.equal(unambiguous.kind, 'match');
    if (unambiguous.kind === 'match') assert.equal(unambiguous.track.name, 'Numb');
  }
});

test('requires a matching artist and title in a structured query', async () => {
  const result = await resolveBotTextSearch('Linkin Park - Numb', async () => [track('Numb', 'Other Artist')]);
  assert.equal(result.kind, 'uncertain');
  const tribute = await resolveBotTextSearch('The Beatles - Help', async () => [track('Help', 'The Beatles Tribute Band')]);
  assert.equal(tribute.kind, 'uncertain');
  const omittedArticle = await resolveBotTextSearch('Beatles - Help', async () => [track('Help', 'The Beatles')]);
  assert.equal(omittedArticle.kind, 'match');
});

test('asks for clarification when several distinct candidates fit equally well', async () => {
  const result = await resolveBotTextSearch('Numb', async () => [track('Numb', 'Linkin Park'), track('Numb', 'Other Artist')]);
  assert.equal(result.kind, 'uncertain');
  const artistOnly = await resolveBotTextSearch('Барбарики', async () => [track('Песня первая', 'Барбарики'), track('Песня вторая', 'Барбарики')]);
  assert.equal(artistOnly.kind, 'uncertain');
});

test('does not treat duplicate releases of the same song as ambiguous', async () => {
  const result = await resolveBotTextSearch('Numb Linkin Park', async () => [track('Numb', 'Linkin Park', 'first'), track('Numb', 'Linkin Park', 'second')]);
  assert.equal(result.kind, 'match');
});

test('prefers an exact artist and title over a similarly named version', async () => {
  const result = await resolveBotTextSearch('Linkin Park Numb', async () => [track('Numb - Live', 'Linkin Park'), track('Numb', 'Linkin Park')]);
  assert.equal(result.kind, 'match');
  if (result.kind === 'match') assert.equal(result.track.name, 'Numb');
});

test('normalizes case, ё and diacritics without accepting partial words', async () => {
  assert.equal((await resolveBotTextSearch('Ёлка прованс', async () => [track('Прованс', 'Елка')])).kind, 'match');
  assert.equal((await resolveBotTextSearch('Beyonce halo', async () => [track('Halo', 'Beyoncé')])).kind, 'match');
  assert.equal((await resolveBotTextSearch('love', async () => [track('Glove', 'Artist')])).kind, 'uncertain');
});

test('distinguishes empty results from Spotify errors', async () => {
  assert.equal((await resolveBotTextSearch('unknown track', async () => [])).kind, 'not_found');
  await assert.rejects(resolveBotTextSearch('unknown track', async () => { throw new Error('Spotify 429'); }), /429/);
});

test('recognizes only track URLs and Spotify track URIs', () => {
  const id = '5aEzGuXQrhQxgG20NM2b26';
  for (const value of [`https://open.spotify.com/track/${id}?si=abc`, `https://open.spotify.com/intl-ru/track/${id}/`, `open.spotify.com/track/${id}`, `spotify:track:${id}`]) assert.equal(spotifyTrackId(value), id);
  for (const value of [`https://notspotify.com/track/${id}`, `https://open.spotify.com/album/${id}`, 'https://open.spotify.com/track/bad', 'hello world']) assert.equal(spotifyTrackId(value), null);
  assert.equal(looksLikeSpotifyLink('https://open.spotify.com/album/example'), true);
  assert.equal(looksLikeSpotifyLink('artist track'), false);
});
