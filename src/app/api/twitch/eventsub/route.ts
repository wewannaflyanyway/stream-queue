import { getServiceSupabase } from '@/lib/supabase';
import { eventSecret } from '@/lib/polls/twitch';
import { verifyTwitchSignature } from '@/lib/polls/signature';
import { pollResponseError, pollRpc } from '@/lib/polls/server';

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return new Response(null, { status: 413 });
    if (!verifyTwitchSignature(raw, request.headers, eventSecret())) return new Response(null, { status: 403 });
    let body;
    try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
    const sub = body?.subscription;
    if (sub?.type !== 'channel.chat.message' || sub.version !== '1' || sub.condition?.user_id !== sub.condition?.broadcaster_user_id) return new Response(null, { status: 403 });
    const db = getServiceSupabase();
    const { data: connection, error } = await db.from('stream_poll_twitch').select('*').eq('id',1).single();
    if (error) return new Response(null, { status: 503 });
    if (connection.broadcaster_id !== sub.condition.broadcaster_user_id) return new Response(null, { status: 403 });
    const kind = request.headers.get('twitch-eventsub-message-type');
    if (kind === 'webhook_callback_verification') {
      if ((connection.subscription_id && connection.subscription_id !== sub.id) || !['connecting','webhook_callback_verification_pending','enabled'].includes(connection.status) || typeof body.challenge !== 'string') return new Response(null, { status: 403 });
      const { error: updateError } = await db.from('stream_poll_twitch').update({ subscription_id: sub.id, status: 'enabled', last_checked_at: new Date().toISOString() }).eq('id',1).eq('broadcaster_id',connection.broadcaster_id);
      if (updateError) return new Response(null, { status: 503 });
      return new Response(body.challenge, { headers: { 'Content-Type': 'text/plain' } });
    }
    if (connection.subscription_id !== sub.id) return new Response(null, { status: 204 });
    if (kind === 'revocation') {
      const { error: updateError } = await db.from('stream_poll_twitch').update({ status: 'revoked', last_checked_at: new Date().toISOString() }).eq('id',1).eq('subscription_id',sub.id);
      return new Response(null, { status: updateError ? 503 : 204 });
    }
    if (kind === 'notification') {
      const event = body.event;
      if (event?.broadcaster_user_id !== connection.broadcaster_id || typeof event.message?.text !== 'string' || typeof event.chatter_user_id !== 'string' || typeof event.message_id !== 'string') return new Response(null, { status: 400 });
      await pollRpc('stream_poll_vote', { p_subscription: sub.id, p_broadcaster: event.broadcaster_user_id, p_user: event.chatter_user_id, p_message: event.message_id, p_text: event.message.text, p_time: request.headers.get('twitch-eventsub-message-timestamp') });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 400 });
  } catch (error) { return pollResponseError(error); }
}
