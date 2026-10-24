import { NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const token = await getStreamerAccessToken();
    const supabase = getServiceSupabase();

    // 1. Получаем настройки виджета
    const { data: settings } = await supabase
      .from('stream_settings')
      .select('widget_bg_color, widget_text_color, widget_accent_color, widget_opacity, widget_custom_image, widget_show_eq')
      .eq('id', 1)
      .single();

    // 2. Получаем текущий трек
    const playerRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!playerRes.ok || playerRes.status === 204) {
      return NextResponse.json({ isPlaying: false, settings });
    }

    const data = await playerRes.json();
    if (!data || !data.item) {
      return NextResponse.json({ isPlaying: false, settings });
    }

    // Улучшенный поиск никнейма для играющего трека (без ограничений по времени)
    const { data: currentDbData } = await supabase
      .from('song_requests')
      .select('sender_name')
      .eq('spotify_uri', data.item.uri)
      .in('status', ['approved', 'played'])
      .limit(1);

    const current = {
      name: data.item.name,
      artist: data.item.artists.map((a: any) => a.name).join(', '),
      cover: data.item.album?.images?.[0]?.url || null,
      orderedBy: currentDbData?.[0]?.sender_name || null,
    };

    // 3. Получаем следующий трек напрямую из очереди Spotify
    const queueRes = await fetch('https://api.spotify.com/v1/me/player/queue', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    let next = null;
    if (queueRes.ok) {
      const queueData = await queueRes.json();
      if (queueData.queue && queueData.queue.length > 0) {
        const nextItem = queueData.queue[0];
        
        const { data: nextDbData } = await supabase
          .from('song_requests')
          .select('sender_name')
          .eq('spotify_uri', nextItem.uri)
          .in('status', ['approved', 'pending'])
          .limit(1);

        next = {
          name: nextItem.name,
          artist: nextItem.artists.map((a: any) => a.name).join(', '),
          orderedBy: nextDbData?.[0]?.sender_name || null,
        };
      }
    }

    return NextResponse.json({
      isPlaying: data.is_playing,
      current,
      next,
      settings,
    });

  } catch (error) {
    console.error('Widget API Error:', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}