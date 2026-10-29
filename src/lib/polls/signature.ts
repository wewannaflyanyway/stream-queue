import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyTwitchSignature(raw: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get('twitch-eventsub-message-id');
  const timestamp = headers.get('twitch-eventsub-message-timestamp');
  const signature = headers.get('twitch-eventsub-message-signature');
  if (!id || !timestamp || !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const sent = Date.parse(timestamp);
  if (!Number.isFinite(sent) || Math.abs(now - sent) > 600_000) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(id + timestamp + raw).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
