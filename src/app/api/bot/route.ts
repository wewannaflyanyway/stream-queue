import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { getStreamerAccessToken } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('query');
    const user = req.nextUrl.searchParams.get('user') || 'Аноним';

    // 1. Проверка на пустую команду !sr (выводим инструкцию)
    if (!query || query.trim() === '') {
      return new NextResponse(
        '👋 Привет! Заказывай музыку командой !sr <название или ссылка>. Полезное: !song (текущий трек) | !wrongsong (отменить заказ).', 
        { status: 200 }
      );
    }

    const supabase = getServiceSupabase();

    // 2. Проверяем, включен ли прием заказов в админке
    const { data: settings } = await supabase
      .from('stream_settings')
      .select('is_accepting')
      .eq('id', 1)
      .single();

    if (settings && settings.is_accepting === false) {
      return new NextResponse(`@${user}, сейчас прием заказов закрыт 🛑`, { status: 200 });
    }

    // 3. Ищем трек в Spotify
    const token = await getStreamerAccessToken();
    let track = null;

    if (query.includes('spotify.com/track/')) {
      // Если зритель кинул прямую ссылку
      const trackId = query.split('track/')[1].split('?')[0];
      const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) track = await res.json();
    } else {
      // Если зритель написал название текстом
      const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tracks && data.tracks.items.length > 0) {
          track = data.tracks.items[0];
        }
      }
    }

    if (!track) {
      return new NextResponse(`@${user}, трек не найден 😔 Проверь название или попробуй кинуть ссылку.`, { status: 200 });
    }

    // 4. Записываем найденный трек в базу данных
    const { error } = await supabase
      .from('song_requests')
      .insert({
        track_name: track.name,
        artist_name: track.artists.map((a: any) => a.name).join(', '),
        album_cover_url: track.album?.images?.[0]?.url || '',
        spotify_uri: track.uri,
        duration_ms: track.duration_ms,
        is_explicit: track.explicit || false,
        sender_name: user.toLowerCase(),
        source: 'twitch',
        status: 'pending' // Отправляем на модерацию в админку
      });

    if (error) {
      console.error('Ошибка БД:', error);
      return new NextResponse(`@${user}, ошибка при добавлении в базу.`, { status: 200 });
    }

    return new NextResponse(`@${user}, трек "${track.artists[0].name} - ${track.name}" добавлен в очередь! 🎵`, { status: 200 });

  } catch (error) {
    console.error('Ошибка в боте:', error);
    return new NextResponse('Произошла системная ошибка при обработке заказа.', { status: 200 });
  }
}