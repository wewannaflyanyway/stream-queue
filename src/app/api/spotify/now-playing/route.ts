import { NextRequest, NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const token = await getStreamerAccessToken();
    
    // 1. Получаем статус плеера
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

    const trackUri = data.item.uri;
    let orderedBy: string | null = null;

    // 2. Ищем, кто заказал этот трек, в базе данных Supabase
    try {
      const supabase = getServiceSupabase();
      // Ищем самую свежую одобренную или сыгранную заявку с этим URI
      const { data: requestData } = await supabase
        .from('song_requests')
        .select('sender_name')
        .eq('spotify_uri', trackUri)
        .in('status', ['approved', 'played', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (requestData && requestData.length > 0) {
        orderedBy = requestData[0].sender_name;
      }
    } catch (dbError) {
      console.error('Ошибка поиска заказчика в БД:', dbError);
      // Если БД недоступна, не ломаем виджет, просто не показываем ник
    }

    const currentTrack = {
      name: data.item.name,
      artist: data.item.artists.map((a: any) => a.name).join(', '),
      cover: data.item.album?.images?.[0]?.url || '',
      orderedBy: orderedBy, // Передаем ник на фронтенд
    };

    // 3. Пытаемся получить следующий трек
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
      // Игнорируем ошибку очереди
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