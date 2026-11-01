/** Matching logic for text requests from chat. Spotify's ranking alone is not proof of a match. */
export interface BotSpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  album?: { images?: { url?: string }[] };
  duration_ms: number;
  explicit: boolean;
}

export type BotSearchResult =
  | { kind: 'match'; track: BotSpotifyTrack }
  | { kind: 'uncertain' }
  | { kind: 'not_found' };

type StructuredQuery = { artist: string; title: string };

function words(text: string): string[] {
  return [...new Set((text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('ru').replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? []))];
}

function normal(text: string): string {
  return words(text).join(' ');
}

function repeatedSyllable(text: string): string | null {
  const compact = text.normalize('NFKD').toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]/gu, '');
  return /^(\p{L}{1,3})\1{2,}$/u.exec(compact)?.[1] ?? null;
}

function repetitiveTitleMatch(query: string, track: BotSpotifyTrack): boolean {
  const normalizedQuery = query.normalize('NFKD').toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return track.artists.some(artist => {
    const name = artist.name.normalize('NFKD').toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!name) return false;
    const remainder = normalizedQuery.startsWith(`${name} `) ? normalizedQuery.slice(name.length + 1) : normalizedQuery.endsWith(` ${name}`) ? normalizedQuery.slice(0, -name.length - 1) : '';
    const wanted = repeatedSyllable(remainder);
    return wanted !== null && wanted === repeatedSyllable(track.name);
  });
}

function coverage(expected: string[], actual: string[]): number {
  if (!expected.length) return 0;
  const present = new Set(actual);
  return expected.filter(word => present.has(word)).length / expected.length;
}

function artistTerms(text: string): string[] {
  const all = words(text);
  const meaningful = all.filter(word => !['the', 'and', 'feat', 'featuring', 'ft'].includes(word));
  return meaningful.length ? meaningful : all;
}

function artistMatches(expected: string, track: BotSpotifyTrack): boolean {
  const wanted = artistTerms(expected);
  const names = [...track.artists.map(artist => artistTerms(artist.name)), artistTerms(track.artists.map(artist => artist.name).join(' '))];
  return names.some(actual => coverage(wanted, actual) >= 0.8 && coverage(actual, wanted) >= 0.75);
}

function parsePair(query: string): [StructuredQuery, StructuredQuery] | null {
  // Require spaces around a hyphen so titles such as Ben-10 and AC-DC remain intact.
  const parts = query.split(/\s+[-–—]\s+/u);
  if (parts.length !== 2 || !words(parts[0]).length || !words(parts[1]).length) return null;
  const [left, right] = parts.map(part => part.trim());
  return [{ artist: left, title: right }, { artist: right, title: left }];
}

function fieldValue(value: string): string {
  // Field syntax is constructed by us, not interpolated as Spotify operators.
  return value.replace(/["\\:]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function spotifyTrackId(input: string): string | null {
  const value = input.trim();
  const uri = /^spotify:track:([a-z0-9]{22})$/i.exec(value);
  if (uri) return uri[1];
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)spotify\.com$/i.test(url.hostname)) return null;
    const path = /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/([a-z0-9]{22})\/?$/i.exec(url.pathname);
    return path?.[1] ?? null;
  } catch { return null; }
}

export function looksLikeSpotifyLink(input: string): boolean {
  return /spotify\.com|^spotify:/i.test(input.trim());
}

function rank(track: BotSpotifyTrack, query: string, pair: [StructuredQuery, StructuredQuery] | null): number | null {
  const titleWords = words(track.name);
  const artistWords = words(track.artists.map(artist => artist.name).join(' '));
  const fullWords = [...titleWords, ...artistWords];
  if (pair) {
    const scores = pair.map(({ artist, title }) => {
      const titleMatch = coverage(words(title), titleWords);
      const artistMatch = coverage(artistTerms(artist), artistTerms(track.artists.map(a => a.name).join(' ')));
      if (titleMatch < 0.8 || !artistMatches(artist, track)) return null;
      return titleMatch + artistMatch + (normal(title) === normal(track.name) ? 1 : 0)
        + (track.artists.some(a => normal(a.name) === normal(artist)) ? 0.5 : 0);
    }).filter((score): score is number => score !== null);
    return scores.length ? Math.max(...scores) : null;
  }
  const queryWords = words(query);
  const match = coverage(queryWords, fullWords);
  // At least three quarters of the meaningful words must occur in the title or artists.
  // For a single word, it must be an entire word, not part of an unrelated word.
  const repetitiveMatch = repetitiveTitleMatch(query, track);
  if (!queryWords.length || (match < 0.75 && !repetitiveMatch)) return null;
  const exactTitle = normal(query) === normal(track.name);
  const exactArtist = track.artists.some(a => normal(a.name) === normal(query));
  const exactCombination = track.artists.some(a =>
    normal(query) === normal(`${a.name} ${track.name}`) || normal(query) === normal(`${track.name} ${a.name}`));
  return match + (repetitiveMatch ? 1.5 : 0) + (exactTitle ? 1 : 0) + (exactArtist ? 0.5 : 0) + (exactCombination ? 0.5 : 0)
    + (coverage(queryWords, titleWords) === 1 ? 0.1 : 0);
}

function identity(track: BotSpotifyTrack): string {
  return `${normal(track.name)}|${normal(track.artists[0]?.name ?? '')}`;
}

export async function resolveBotTextSearch(
  query: string,
  search: (spotifyQuery: string) => Promise<BotSpotifyTrack[]>,
): Promise<BotSearchResult> {
  const pair = parsePair(query);
  const queries = pair
    ? pair.map(({ artist, title }) => `artist:"${fieldValue(artist)}" track:"${fieldValue(title)}"`)
    : [query];
  const results = await Promise.all(queries.map(search));
  const candidates = results.flat();
  if (!candidates.length) return { kind: 'not_found' };
  const ranked = candidates
    .filter(track => typeof track?.id === 'string' && typeof track.name === 'string'
      && typeof track.uri === 'string' && Number.isFinite(track.duration_ms)
      && Array.isArray(track.artists) && track.artists.length > 0
      && track.artists.every(artist => typeof artist?.name === 'string'))
    .map(track => ({ track, score: rank(track, query, pair) }))
    .filter((candidate): candidate is { track: BotSpotifyTrack; score: number } => candidate.score !== null)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { kind: 'uncertain' };
  const best = ranked[0];
  // Multiple catalog entries for the same title and artist aren't distinct choices.
  const runnerUp = ranked.find(candidate => identity(candidate.track) !== identity(best.track));
  if (runnerUp && best.score - runnerUp.score < 0.15) return { kind: 'uncertain' };
  return { kind: 'match', track: best.track };
}
