import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { addTrackToSpotifyQueue, skipSpotifyTrack } from '@/lib/spotify';
import { enableStreamAutomation, readStreamState, reconcileStreamState } from '@/lib/stream/lifecycle';

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
          const dbRes = await supabase.from('song_requests').update({ status: 'approved', queued_at: new Date().toISOString() }).eq('id', id);
          if (dbRes.error) return NextResponse.json({ error: 'Трек добавлен в Spotify, но статус заявки не сохранился. Проверь очередь плеера перед повторным добавлением.' }, { status: 500 });
          return NextResponse.json({ ok: true });
        } catch (err: unknown) {
          if (err instanceof Error && err.message === 'NO_ACTIVE_DEVICE') {
            return NextResponse.json(
              { error: 'Плеер Spotify сейчас не активен! Включи любой трек на ПК и нажми «Одобрить» ещё раз.' },
              { status: 404 }
            );
          }
          throw err;
        }
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
        } catch (err: unknown) {
          if (err instanceof Error && err.message === 'NO_ACTIVE_DEVICE') {
            return NextResponse.json({ error: 'Плеер Spotify не активен!' }, { status: 404 });
          }
          throw err;
        }
      }

      case 'clear_queue': {
        const { error } = await supabase.from('song_requests').update({ status: 'rejected' }).eq('status', 'pending').eq('stream_pending_archived', false);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // НОВАЯ ФУНКЦИЯ: Очистка истории
      case 'clear_history': {
        const stream = await readStreamState();
        if (stream?.automation_enabled) {
          if (!stream.session_id) return NextResponse.json({ error: 'Нет активной истории стрима.' }, { status: 400 });
          const { error } = await supabase.from('song_requests').update({ stream_history_hidden: true }).in('status', ['approved', 'rejected', 'played']).eq('stream_session_id', stream.session_id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('song_requests').delete().in('status', ['approved', 'rejected', 'played']);
          if (error) throw error;
        }
        return NextResponse.json({ ok: true });
      }

      case 'stream_enable': {
        await enableStreamAutomation();
        return NextResponse.json({ ok: true });
      }

      case 'stream_disable': {
        const { error } = await supabase.rpc('music_stream_automation', { p_enabled: false });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'stream_sessions': {
        const { data, error } = await supabase.from('music_stream_sessions').select('id,started_at,ended_at').order('started_at', { ascending: false }).limit(100);
        if (error) throw error;
        return NextResponse.json({ sessions: data });
      }

      case 'stream_status': {
        let state = await readStreamState();
        let verified = true;
        try { state = await reconcileStreamState(false); } catch { verified = false; }
        return NextResponse.json({ stream: state && {
          online: state.online, automationEnabled: state.automation_enabled, sessionId: state.session_id,
          connectionHealthy: Boolean(state.online_subscription_id && state.offline_subscription_id), verified,
        } });
      }

      case 'set_accepting': {
        if (typeof payload?.is_accepting !== 'boolean') return NextResponse.json({ error: 'Некорректное состояние приема заявок.' }, { status: 400 });
        const stream = await readStreamState();
        if (stream?.automation_enabled) {
          const { error } = await supabase.rpc('music_stream_manual', { p_accepting: payload.is_accepting });
          if (error) throw error;
        } else {
          const { error } = await supabase.from('stream_settings').update({ is_accepting: payload.is_accepting }).eq('id', 1);
          if (error) throw error;
        }
        const { data, error } = await supabase.from('stream_settings').select('is_accepting').eq('id', 1).single();
        if (error || !data) throw error || new Error('Не удалось прочитать состояние приема.');
        return NextResponse.json({ ok: true, is_accepting: data.is_accepting });
      }

      case 'update_settings': {
        const updates = { ...payload };
        const stream = await readStreamState();
        // Only the explicit on/off control changes manual pause, not a stale settings form.
        if (stream?.automation_enabled) delete updates.is_accepting;
        if (Object.keys(updates).length) {
          const { error } = await supabase.from('stream_settings').update(updates).eq('id', 1);
          if (error) throw error;
        }
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Неизвестная команда' }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Ошибка выполнения';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
