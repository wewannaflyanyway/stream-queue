import { NextRequest, NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';
import { readStreamState } from '@/lib/stream/lifecycle';
import { hasAdminSession } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!hasAdminSession(request)) return NextResponse.json({ error: 'Сессия админки истекла. Войдите снова.' }, { status: 401 });
    if (body.sessionId !== null && body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.sessionId))) return NextResponse.json({ error: 'Некорректный стрим.' }, { status: 400 });
    const token = await getStreamerAccessToken();
    const supabase = getServiceSupabase();
    const stream = await readStreamState();
    if (stream?.automation_enabled && !body.sessionId) return NextResponse.json({ error: 'Нет истории текущего стрима для экспорта.' }, { status: 400 });

    // 1. Получаем профиль пользователя
    const userRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!userRes.ok) {
      return NextResponse.json({ error: 'Не удалось получить профиль Spotify. Проверьте авторизацию.' }, { status: 400 });
    }
    const userData = await userRes.json();

    // 2. Достаем треки из базы
    let query = supabase
      .from('song_requests')
      .select('spotify_uri')
      .in('status', ['played', 'approved'])
      .order('created_at', { ascending: true });
    if (body.sessionId) query = query.eq('stream_session_id', body.sessionId).eq('stream_history_hidden', false);
    const { data: tracks, error: dbError } = await query;

    if (dbError) {
      return NextResponse.json({ error: 'Ошибка базы данных' }, { status: 500 });
    }

    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'Нет одобренных треков для экспорта' }, { status: 400 });
    }

    const uris = [...new Set(tracks.map(t => t.spotify_uri).filter(Boolean))];
    const date = new Date().toLocaleDateString('ru-RU');
    
    // 3. Создаем ПРИВАТНЫЙ плейлист (требует меньше жестких прав, чем публичный)
    const playlistRes = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Стрим-заказы (${date})`,
        description: 'Треки, заказанные зрителями на стриме.',
        public: false // Изменили на false для безопасности
      })
    });

    if (!playlistRes.ok) {
      const err = await playlistRes.json();
      console.error('Spotify API Error:', err);
      if (playlistRes.status === 403) {
        return NextResponse.json({ error: 'Нет прав Spotify. Нужно переавторизовать бота с правами "playlist-modify-private"' }, { status: 403 });
      }
      return NextResponse.json({ error: err.error?.message || 'Spotify отклонил создание плейлиста' }, { status: 400 });
    }

    const playlistData = await playlistRes.json();

    // 4. Заливаем треки пачками по 100 штук
    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      const addResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistData.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: chunk })
      });
      if (!addResponse.ok) return NextResponse.json({ error: `Плейлист создан, но не удалось добавить все треки Spotify (ошибка ${addResponse.status}). Проверьте плейлист перед повтором.`, url: playlistData.external_urls?.spotify }, { status: 502 });
    }

    return NextResponse.json({ success: true, url: playlistData.external_urls?.spotify });
  } catch (error: unknown) {
    console.error('Export Error:', error);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
