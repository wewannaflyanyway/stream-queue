import { NextRequest, NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';

export async function GET(req: NextRequest) {
  try {
    const token = await getStreamerAccessToken();
    
    // 1. Получаем статус плеера (работает стабильнее всего)
    const playerRes = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (playerRes.status === 204 || playerRes.status === 404) {
      return NextResponse.json({ isPlaying: false }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (!playerRes.ok) {
      throw new Error(`Ошибка Spotify API (${playerRes.status})`);
    }

    const data = await playerRes.json();

    if (!data || !data.is_playing || !data.item) {
      return NextResponse.json({ isPlaying: false }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const currentTrack = {
      name: data.item.name,
      artist: data.item.artists.map((a: any) => a.name).join(', '),
      cover: data.item.album?.images?.[0]?.url || '',
    };

    // 2. Пытаемся получить следующий трек
    let nextTrack = null;
    try {
      const queueRes = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (queueRes.ok) {
        const queueData = await queueRes.json();
        const nextItem = queueData.queue?.[0];
        if (nextItem) {
          nextTrack = {
            name: nextItem.name,
            artist: nextItem.artists.map((a: any) => a.name).join(', '),
          };
        }
      }
    } catch (e) {
      // Игнорируем ошибку очереди, главное что текущий трек есть
    }

    return NextResponse.json(
      { isPlaying: true, current: currentTrack, next: nextTrack },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Ошибка API' }, 
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}