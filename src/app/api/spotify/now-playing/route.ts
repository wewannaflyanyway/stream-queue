import { NextRequest, NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const token = await getStreamerAccessToken();
    const supabase = getServiceSupabase();

    // Забираем настройки цветов из БД
    const { data: settings } = await supabase
      .from('stream_settings')
      .select('widget_bg_color, widget_text_color, widget_accent_color, widget_opacity')
      .eq('id', 1)
      .single();

    const playerRes = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (playerRes.status === 204 || playerRes.status === 404) {
      return NextResponse.json({ isPlaying: false, settings }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (!playerRes.ok) throw new Error(`Ошибка API (${playerRes.status})`);
    const data = await playerRes.json();

    if (!data || !data.is_playing || !data.item) {
      return NextResponse.json({ isPlaying: false, settings }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const trackUri = data.item.uri;
    let orderedBy: string | null = null;

    try {
      const { data: requestData } = await supabase
        .from('song_requests')
        .select('sender_name')
        .eq('spotify_uri', trackUri)
        .in('status', ['approved', 'played', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (requestData && requestData.length > 0) orderedBy = requestData[0].sender_name;
    } catch (e) {}

    const currentTrack = {
      name: data.item.name,
      artist: data.item.artists.map((a: any) => a.name).join(', '),
      orderedBy: orderedBy,
    };

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
    } catch (e) {}

    return NextResponse.json(
      { isPlaying: true, current: currentTrack, next: nextTrack, settings },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Ошибка API' }, 
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}