import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { PollError, pollResponseError, pollRpc, readPollState } from '@/lib/polls/server';
import { hasAdminSession } from '@/lib/admin-auth';
import { validateDraft, validateStyle } from '@/lib/polls/model';
import { checkTwitch, twitchConfig, TWITCH_SCOPES } from '@/lib/polls/twitch';

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 16_384) throw new PollError('Запрос слишком большой.', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new PollError('Некорректный JSON.'); }
    if (!body || !hasAdminSession(request)) throw new PollError('Сессия админки истекла. Войдите снова.', 401);
    const { action, payload } = body;
    if (action === 'connect') {
      const config = twitchConfig();
      if (new URL(request.url).origin !== config.origin) throw new PollError(`Для подключения Twitch откройте админку по адресу ${config.origin}/admin.`);
      const state = randomBytes(32).toString('hex');
      (await cookies()).set('poll_twitch_state', state, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 600, path: '/api/twitch/oauth/callback' });
      const url = new URL('https://id.twitch.tv/oauth2/authorize');
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect, response_type: 'code', scope: TWITCH_SCOPES.join(' '), state, force_verify: 'true' }).toString();
      return Response.json({ url: url.toString() }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'check') await checkTwitch();
    else if (action === 'save' || action === 'start') {
      let draft;
      try { draft = validateDraft(payload); } catch (e) { throw new PollError((e as Error).message); }
      if (action === 'start') await checkTwitch();
      await pollRpc('stream_poll_action', { p_action: action, p_payload: draft });
    } else if (action === 'style') {
      let style;
      try { style = validateStyle(payload); } catch (e) { throw new PollError((e as Error).message); }
      await pollRpc('stream_poll_action', { p_action: action, p_payload: style });
    } else if (['finish', 'extend', 'delete'].includes(action)) {
      if (!payload || typeof payload.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.id)) throw new PollError('Некорректный ID.');
      await pollRpc('stream_poll_action', { p_action: action, p_payload: { id: payload.id } });
    } else if (action === 'visibility') {
      if (typeof payload?.visible !== 'boolean') throw new PollError('Некорректная видимость.');
      await pollRpc('stream_poll_action', { p_action: action, p_payload: payload });
    } else if (action !== 'state' && action !== 'check') throw new PollError('Неизвестное действие.');
    return Response.json(await readPollState(true), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return pollResponseError(error); }
}
