import { NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const token = await getStreamerAccessToken();
    const supabase = getServiceSupabase();

    const { data: settings } = await supabase
      .from('stream_settings')
      .select('widget_bg_color, widget_text_color, widget_accent_color, widget_opacity, widget_custom_image, widget_show_eq')
      .eq('id', 1)
      .single();

    const playerRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!playerRes.ok || playerRes.status === 204) {
      return NextResponse.json({ isPlaying: false, settings });
    }

    const data = (await playerRes.json()) as {
      item?: {
        uri: string;
        name: string;
        artists?: Array<{ name: string }>;
        album?: { images?: Array<{ url?: string }> };
      };
      is_playing?: boolean;
    };

    if (!data || !data.item) {
      return NextResponse.json({ isPlaying: false, settings });
    }

    const { data: currentDbData } = await supabase
      .from('song_requests')
      .select('sender_name')
      .eq('spotify_uri', data.item.uri)
      .in('status', ['approved', 'played'])
      .limit(1);

    const current = {
      name: data.item.name,
      artist: (data.item.artists || []).map((artist) => artist.name).join(', '),
      cover: data.item.album?.images?.[0]?.url || null,
      orderedBy: currentDbData?.[0]?.sender_name || null,
    };

    const queueRes = await fetch('https://api.spotify.com/v1/me/player/queue', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    let next = null;
    if (queueRes.ok) {
      const queueData = (await queueRes.json()) as {
        queue?: Array<{
          uri: string;
          name: string;
          artists?: Array<{ name: string }>;
        }>;
      };

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
          artist: (nextItem.artists || []).map((artist) => artist.name).join(', '),
          orderedBy: nextDbData?.[0]?.sender_name || null,
        };
      }
    }

    return NextResponse.json({
      isPlaying: !!data.is_playing,
      current,
      next,
      settings,
    });
  } catch (error) {
    console.error('Widget API Error:', error);
    return NextResponse.json({
      isPlaying: false,
      error: 'Spotify недоступен. Пауза/перезапуск виджета через пару секунд.',
    }, { status: 200 });
  }
}
