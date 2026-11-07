import { NextResponse } from 'next/server';
import { fetchWithTimeout, getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';
import { readStreamState } from '@/lib/stream/lifecycle';
import { associateQueue, type QueueRequest } from '@/lib/stream/queue';

const publicCache = { 'Cache-Control': 'public, max-age=0, s-maxage=2, stale-while-revalidate=2' };

export async function GET(request: Request) {
  void request.url;
  try {
    const token = await getStreamerAccessToken();
    const supabase = getServiceSupabase();

    const { data: settings } = await supabase
      .from('stream_settings')
      .select('widget_bg_color, widget_text_color, widget_accent_color, widget_opacity, widget_custom_image, widget_show_eq')
      .eq('id', 1)
      .single();

    const playerRes = await fetchWithTimeout('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (playerRes.status === 204) {
      return NextResponse.json({ isPlaying: false, settings }, { headers: publicCache });
    }
    if (!playerRes.ok) throw new Error(`Spotify player HTTP ${playerRes.status}`);

    const data = (await playerRes.json()) as {
      item?: {
        uri: string;
        name: string;
        artists?: Array<{ name: string }>;
      };
      is_playing?: boolean;
    };

    if (!data || !data.item) {
      return NextResponse.json({ isPlaying: false, settings }, { headers: publicCache });
    }

    const current = {
      name: data.item.name,
      artist: (data.item.artists || []).map((artist) => artist.name).join(', '),
      orderedBy: null as string | null,
    };

    const queueRes = await fetchWithTimeout('https://api.spotify.com/v1/me/player/queue', {
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

        next = {
          name: nextItem.name,
          artist: (nextItem.artists || []).map((artist) => artist.name).join(', '),
          orderedBy: null as string | null,
        };
      }

      // Spotify does not identify the original request. Never reuse an old
      // requester's name or guess when duplicate queue entries are present.
      try {
        const stream = await readStreamState();
        const sessionId = stream?.online ? stream.session_id : null;
        const offlineSince = !stream?.online ? stream?.manual_offline_since : null;
        if (sessionId || offlineSince) {
          const uris = [...new Set([data.item.uri, queueData.queue?.[0]?.uri].filter((uri): uri is string => Boolean(uri)))];
          let query = supabase.from('song_requests')
            .select('id,created_at,queued_at,stream_session_id,track_name,artist_name,sender_name,spotify_uri,status')
            .eq('status', 'approved').in('spotify_uri', uris).limit(1000);
          query = sessionId ? query.eq('stream_session_id', sessionId) : query.is('stream_session_id', null).gte('created_at', offlineSince!);
          const { data: requests, error } = await query;
          if (!error && requests) {
            const playerItem = { uri: data.item.uri, name: data.item.name, artist: current.artist };
            const queue = (queueData.queue ?? []).map(item => ({ uri: item.uri, name: item.name, artist: (item.artists || []).map(artist => artist.name).join(', ') }));
            const associated = associateQueue(playerItem, queue, requests as QueueRequest[]);
            current.orderedBy = associated.current?.request?.sender_name || null;
            if (next) next.orderedBy = associated.queue[0]?.request?.sender_name || null;
          }
        }
      } catch { /* Keep the widget working without displaying an unverified name. */ }
    }

    return NextResponse.json({
      isPlaying: !!data.is_playing,
      current,
      next,
      settings,
    }, { headers: publicCache });
  } catch (error) {
    console.error('Widget API Error:', error);
    return NextResponse.json({
      isPlaying: false,
      error: 'Spotify недоступен. Пауза/перезапуск виджета через пару секунд.',
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
