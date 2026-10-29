export type MusicProvider = 'spotify' | 'youtube';

export const MUSIC_PROVIDER_NAMES: Record<MusicProvider, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube',
};

interface RequestSource {
  provider?: string | null;
  spotify_uri?: string | null;
  youtube_video_id?: string | null;
}

export function getRequestProvider(request: RequestSource): MusicProvider {
  if (request.provider === 'spotify' || request.provider === 'youtube') {
    return request.provider;
  }
  if (request.youtube_video_id || request.spotify_uri?.startsWith('youtube:')) {
    return 'youtube';
  }

  // Existing requests predate the provider field and contain Spotify tracks.
  return 'spotify';
}
