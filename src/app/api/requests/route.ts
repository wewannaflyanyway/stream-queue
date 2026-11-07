import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { getSpotifyTrack } from '@/lib/spotify';
import { enqueueRequest } from '@/lib/enqueue-request';
import { reconcileStreamState } from '@/lib/stream/lifecycle';
import { RequestPolicyError, validateRequestLimits, validateTrackPolicy, type RequestSettings } from '@/lib/request-policy';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body?.spotify_uri !== 'string' || !/^spotify:track:[a-z0-9]{22}$/i.test(body.spotify_uri)) return NextResponse.json({ error: 'Укажите трек Spotify.' }, { status: 400 });
    const sender = typeof body.sender_name === 'string' ? body.sender_name.trim().slice(0, 24) || 'Аноним' : 'Аноним';
    const supabase = getServiceSupabase();
    await reconcileStreamState();
    const { data, error } = await supabase.from('stream_settings').select('*').eq('id', 1).single();
    if (error || !data) return NextResponse.json({ error: 'Ошибка чтения настроек стрима.' }, { status: 503 });
    const settings = data as RequestSettings;
    if (!settings.is_accepting) throw new RequestPolicyError('Прием музыки сейчас закрыт стримером.', 403);
    let track;
    try { track = await getSpotifyTrack(body.spotify_uri); }
    catch { return NextResponse.json({ error: 'Не удалось проверить трек в Spotify. Попробуйте позже.' }, { status: 503 }); }
    validateTrackPolicy(track, settings);
    await validateRequestLimits(supabase, track, settings, sender);
    const { data: inserted, error: insertError } = await supabase.from('song_requests').insert({
      track_name: track.name, artist_name: track.artist, album_cover_url: '', spotify_uri: track.uri,
      duration_ms: track.durationMs, is_explicit: track.isExplicit, sender_name: sender, source: 'web', status: 'pending',
    }).select().single();
    if (insertError) {
      if (insertError.message.includes('Прием заявок закрыт')) throw new RequestPolicyError('Прием музыки сейчас закрыт стримером.', 403);
      return NextResponse.json({ error: 'Ошибка сохранения заявки в БД.' }, { status: 500 });
    }
    if (settings.auto_approve && !(track.isExplicit && settings.explicit_mode === 'manual')) {
      const { data: latestSettings } = await supabase.from('stream_settings').select('is_accepting').eq('id', 1).single();
      if (latestSettings?.is_accepting) {
        let result;
        try { result = await enqueueRequest(supabase, inserted.id); }
        catch { return NextResponse.json({ request: inserted, status: 'pending', warning: 'Не удалось подтвердить отправку в Spotify. Сообщи стримеру и не заказывай повторно.' }); }
        if (result === 'queued') return NextResponse.json({ request: inserted, status: 'approved' });
        if (result === 'uncertain' || result === 'already_claimed') return NextResponse.json({ request: inserted, status: 'pending', warning: 'Не удалось подтвердить отправку в Spotify. Сообщи стримеру и не заказывай повторно.' });
      }
    }
    return NextResponse.json({ request: inserted, status: 'pending' });
  } catch (error: unknown) {
    if (error instanceof RequestPolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Не удалось обработать заявку. Попробуйте позже.' }, { status: 500 });
  }
}
