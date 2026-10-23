import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { getStreamerAccessToken } from '@/lib/spotify';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('query');
    const user = req.nextUrl.searchParams.get('user') || 'Аноним';

    if (!query || query.trim() === '') {
      return new NextResponse(
        '👋 Привет! Заказывай музыку командой !sr <название или ссылка>. Полезное: !song (текущий трек) | !wrongsong (отменить заказ).', 
        { status: 200 }
      );
    }

    const supabase = getServiceSupabase();

    // Запрашиваем настройки автодобавления и модерации
    const { data: settings } = await supabase
      .from('stream_settings')
      .select('is_accepting, auto_approve, explicit_mode')
      .eq('id', 1)
      .single();

    if (settings && settings.is_accepting === false) {
      return new NextResponse(`@${user}, сейчас прием заказов закрыт 🛑`, { status: 200 });
    }

    const token = await getStreamerAccessToken();
    let track = null;

    if (query.includes('spotify.com/track/')) {
      const trackId = query.split('track/')[1].split('?')[0];
      const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (res.ok) track = await res.json();
    } else {
      const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
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

    // Логика определения статуса
    let finalStatus = 'pending';
    
    if (settings?.auto_approve) {
      if (track.explicit && settings.explicit_mode === 'manual') {
        finalStatus = 'pending'; // 18+ треки улетают на ручную проверку
      } else if (track.explicit && settings.explicit_mode === 'block') {
        return new NextResponse(`@${user}, треки 18+ (Explicit) сейчас запрещены 🛑`, { status: 200 });
      } else {
        finalStatus = 'approved';
      }
    }

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
        status: finalStatus
      });

    if (error) {
      return new NextResponse(`@${user}, ошибка при добавлении в базу.`, { status: 200 });
    }

    // Если статус approved, сразу отправляем запрос в Spotify
    if (finalStatus === 'approved') {
      await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(track.uri)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      return new NextResponse(`@${user}, трек "${track.artists[0].name} - ${track.name}" добавлен в очередь! 🎵`, { status: 200 });
    }

    return new NextResponse(`@${user}, трек "${track.artists[0].name} - ${track.name}" отправлен на модерацию! ⏳`, { status: 200 });

  } catch (error) {
    return new NextResponse('Произошла системная ошибка при обработке заказа.', { status: 200 });
  }
}