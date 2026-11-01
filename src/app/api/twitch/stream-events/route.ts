import { getServiceSupabase } from '@/lib/supabase';
import { eventSecret } from '@/lib/polls/twitch';
import { verifyTwitchSignature } from '@/lib/polls/signature';

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 65536) return new Response(null, { status: 413 });
    if (!verifyTwitchSignature(raw, request.headers, eventSecret())) return new Response(null, { status: 403 });
    let body;
    try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
    const sub = body?.subscription;
    if (!['stream.online', 'stream.offline'].includes(sub?.type) || sub.version !== '1') return new Response(null, { status: 403 });
    const db = getServiceSupabase();
    const { data: connection, error } = await db.from('stream_poll_twitch').select('broadcaster_id').eq('id', 1).single();
    if (error || !connection?.broadcaster_id) return new Response(null, { status: 503 });
    if (sub.condition?.broadcaster_user_id !== connection.broadcaster_id) return new Response(null, { status: 403 });
    const column = sub.type === 'stream.online' ? 'online_subscription_id' : 'offline_subscription_id';
    const { data: state, error: stateError } = await db.from('music_stream_state').select('*').eq('id', 1).single();
    if (stateError) return new Response(null, { status: 503 });
    const kind = request.headers.get('twitch-eventsub-message-type');
    if (kind === 'webhook_callback_verification') {
      if (typeof body.challenge !== 'string') return new Response(null, { status: 400 });
      const { error: saveError } = await db.from('music_stream_state').update({ [column]: sub.id }).eq('id', 1);
      return saveError ? new Response(null, { status: 503 }) : new Response(body.challenge, { headers: { 'Content-Type': 'text/plain' } });
    }
    if (state[column] !== sub.id) return new Response(null, { status: 204 });
    if (kind === 'revocation') {
      const { error: revokeError } = await db.rpc('music_stream_revoke', { p_type: sub.type, p_subscription: sub.id, p_event_at: request.headers.get('twitch-eventsub-message-timestamp') });
      return new Response(null, { status: revokeError ? 503 : 204 });
    }
    if (kind !== 'notification' || body.event?.broadcaster_user_id !== connection.broadcaster_id) return new Response(null, { status: 400 });
    const online = sub.type === 'stream.online';
    if (online && (typeof body.event.id !== 'string' || typeof body.event.started_at !== 'string')) return new Response(null, { status: 400 });
    const { error: eventError } = await db.rpc('music_stream_event', {
      p_type: online ? 'online' : 'offline', p_event_at: request.headers.get('twitch-eventsub-message-timestamp'),
      p_stream_id: online ? body.event.id : null, p_started_at: online ? body.event.started_at : null,
    });
    return new Response(null, { status: eventError ? 503 : 204 });
  } catch { return new Response(null, { status: 503 }); }
}
