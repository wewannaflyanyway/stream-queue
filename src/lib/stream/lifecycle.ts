import { createHash } from 'node:crypto';
import { getServiceSupabase } from '@/lib/supabase';
import { eventSecret, helix, twitchConfig } from '@/lib/polls/twitch';

export interface StreamState {
  automation_enabled: boolean;
  manual_paused: boolean;
  online: boolean;
  session_id: string | null;
  offline_at: string | null;
  last_event_at: string | null;
  last_checked_at: string | null;
  current_twitch_stream_id: string | null;
  online_subscription_id: string | null;
  offline_subscription_id: string | null;
  secret_fingerprint: string | null;
}

export async function readStreamState(): Promise<StreamState | null> {
  const { data, error } = await getServiceSupabase().from('music_stream_state').select('*').eq('id', 1).single();
  if (error?.code === 'PGRST205' || error?.code === '42P01') return null;
  if (error) throw new Error('Не удалось прочитать состояние стрима.');
  return data as StreamState;
}

/** EventSub is primary; an occasional Helix read repairs missed events before accepting requests. */
export async function reconcileStreamState(requireHealthy = true): Promise<StreamState | null> {
  const state = await readStreamState();
  if (!state?.automation_enabled) return state;
  if (!state.online_subscription_id || !state.offline_subscription_id) {
    if (requireHealthy) throw new Error('Подключение Twitch нужно восстановить в админке.');
    return state;
  }
  if (state.last_checked_at && Date.now() - Date.parse(state.last_checked_at) < 30000) return state;
  if (state.last_event_at && Date.now() - Date.parse(state.last_event_at) < 30000) return state;
  const db = getServiceSupabase();
  const { data: connection, error } = await db.from('stream_poll_twitch').select('broadcaster_id').eq('id', 1).single();
  if (error || !connection?.broadcaster_id) throw new Error('Не удалось проверить состояние Twitch.');
  // A signed notification arriving while Helix is in flight must win over this snapshot.
  const now = new Date().toISOString();
  const response = await helix(`streams?user_id=${encodeURIComponent(connection.broadcaster_id)}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Не удалось проверить состояние Twitch.');
  const data = await response.json() as { data: { id: string; started_at: string }[] };
  const live = data.data[0];
  if ((live && (!state.online || state.current_twitch_stream_id !== live.id)) || (!live && state.online)) {
    const { error: syncError } = await db.rpc('music_stream_event', {
      p_type: live ? 'online' : 'offline', p_event_at: now, p_stream_id: live?.id ?? null, p_started_at: live?.started_at ?? null,
    });
    if (syncError) throw new Error('Не удалось обновить состояние стрима.');
  }
  const { error: checkError } = await db.from('music_stream_state').update({ last_checked_at: now }).eq('id', 1);
  if (checkError) throw new Error('Не удалось сохранить состояние Twitch.');
  return await readStreamState();
}

export async function enableStreamAutomation(): Promise<void> {
  const db = getServiceSupabase();
  const { data: connection, error } = await db.from('stream_poll_twitch').select('broadcaster_id').eq('id', 1).single();
  if (error || !connection?.broadcaster_id) throw new Error('Сначала подключите канал Twitch во вкладке «Голосования».');
  const previousState = await readStreamState();
  if (!previousState) throw new Error('Сначала примените миграцию стримов в Supabase.');
  const callback = `${twitchConfig().origin}/api/twitch/stream-events`;
  const fingerprint = createHash('sha256').update(eventSecret()).digest('hex');
  const subscriptionIds: string[] = [];
  for (const type of ['stream.online', 'stream.offline'] as const) {
    type Sub = { id: string; status: string; condition: { broadcaster_user_id: string }; transport: { callback?: string } };
    const all: Sub[] = [];
    let cursor = '';
    do {
      const list = await helix(`eventsub/subscriptions?type=${encodeURIComponent(type)}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
      if (!list.ok) throw new Error('Не удалось проверить подписку Twitch.');
      const body = await list.json() as { data: Sub[]; pagination?: { cursor?: string } };
      all.push(...body.data); cursor = body.pagination?.cursor ?? '';
    } while (cursor);
    let sub = all.find(item => item.condition.broadcaster_user_id === connection.broadcaster_id && item.transport.callback === callback && ['enabled', 'webhook_callback_verification_pending'].includes(item.status));
    if (sub && previousState.secret_fingerprint !== fingerprint) {
      const removed = await helix(`eventsub/subscriptions?id=${encodeURIComponent(sub.id)}`, { method: 'DELETE' });
      if (!removed.ok && removed.status !== 404) throw new Error('Не удалось обновить ключ подписки Twitch.');
      sub = undefined;
    }
    if (!sub) {
      const created = await helix('eventsub/subscriptions', { method: 'POST', body: JSON.stringify({ type, version: '1', condition: { broadcaster_user_id: connection.broadcaster_id }, transport: { method: 'webhook', callback, secret: eventSecret() } }) });
      if (!created.ok) throw new Error('Не удалось создать подписку Twitch на состояние стрима.');
      sub = (await created.json()).data[0];
    }
    if (!sub) throw new Error('Twitch не вернул подписку.');
    subscriptionIds.push(sub.id);
    const column = type === 'stream.online' ? 'online_subscription_id' : 'offline_subscription_id';
    const { error: saveError } = await db.from('music_stream_state').update({ [column]: sub.id }).eq('id', 1);
    if (saveError) throw new Error('Не удалось сохранить подписку Twitch.');
  }
  const { error: fingerprintError } = await db.from('music_stream_state').update({ secret_fingerprint: fingerprint }).eq('id', 1);
  if (fingerprintError) throw new Error('Не удалось сохранить ключ подписки Twitch.');
  for (const id of subscriptionIds) {
    let enabled = false;
    for (let attempt = 0; attempt < 3 && !enabled; attempt++) {
      const response = await helix(`eventsub/subscriptions?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('Не удалось проверить подтверждение подписки Twitch.');
      const data = await response.json() as { data: { status: string }[] };
      enabled = data.data[0]?.status === 'enabled';
      if (!enabled && attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!enabled) throw new Error('Twitch еще не подтвердил подписку. Проверьте доступность сайта и повторите подключение.');
  }
  const stream = await helix(`streams?user_id=${encodeURIComponent(connection.broadcaster_id)}`);
  if (!stream.ok) throw new Error('Не удалось проверить состояние стрима на Twitch.');
  const streamData = await stream.json() as { data: { id: string; started_at: string }[] };
  const item = streamData.data[0];
  const { error: eventError } = await db.rpc('music_stream_event', {
    p_type: item ? 'online' : 'offline', p_event_at: new Date().toISOString(),
    p_stream_id: item?.id ?? null, p_started_at: item?.started_at ?? null,
  });
  if (eventError) throw new Error('Не удалось сохранить состояние стрима.');
  const { error: enableError } = await db.rpc('music_stream_automation', { p_enabled: true });
  if (enableError) throw new Error('Не удалось включить автоматическое управление.');
}
