const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

const BASIC_AUTH = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

type SpotifyTokenCache = { token: string; expiresAt: number };

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  albumCover: string;
  durationMs: number;
  isExplicit: boolean;
};

const globalForSpotify = globalThis as unknown as {
  searchTokenCache: SpotifyTokenCache | null;
  streamerTokenCache: SpotifyTokenCache | null;
};

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getSpotifyErrorMessage(res: Response) {
  if (res.status === 404) return 'NO_ACTIVE_DEVICE';
  if (res.status === 401) return 'SPOTIFY_AUTH_ERROR';
  if (res.status === 429) return 'SPOTIFY_RATE_LIMITED';
  return `SPOTIFY_API_ERROR:${res.status}`;
}

export async function getClientCredentialsToken(): Promise<string> {
  if (globalForSpotify.searchTokenCache && Date.now() < globalForSpotify.searchTokenCache.expiresAt) {
    return globalForSpotify.searchTokenCache.token;
  }

  const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${BASIC_AUTH}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Ошибка получения токена поиска Spotify');
  }

  const data = (await res.json()) as { access_token?: string };
  const accessToken = data.access_token;

  if (!accessToken) {
    throw new Error('Spotify token missing from response');
  }

  globalForSpotify.searchTokenCache = {
    token: accessToken,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return accessToken;
}

export async function getStreamerAccessToken(): Promise<string> {
  if (globalForSpotify.streamerTokenCache && Date.now() < globalForSpotify.streamerTokenCache.expiresAt) {
    return globalForSpotify.streamerTokenCache.token;
  }

  if (!REFRESH_TOKEN) {
    throw new Error('SPOTIFY_REFRESH_TOKEN не настроен в .env.local');
  }

  const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${BASIC_AUTH}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const reason = getSpotifyErrorMessage(res);
    throw new Error(reason === 'NO_ACTIVE_DEVICE' ? 'NO_ACTIVE_DEVICE' : 'Не удалось обновить токен стримера Spotify');
  }

  const data = (await res.json()) as { access_token?: string };
  const accessToken = data.access_token;

  if (!accessToken) {
    throw new Error('Spotify streamer token missing from response');
  }

  globalForSpotify.streamerTokenCache = {
    token: accessToken,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return accessToken;
}

export async function searchSpotifyTracks(query: string): Promise<SpotifyTrack[]> {
  const token = await getClientCredentialsToken();
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`;

  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Ошибка при поиске треков в Spotify');
  }

  const data = (await res.json()) as {
    tracks?: {
      items?: Array<{
        id: string;
        uri: string;
        name: string;
        explicit: boolean;
        duration_ms: number;
        artists: Array<{ name: string }>;
        album: {
          images?: Array<{ url?: string }>;
        };
      }>;
    };
  };

  return (data.tracks?.items || []).map((track) => ({
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists.map((artist) => artist.name).join(', '),
    albumCover: track.album.images?.[1]?.url || track.album.images?.[0]?.url || '',
    durationMs: track.duration_ms,
    isExplicit: track.explicit,
  }));
}

export async function addTrackToSpotifyQueue(spotifyUri: string) {
  const token = await getStreamerAccessToken();
  const url = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(spotifyUri)}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 404) {
    throw new Error('NO_ACTIVE_DEVICE');
  }

  if (res.status === 401) {
    globalForSpotify.streamerTokenCache = null;
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ошибка Spotify API (${res.status}): ${errText || getSpotifyErrorMessage(res)}`);
  }

  return true;
}

export async function skipSpotifyTrack() {
  const token = await getStreamerAccessToken();
  const res = await fetchWithTimeout('https://api.spotify.com/v1/me/player/next', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 404) {
    throw new Error('NO_ACTIVE_DEVICE');
  }

  if (res.status === 401) {
    globalForSpotify.streamerTokenCache = null;
  }

  if (!res.ok) {
    throw new Error(`Ошибка скипа трека (${res.status})`);
  }

  return true;
}
