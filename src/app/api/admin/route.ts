import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { addTrackToSpotifyQueue, skipSpotifyTrack } from '@/lib/spotify';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pin, action, payload } = body;

    if (!pin || pin !== process.env.ADMIN_PIN) {
      return NextResponse.json({ error: 'Неверный PIN-код доступа' }, { status: 401 });
    }

    const supabase = getServiceSupabase();

    switch (action) {
      case 'verify_pin': {
        return NextResponse.json({ ok: true });
      }

      case 'approve': {
        const { id, spotify_uri } = payload;
        try {
          await addTrackToSpotifyQueue(spotify_uri);
        } catch (err: any) {
          if (err.message === 'NO_ACTIVE_DEVICE') {
            return NextResponse.json(
              { error: 'Плеер Spotify сейчас не активен! Включи любой трек на ПК и нажми «Одобрить» ещё раз.' },
              { status: 404 }
            );
          }
          throw err;
        }

        const { error } = await supabase.from('song_requests').update({ status: 'approved' }).eq('id', id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'reject': {
        const { id } = payload;
        const { error } = await supabase.from('song_requests').update({ status: 'rejected' }).eq('id', id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'skip': {
        try {
          await skipSpotifyTrack();
          return NextResponse.json({ ok: true });
        } catch (err: any) {
          if (err.message === 'NO_ACTIVE_DEVICE') {
            return NextResponse.json({ error: 'Плеер Spotify не активен!' }, { status: 404 });
          }
          throw err;
        }
      }

      case 'clear_queue': {
        const { error } = await supabase.from('song_requests').update({ status: 'rejected' }).eq('status', 'pending');
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // НОВАЯ ФУНКЦИЯ: Очистка истории
      case 'clear_history': {
        const { error } = await supabase
          .from('song_requests')
          .delete()
          .in('status', ['approved', 'rejected', 'played']);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'update_settings': {
        const { error } = await supabase.from('stream_settings').update(payload).eq('id', 1);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Неизвестная команда' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Ошибка выполнения' }, { status: 500 });
  }
}