import { NextRequest } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { searchSpotifyTracks, addTrackToSpotifyQueue } from '@/lib/spotify';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('query')?.trim();
  const user = req.nextUrl.searchParams.get('user')?.trim() || 'Зритель';

  if (!q) {
    return new Response(`@${user}, укажи название трека после команды (например: !sr Linkin Park Numb)`);
  }

  try {
    const supabase = getServiceSupabase();
    
    const { data: settings } = await supabase.from('stream_settings').select('*').eq('id', 1).single();
    if (!settings?.is_accepting) {
      return new Response(`@${user}, прием музыки сейчас закрыт стримером.`);
    }

    const { count: pendingCount } = await supabase
      .from('song_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
      
    if ((pendingCount || 0) >= (settings.max_queue_size || 15)) {
      return new Response(`@${user}, очередь переполнена. Попробуй позже.`);
    }

    // 1. Проверка кулдауна самого зрителя (анти-спам)
    if (settings.cooldown_user_sec > 0) {
      const cooldownAgo = new Date(Date.now() - settings.cooldown_user_sec * 1000).toISOString();
      const { data: userRecent } = await supabase
        .from('song_requests')
        .select('id')
        .eq('sender_name', user)
        .gte('created_at', cooldownAgo)
        .limit(1);

      if (userRecent && userRecent.length > 0) {
        const min = Math.ceil(settings.cooldown_user_sec / 60);
        return new Response(`@${user}, подожди! Следующий трек можно заказать через ${min} мин.`);
      }
    }

    const tracks = await searchSpotifyTracks(q);
    if (!tracks || tracks.length === 0) {
      return new Response(`@${user}, трек по запросу "${q}" не найден в Spotify.`);
    }
    const track = tracks[0]; 

    // 2. Проверка дубликатов трека
    if (settings.prevent_duplicates) {
      const dupAgo = new Date(Date.now() - settings.duplicate_cooldown_min * 60 * 1000).toISOString();
      const { data: dupes } = await supabase
        .from('song_requests')
        .select('id')
        .eq('spotify_uri', track.uri)
        .neq('status', 'rejected')
        .gte('created_at', dupAgo)
        .limit(1);

      if (dupes && dupes.length > 0) {
        return new Response(`@${user}, этот трек уже заказывали недавно! Выбери другой.`);
      }
    }

    const durationSec = Math.ceil(track.durationMs / 1000);
    if (durationSec > settings.max_duration_sec) {
      return new Response(`@${user}, трек "${track.name}" слишком длинный.`);
    }
    if (settings.explicit_mode === 'block' && track.isExplicit) {
      return new Response(`@${user}, треки 18+ запрещены на стриме.`);
    }
    
    const lowerName = `${track.name} ${track.artist}`.toLowerCase();
    const bannedWords = (settings.banned_words || '').split(',').map((w: string) => w.trim().toLowerCase()).filter(Boolean);
    if (bannedWords.some((w: string) => lowerName.includes(w))) {
      return new Response(`@${user}, этот трек заблокирован фильтром слов.`);
    }

    let initialStatus = 'pending';
    if (settings.auto_approve && !(track.isExplicit && settings.explicit_mode === 'manual')) {
      try {
        await addTrackToSpotifyQueue(track.uri);
        initialStatus = 'approved';
      } catch {
        initialStatus = 'pending'; 
      }
    }

    await supabase.from('song_requests').insert({
      track_name: track.name,
      artist_name: track.artist,
      album_cover_url: track.albumCover,
      spotify_uri: track.uri,
      duration_ms: track.durationMs,
      is_explicit: track.isExplicit,
      sender_name: user,
      source: 'twitch_chat',
      status: initialStatus,
    });

    if (initialStatus === 'approved') {
       return new Response(`@${user}, трек ${track.artist} — ${track.name} сразу добавлен в плеер!`);
    }
    return new Response(`@${user}, трек ${track.artist} — ${track.name} отправлен на модерацию.`);

  } catch (err: any) {
    return new Response(`@${user}, произошла техническая ошибка: ${err.message}`);
  }
}