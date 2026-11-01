import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { fetchWithTimeout, getStreamerAccessToken } from '@/lib/spotify';
import { looksLikeSpotifyLink, resolveBotTextSearch, spotifyTrackId, type BotSpotifyTrack } from '@/lib/bot-track-search';
import { reconcileStreamState } from '@/lib/stream/lifecycle';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('query')?.trim();
    const user = req.nextUrl.searchParams.get('user') || 'Аноним';

    if (!query || query.trim() === '') {
      return new NextResponse(
        '👋 Привет! Заказывай музыку командой !sr <название или ссылка>. Полезное: !song (текущий трек) | !wrongsong (отменить заказ).', 
        { status: 200 }
      );
    }

    if (query.length > 200) return new NextResponse(`@${user}, запрос слишком длинный. Укажи название и исполнителя или ссылку Spotify.`, { status: 200 });

    const supabase = getServiceSupabase();
    await reconcileStreamState();

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
    let track: BotSpotifyTrack | null = null;

    const trackId = spotifyTrackId(query);
    if (trackId) {
      const res = await fetchWithTimeout(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (res.status !== 404 && !res.ok) throw new Error('Spotify track lookup failed');
      if (res.ok) track = await res.json() as BotSpotifyTrack;
    } else if (looksLikeSpotifyLink(query)) {
      return new NextResponse(`@${user}, не удалось распознать ссылку на трек Spotify. Скопируй ссылку на отдельный трек.`, { status: 200 });
    } else {
      const result = await resolveBotTextSearch(query, async (spotifyQuery) => {
        const params = new URLSearchParams({ q: spotifyQuery, type: 'track', limit: '10' });
        const res = await fetchWithTimeout(`https://api.spotify.com/v1/search?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store'
        });
        if (!res.ok) throw new Error('Spotify search failed');
        const data = await res.json() as { tracks?: { items?: BotSpotifyTrack[] } };
        return data.tracks?.items ?? [];
      });
      if (result.kind === 'uncertain') {
        return new NextResponse(`@${user}, не удалось уверенно определить трек. Укажи исполнителя и название или пришли ссылку Spotify.`, { status: 200 });
      }
      if (result.kind === 'match') track = result.track;
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

    const { data: inserted, error } = await supabase
      .from('song_requests')
      .insert({
        track_name: track.name,
        artist_name: track.artists.map(a => a.name).join(', '),
        album_cover_url: track.album?.images?.[0]?.url || '',
        spotify_uri: track.uri,
        duration_ms: track.duration_ms,
        is_explicit: track.explicit || false,
        sender_name: user.toLowerCase(),
        source: 'twitch',
        status: 'pending'
      }).select('id').single();

    if (error) {
      if (error.message.includes('Прием заявок закрыт')) return new NextResponse(`@${user}, сейчас прием заказов закрыт 🛑`, { status: 200 });
      return new NextResponse(`@${user}, ошибка при добавлении в базу.`, { status: 200 });
    }

    // Если статус approved, сразу отправляем запрос в Spotify
    if (finalStatus === 'approved') {
      const { data: latestSettings } = await supabase.from('stream_settings').select('is_accepting').eq('id', 1).single();
      if (!latestSettings?.is_accepting) return new NextResponse(`@${user}, заявка сохранена на модерацию: прием заказов приостановлен.`, { status: 200 });
      try {
        const queued = await fetchWithTimeout(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(track.uri)}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }
        });
        if (queued.ok) {
          const { error: updateError } = await supabase.from('song_requests').update({ status: 'approved', queued_at: new Date().toISOString() }).eq('id', inserted.id);
          if (updateError) return new NextResponse(`@${user}, трек добавлен в Spotify, но статус заявки не сохранился. Сообщи стримеру.`, { status: 200 });
          return new NextResponse(`@${user}, трек "${track.artists[0].name} - ${track.name}" добавлен в очередь! 🎵`, { status: 200 });
        }
      } catch { /* Leave the request on moderation when Spotify is unavailable. */ }
    }

    return new NextResponse(`@${user}, трек "${track.artists[0].name} - ${track.name}" отправлен на модерацию! ⏳`, { status: 200 });

  } catch {
    return new NextResponse('Произошла системная ошибка при обработке заказа.', { status: 200 });
  }
}
