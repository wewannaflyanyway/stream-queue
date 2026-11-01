import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { addTrackToSpotifyQueue } from '@/lib/spotify';
import { reconcileStreamState } from '@/lib/stream/lifecycle';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      track_name,
      artist_name,
      album_cover_url,
      spotify_uri,
      duration_ms,
      is_explicit,
      sender_name,
      source = 'web',
    } = body;

    if (!track_name || !artist_name || !spotify_uri || !duration_ms) {
      return NextResponse.json({ error: 'Неполные данные о треке' }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    await reconcileStreamState();

    // 1. Загружаем актуальные настройки стрима
    const { data: settings, error: settingsErr } = await supabase
      .from('stream_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (settingsErr || !settings) {
      return NextResponse.json({ error: 'Ошибка чтения настроек стрима' }, { status: 500 });
    }

    if (!settings.is_accepting) {
      return NextResponse.json({ error: 'Прием музыки сейчас закрыт стримером' }, { status: 403 });
    }

    // 2. Проверка вместимости очереди (pending)
    const { count: pendingCount } = await supabase
      .from('song_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('stream_pending_archived', false);

    if ((pendingCount || 0) >= settings.max_queue_size) {
      return NextResponse.json(
        { error: 'Очередь заполнена. Новые заказы откроются по мере воспроизведения' },
        { status: 429 }
      );
    }

    // 3. Проверка длительности трека
    const durationSec = Math.ceil(duration_ms / 1000);
    if (durationSec > settings.max_duration_sec) {
      const maxMin = Math.floor(settings.max_duration_sec / 60);
      return NextResponse.json(
        { error: `Трек слишком длинный (максимум ${maxMin} мин)` },
        { status: 400 }
      );
    }

    // 4. Проверка 18+ (Explicit)
    if (settings.explicit_mode === 'block' && is_explicit) {
      return NextResponse.json({ error: 'Треки 18+ запрещены стримером' }, { status: 400 });
    }

    // 5. Проверка бан-вордов и запрещенных исполнителей
    const lowerTrack = track_name.toLowerCase();
    const lowerArtist = artist_name.toLowerCase();

    const bannedWords = (settings.banned_words || '')
      .split(',')
      .map((w: string) => w.trim().toLowerCase())
      .filter(Boolean);

    const bannedArtists = (settings.banned_artists || '')
      .split(',')
      .map((a: string) => a.trim().toLowerCase())
      .filter(Boolean);

    const hasBannedWord = bannedWords.some(
      (word: string) => lowerTrack.includes(word) || lowerArtist.includes(word)
    );
    const hasBannedArtist = bannedArtists.some((artist: string) => lowerArtist.includes(artist));

    if (hasBannedWord || hasBannedArtist) {
      return NextResponse.json({ error: 'Этот трек или автор заблокирован' }, { status: 400 });
    }

    // 6. Проверка дубликатов за последние N минут
    if (settings.prevent_duplicates) {
      const cooldownAgo = new Date(
        Date.now() - settings.duplicate_cooldown_min * 60 * 1000
      ).toISOString();

      const { data: dupes } = await supabase
        .from('song_requests')
        .select('id')
        .eq('spotify_uri', spotify_uri)
        .neq('status', 'rejected')
        .gte('created_at', cooldownAgo)
        .limit(1);

      if (dupes && dupes.length > 0) {
        return NextResponse.json(
          { error: 'Этот трек уже заказывали совсем недавно' },
          { status: 400 }
        );
      }
    }

    // 7. Логика автодобавления (auto_approve)
    let initialStatus = 'pending';
    const shouldHoldExplicit = is_explicit && settings.explicit_mode === 'manual';

    const cleanSender = (sender_name || '').trim().slice(0, 24) || 'Аноним';

    const { data: inserted, error: insertErr } = await supabase
      .from('song_requests')
      .insert({
        track_name,
        artist_name,
        album_cover_url,
        spotify_uri,
        duration_ms,
        is_explicit: Boolean(is_explicit),
        sender_name: cleanSender,
        source,
        status: initialStatus,
      })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.message.includes('Прием заявок закрыт')) return NextResponse.json({ error: 'Прием музыки сейчас закрыт стримером' }, { status: 403 });
      return NextResponse.json({ error: 'Ошибка сохранения заявки в БД' }, { status: 500 });
    }

    if (settings.auto_approve && !shouldHoldExplicit) {
      const { data: latestSettings } = await supabase.from('stream_settings').select('is_accepting').eq('id', 1).single();
      if (latestSettings?.is_accepting) {
        try {
          await addTrackToSpotifyQueue(spotify_uri);
        } catch {
          return NextResponse.json({ request: inserted, status: 'pending' });
        }
        const { data: approved, error: approvalError } = await supabase.from('song_requests').update({ status: 'approved', queued_at: new Date().toISOString() }).eq('id', inserted.id).select().single();
        if (approvalError) return NextResponse.json({ error: 'Трек добавлен в Spotify, но статус не сохранился. Сообщите стримеру и не отправляйте его повторно.' }, { status: 500 });
        initialStatus = 'approved';
        return NextResponse.json({ request: approved, status: initialStatus });
      }
    }

    return NextResponse.json({ request: inserted, status: initialStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
