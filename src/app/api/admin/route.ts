import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { skipSpotifyTrack } from '@/lib/spotify';
import { enqueueRequest } from '@/lib/enqueue-request';
import { enableStreamAutomation, readStreamState, reconcileStreamState } from '@/lib/stream/lifecycle';
import { checkTwitch } from '@/lib/polls/twitch';
import { adminSessionCookie, createAdminSession, hasAdminSession, verifyAdmin } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pin, action, payload } = body;

    if (action === 'verify_pin') {
      if (!await verifyAdmin(req, pin)) return NextResponse.json({ error: 'Неверный PIN-код или слишком много попыток.' }, { status: 401 });
      const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
      response.cookies.set({ ...adminSessionCookie, value: createAdminSession() });
      return response;
    }
    if (!hasAdminSession(req)) {
      return NextResponse.json({ error: 'Неверный PIN-код доступа' }, { status: 401 });
    }

    const supabase = getServiceSupabase();

    switch (action) {
      case 'verify_session': {
        return NextResponse.json({ ok: true });
      }

      case 'read_data': {
        if (payload?.sessionId != null && (typeof payload.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.sessionId))) return NextResponse.json({ error: 'Некорректный стрим.' }, { status: 400 });
        const stream = await readStreamState();
        const sessionId = payload?.sessionId || (stream?.automation_enabled ? stream.session_id : null);
        const collect = async (mode: 'pending' | 'history') => {
          const rows: Record<string, unknown>[] = [];
          for (let offset = 0; ; offset += 1000) {
            let query = supabase.from('song_requests').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 999);
            if (mode === 'pending') query = query.eq('status', 'pending').eq('stream_pending_archived', false);
            else if (stream?.automation_enabled) {
              if (!sessionId) break;
              query = query.eq('stream_session_id', sessionId);
            } else query = query.in('status', ['approved', 'played', 'rejected']);
            const { data, error } = await query;
            if (error || !data) throw new Error('Не удалось загрузить заявки.');
            rows.push(...data);
            if (data.length < 1000) break;
          }
          return rows;
        };
        const [settingsResult, pending, history, claims] = await Promise.all([
          supabase.from('stream_settings').select('*').eq('id', 1).single(), collect('pending'), payload?.includeHistory === false ? Promise.resolve([]) : collect('history'),
          supabase.from('music_enqueue_claims').select('request_id,state,claimed_at'),
        ]);
        if (settingsResult.error || !settingsResult.data) throw new Error('Не удалось загрузить настройки.');
        if (claims.error) throw new Error('Не удалось проверить состояние отправки в Spotify.');
        const byId = new Map([...pending, ...history].map(item => [item.id, item]));
        const claimMap = new Map((claims.data || []).map(item => [item.request_id, item]));
        return NextResponse.json({ settings: settingsResult.data, requests: [...byId.values()].map(item => {
          const claim = claimMap.get(item.id);
          return { ...item, enqueue_claim: claim ? { ...claim, reviewable: claim.state === 'uncertain' || Date.now() - Date.parse(claim.claimed_at) >= 30000 } : null };
        }) }, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'approve': {
        const id = payload?.id;
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Некорректная заявка.' }, { status: 400 });
        const result = await enqueueRequest(supabase, id);
        if (result === 'not_available') return NextResponse.json({ error: 'Плеер Spotify сейчас не активен. Включи трек и попробуй ещё раз.' }, { status: 404 });
        if (result === 'uncertain') return NextResponse.json({ error: 'Ответ Spotify потерялся. Проверь очередь плеера и отметь результат в заявке.' }, { status: 409 });
        if (result === 'already_claimed') return NextResponse.json({ error: 'Заявка уже обработана или отправляется в Spotify.' }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case 'resolve_enqueue': {
        const { id, outcome } = payload || {};
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || !['queued', 'retry', 'reject'].includes(outcome)) return NextResponse.json({ error: 'Некорректный результат проверки.' }, { status: 400 });
        const { data, error } = await supabase.rpc('music_reconcile_claim', { p_id: id, p_outcome: outcome });
        if (error) throw error;
        if (!data) return NextResponse.json({ error: 'Заявка уже обработана.' }, { status: 409 });
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
        const { data: chat } = await supabase.from('stream_poll_twitch').select('music_commands_enabled,chat_write_granted,status').eq('id', 1).single();
        return NextResponse.json({ stream: state && {
          online: state.online, automationEnabled: state.automation_enabled, sessionId: state.session_id,
          connectionHealthy: Boolean(state.online_subscription_id && state.offline_subscription_id), verified,
          musicCommandsEnabled: chat?.music_commands_enabled === true, chatWriteGranted: chat?.chat_write_granted === true,
        } });
      }

      case 'chat_commands': {
        if (typeof payload?.enabled !== 'boolean') return NextResponse.json({ error: 'Некорректное состояние команд.' }, { status: 400 });
        if (payload.enabled) {
          const { data, error } = await supabase.from('stream_poll_twitch').select('chat_write_granted,status').eq('id', 1).single();
          if (error || !data?.chat_write_granted) return NextResponse.json({ error: 'Переподключите Twitch во вкладке «Голосования» и разрешите отправку сообщений.' }, { status: 409 });
          await checkTwitch();
        }
        const { error } = await supabase.from('stream_poll_twitch').update({ music_commands_enabled: payload.enabled }).eq('id', 1);
        if (error) throw error;
        return NextResponse.json({ ok: true });
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
