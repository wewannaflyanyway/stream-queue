import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { getServiceSupabase } from '@/lib/supabase';
import { PollError, twitchMissing } from './server';

export const TWITCH_SCOPES = ['user:read:chat', 'user:bot', 'channel:bot'];
export function twitchConfig() {
  if (twitchMissing().length) throw new PollError('Сначала добавьте настройки приложения Twitch на сервер. Инструкция: docs/POLLS_SETUP.md.', 503);
  const url = new URL(process.env.APP_URL!);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new PollError('APP_URL должен быть адресом сайта с HTTPS без пути.', 503);
  return { clientId: process.env.TWITCH_CLIENT_ID!, clientSecret: process.env.TWITCH_CLIENT_SECRET!, origin: url.origin, redirect: `${url.origin}/api/twitch/oauth/callback` };
}
export function eventSecret() {
  return createHmac('sha256', twitchConfig().clientSecret).update('streamqueue-twitch-eventsub-v1').digest('hex');
}
let tokenCache: { token: string; expires: number } | null = null;
let tokenRequest: Promise<string> | null = null;
async function appToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const config = twitchConfig();
    const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'client_credentials' }), signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!res.ok) throw new PollError('Twitch отклонил ключи приложения. Проверьте Client ID и Client Secret.', 502);
    const data = await res.json();
    tokenCache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return tokenCache.token;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}
async function helix(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, { ...init, headers: { 'Client-Id': twitchConfig().clientId, Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (res.status === 401 && retry) { tokenCache = null; return helix(path, init, false); }
  return res;
}
interface Subscription { id: string; status: string; type: string; condition: { broadcaster_user_id?: string; user_id?: string }; transport: { callback?: string } }
async function subscriptions(): Promise<Subscription[]> {
  const result: Subscription[] = [];
  let cursor = '';
  do {
    const res = await helix(`eventsub/subscriptions?type=channel.chat.message${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
    if (!res.ok) throw new PollError('Не удалось проверить подписку Twitch. Попробуйте повторное подключение.', 502);
    const data = await res.json(); result.push(...data.data); cursor = data.pagination?.cursor ?? '';
  } while (cursor);
  return result;
}
async function updateConnection(values: Record<string, unknown>) {
  const { error } = await getServiceSupabase().from('stream_poll_twitch').update(values).eq('id', 1);
  if (error) throw new PollError('Не удалось сохранить подключение Twitch. Проверьте миграцию базы.', 503);
}
export async function connectTwitch(code: string) {
  const config = twitchConfig();
  const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code, redirect_uri: config.redirect }), signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) throw new PollError('Не удалось подтвердить вход в Twitch.', 502);
  const token = await res.json();
  if (TWITCH_SCOPES.some(scope => !token.scope?.includes(scope))) throw new PollError('Не предоставлены необходимые права Twitch. Подключите аккаунт повторно.');
  const userRes = await fetch('https://api.twitch.tv/helix/users', { headers: { 'Client-Id': config.clientId, Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!userRes.ok) throw new PollError('Не удалось определить канал Twitch.', 502);
  const user = (await userRes.json()).data[0];
  if (!user?.id) throw new PollError('Не найден канал Twitch.');
  // User tokens are deliberately not persisted. EventSub uses the app token and retained OAuth grants.
  const callback = `${config.origin}/api/twitch/eventsub`;
  const fingerprint = createHash('sha256').update(eventSecret()).digest('hex');
  const { data: saved, error: savedError } = await getServiceSupabase().from('stream_poll_twitch').select('secret_fingerprint').eq('id',1).single();
  if (savedError) throw new PollError('Сначала примените миграцию голосований.', 503);
  const previous = await subscriptions();
  const existing = previous.find(s => s.condition.broadcaster_user_id === user.id && s.condition.user_id === user.id && s.transport.callback === callback && ['enabled','webhook_callback_verification_pending'].includes(s.status));
  if (existing && saved.secret_fingerprint === fingerprint) {
    await updateConnection({ broadcaster_id: user.id, login: user.login, subscription_id: existing.id, status: existing.status, last_checked_at: new Date().toISOString(), last_event_at: null });
    return;
  }
  if (existing) {
    // Twitch retains the original transport secret. Rotation requires a new subscription.
    const removed = await helix(`eventsub/subscriptions?id=${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
    if (!removed.ok && removed.status !== 404) throw new PollError('Не удалось обновить ключ подписки Twitch. Повторите подключение.', 502);
  }
  await updateConnection({ broadcaster_id: user.id, login: user.login, subscription_id: null, secret_fingerprint: fingerprint, status: 'connecting', last_event_at: null });
  const created = await helix('eventsub/subscriptions', { method: 'POST', body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: user.id, user_id: user.id }, transport: { method: 'webhook', callback, secret: eventSecret() } }) });
  if (!created.ok) { await updateConnection({ status: 'error' }); throw new PollError('Twitch не создал подписку на чат. Проверьте права и доступность HTTPS сайта.', 502); }
  const sub: Subscription = (await created.json()).data[0];
  // A verification challenge can arrive before the create response. Do not overwrite an enabled status.
  const { data: stored } = await getServiceSupabase().from('stream_poll_twitch').select('status').eq('id',1).single();
  await updateConnection({ subscription_id: sub.id, status: stored?.status === 'enabled' ? 'enabled' : sub.status, last_checked_at: new Date().toISOString() });
  // Remove obsolete subscriptions owned by this integration only, after the new subscription exists.
  for (const old of previous.filter(s => s.transport.callback === callback && s.id !== sub.id)) await helix(`eventsub/subscriptions?id=${encodeURIComponent(old.id)}`, { method: 'DELETE' });
}
export async function checkTwitch() {
  const { data, error } = await getServiceSupabase().from('stream_poll_twitch').select('subscription_id').eq('id',1).single();
  if (error) throw new PollError('Сначала примените миграцию голосований.', 503);
  if (!data.subscription_id) throw new PollError('Сначала подключите Twitch.');
  const sub = (await subscriptions()).find(s => s.id === data.subscription_id);
  await updateConnection({ status: sub?.status ?? 'disconnected', last_checked_at: new Date().toISOString() });
  if (sub?.status !== 'enabled') throw new PollError('Подписка Twitch еще не активна или отозвана. Попробуйте подключить канал повторно.', 409);
}
