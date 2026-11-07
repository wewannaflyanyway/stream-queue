/** Spotify's own ranking is used for chat requests, as it was before strict matching. */
export interface BotSpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  duration_ms: number;
  explicit: boolean;
}

export type BotSearchResult = { kind: 'match'; track: BotSpotifyTrack } | { kind: 'not_found' };

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

export async function resolveBotTextSearch(
  query: string,
  search: (spotifyQuery: string) => Promise<BotSpotifyTrack[]>,
): Promise<BotSearchResult> {
  const candidates = await search(query);
  const track = candidates.find(candidate => typeof candidate?.id === 'string'
    && typeof candidate.name === 'string' && typeof candidate.uri === 'string'
    && Number.isFinite(candidate.duration_ms) && Array.isArray(candidate.artists)
    && candidate.artists.length > 0 && candidate.artists.every(artist => typeof artist?.name === 'string'));
  return track ? { kind: 'match', track } : { kind: 'not_found' };
}
