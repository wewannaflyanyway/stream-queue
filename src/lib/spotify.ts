const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

const BASIC_AUTH = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

// Кэш токена для поиска треков (живет 50 минут в памяти)
let searchTokenCache: { token: string; expiresAt: number } | null = null;

// Кэш токена стримера для быстрых кнопок Одобрить/Скип (живет 50 минут)
let streamerTokenCache: { token: string; expiresAt: number } | null = null;

// 1. Получение токена для поиска (Client Credentials Flow)
export async function getClientCredentialsToken(): Promise<string> {
  if (searchTokenCache && Date.now() < searchTokenCache.expiresAt) {
    return searchTokenCache.token;
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
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

  const data = await res.json();
  searchTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return data.access_token;
}

// 2. Получение токена стримера для управления плеером (Refresh Token Flow)
export async function getStreamerAccessToken(): Promise<string> {
  if (streamerTokenCache && Date.now() < streamerTokenCache.expiresAt) {
    return streamerTokenCache.token;
  }

  if (!REFRESH_TOKEN) {
    throw new Error('SPOTIFY_REFRESH_TOKEN не настроен в .env.local');
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
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
    throw new Error('Не удалось обновить токен стримера Spotify');
  }

  const data = await res.json();
  streamerTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return data.access_token;
}

// 3. Поиск треков по каталогу Spotify
export async function searchSpotifyTracks(query: string) {
  const token = await getClientCredentialsToken();
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Ошибка при поиске треков в Spotify');
  }

  const data = await res.json();
  return (data.tracks?.items || []).map((track: any) => ({
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists.map((a: any) => a.name).join(', '),
    albumCover: track.album.images?.[1]?.url || track.album.images?.[0]?.url || '',
    durationMs: track.duration_ms,
    isExplicit: track.explicit,
  }));
}

// 4. Добавление трека в очередь воспроизведения стримера
export async function addTrackToSpotifyQueue(spotifyUri: string) {
  const token = await getStreamerAccessToken();
  const url = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(spotifyUri)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 404) {
    throw new Error('NO_ACTIVE_DEVICE');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ошибка Spotify API (${res.status}): ${errText}`);
  }

  return true;
}

// 5. Скип текущего трека в плеере стримера
export async function skipSpotifyTrack() {
  const token = await getStreamerAccessToken();
  const res = await fetch('https://api.spotify.com/v1/me/player/next', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 404) {
    throw new Error('NO_ACTIVE_DEVICE');
  }

  if (!res.ok) {
    throw new Error(`Ошибка скипа трека (${res.status})`);
  }

  return true;
}