import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { fetchWithTimeout, getStreamerAccessToken } from '@/lib/spotify';
import { looksLikeSpotifyLink, resolveBotTextSearch, spotifyTrackId, type BotSpotifyTrack } from '@/lib/bot-track-search';
import { reconcileStreamState } from '@/lib/stream/lifecycle';
import { RequestPolicyError, validateRequestLimits, validateTrackPolicy, type RequestSettings } from '@/lib/request-policy';
import { enqueueRequest } from '@/lib/enqueue-request';

export async function requestSong(query: string | null, user: string, twitchUserId: string | null = null) {
  try {
    query = query?.trim() || null;

    if (!query || query.trim() === '') {
      return new NextResponse(
        '👋 Привет! Заказывай музыку командой !sr <название или ссылка>. Полезное: !song (текущий трек) | !очередь (сколько треков перед твоим заказом) | !wrongsong (отменить заказ).',
        { status: 200 }
      );
    }

    if (query.length > 200) return new NextResponse(`@${user}, запрос слишком длинный. Укажи название и исполнителя или ссылку Spotify.`, { status: 200 });

    const supabase = getServiceSupabase();
    await reconcileStreamState();

    // Запрашиваем настройки автодобавления и модерации
    const { data: settings } = await supabase
      .from('stream_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (!settings) return new NextResponse(`@${user}, не удалось проверить настройки заказов. Попробуй позже.`, { status: 200 });
    if (!settings.is_accepting) {
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
      if (result.kind === 'match') track = result.track;
    }

    if (!track) {
      return new NextResponse(`@${user}, трек не найден 😔 Проверь название или попробуй кинуть ссылку.`, { status: 200 });
    }

    const normalizedTrack = { uri: track.uri, name: track.name, artist: track.artists.map(a => a.name).join(', '), durationMs: track.duration_ms, isExplicit: track.explicit === true };
    try {
      validateTrackPolicy(normalizedTrack, settings as RequestSettings);
      await validateRequestLimits(supabase, normalizedTrack, settings as RequestSettings, user, twitchUserId);
    } catch (error) {
      if (error instanceof RequestPolicyError) return new NextResponse(`@${user}, ${error.message}`, { status: 200 });
      throw error;
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
        album_cover_url: '',
        spotify_uri: track.uri,
        duration_ms: track.duration_ms,
        is_explicit: track.explicit || false,
        sender_name: user.toLowerCase(),
        sender_twitch_id: twitchUserId,
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
        const result = await enqueueRequest(supabase, inserted.id);
        if (result === 'queued') return new NextResponse(`@${user}, трек "${track.artists[0].name} - ${track.name}" добавлен в очередь! 🎵`, { status: 200 });
        if (result !== 'not_available') return new NextResponse(`@${user}, не удалось подтвердить отправку в Spotify. Сообщи стримеру и не заказывай повторно.`, { status: 200 });
      } catch { return new NextResponse(`@${user}, не удалось подтвердить отправку в Spotify. Сообщи стримеру и не заказывай повторно.`, { status: 200 }); }
    }

    return new NextResponse(`@${user}, трек "${track.artists[0].name} - ${track.name}" отправлен на модерацию! ⏳`, { status: 200 });

  } catch {
    return new NextResponse('Произошла системная ошибка при обработке заказа.', { status: 200 });
  }
}
