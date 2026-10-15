import { NextRequest, NextResponse } from 'next/server';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/setup';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  // Если кода еще нет — перенаправляем в Spotify для входа
  if (!code) {
    const scopes = 'user-modify-playback-state user-read-playback-state';
    const authUrl =
      `https://accounts.spotify.com/authorize?response_type=code` +
      `&client_id=${CLIENT_ID}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

    return NextResponse.redirect(authUrl);
  }

  // Если Spotify вернул код — меняем его на вечный refresh_token
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json({ error: 'Ошибка авторизации', details: data }, { status: 400 });
  }

  return new NextResponse(
    `<html>
      <body style="background:#121212;color:#fff;font-family:sans-serif;padding:40px;line-height:1.6;">
        <h2 style="color:#1DB954;">✅ Токен успешно получен!</h2>
        <p>Скопируй эту строчку и вставь в свой файл <b>.env.local</b>:</p>
        <pre style="background:#1e1e1e;padding:20px;border-radius:12px;border:1px solid #333;overflow-x:auto;color:#1DB954;font-weight:bold;">SPOTIFY_REFRESH_TOKEN=${data.refresh_token}</pre>
        <p style="color:#a7a7a7;">После сохранения .env.local перезапусти сервер в терминале (Ctrl+C и снова npm run dev).</p>
      </body>
    </html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}