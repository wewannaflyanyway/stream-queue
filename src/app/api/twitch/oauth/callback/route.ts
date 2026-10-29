import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { connectTwitch, twitchConfig } from '@/lib/polls/twitch';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get('poll_twitch_state')?.value;
  jar.set('poll_twitch_state', '', { path: '/api/twitch/oauth/callback', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 0 });
  const state = url.searchParams.get('state') ?? '';
  let outcome = 'error';
  try {
    if (!saved || saved.length !== state.length || !timingSafeEqual(Buffer.from(saved),Buffer.from(state))) throw new Error('state');
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) throw new Error('denied');
    await connectTwitch(code);
    outcome = 'connected';
  } catch { /* Never place OAuth tokens or provider response details in the URL. */ }
  let origin: string;
  try { origin = twitchConfig().origin; } catch { return Response.json({ error: 'Twitch не настроен.' }, { status: 503 }); }
  return Response.redirect(`${origin}/admin?polls=${outcome}`, 303);
}
