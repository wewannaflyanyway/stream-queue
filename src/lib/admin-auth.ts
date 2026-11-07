import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getServiceSupabase } from '@/lib/supabase';

export async function verifyAdmin(request: Request, pin: unknown): Promise<boolean> {
  const expected = process.env.ADMIN_PIN;
  if (!expected || typeof pin !== 'string' || pin.length > 256) return false;
  const a = Buffer.from(pin); const b = Buffer.from(expected);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  const address = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const key = createHmac('sha256', expected).update(address.slice(0, 128)).digest('hex');
  const { data, error } = await getServiceSupabase().rpc('admin_auth_gate', { p_client: key, p_success: valid });
  if (error) throw new Error('Не удалось проверить доступ к админке.');
  return data === true && valid;
}

const COOKIE_NAME = 'streamqueue_admin';
const SESSION_SECONDS = 8 * 60 * 60;

function sessionKey(): string | null {
  const key = process.env.ADMIN_SESSION_SECRET || process.env.TWITCH_CLIENT_SECRET;
  const pin = process.env.ADMIN_PIN;
  if (!key || !pin) return null;
  return createHmac('sha256', key).update('streamqueue-admin-session-v1\0').update(pin).digest('hex');
}

export function createAdminSession(now = Date.now()): string {
  const key = sessionKey();
  if (!key) throw new Error('Не настроен ключ сессии админки.');
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString('hex')}`;
  return `${payload}.${createHmac('sha256', key).update(payload).digest('hex')}`;
}

export function hasAdminSession(request: Request, now = Date.now()): boolean {
  const key = sessionKey();
  if (!key) return false;
  const cookie = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) || '';
  const parts = cookie.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[a-f0-9]{48}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const expiry = Number(parts[0]);
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(now / 1000) || expiry > Math.floor(now / 1000) + SESSION_SECONDS) return false;
  const signature = createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest();
  return timingSafeEqual(signature, Buffer.from(parts[2], 'hex'));
}

export const adminSessionCookie = { name: COOKIE_NAME, httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_SECONDS };
