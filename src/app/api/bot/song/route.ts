import { NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const token = await getStreamerAccessToken();
    const playerRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (playerRes.status === 204 || playerRes.status === 404 || !playerRes.ok) {
      return new NextResponse('Сейчас ничего не играет 🤫', { status: 200 });
    }

    const data = await playerRes.json();
    if (!data || !data.item) {
      return new NextResponse('Сейчас ничего не играет 🤫', { status: 200 });
    }

    const trackName = data.item.name;
    const artistName = data.item.artists.map((a: any) => a.name).join(', ');
    
    const supabase = getServiceSupabase();
    const { data: dbData } = await supabase
      .from('song_requests')
      .select('sender_name')
      .eq('spotify_uri', data.item.uri)
      .in('status', ['approved', 'played', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1);

    let responseText = `🎵 Сейчас играет: ${artistName} - ${trackName}`;
    if (dbData && dbData.length > 0 && dbData[0].sender_name) {
      responseText += ` (Заказал: @${dbData[0].sender_name})`;
    }

    return new NextResponse(responseText, { status: 200 });
  } catch (error) {
    return new NextResponse('Ошибка при получении трека 😔', { status: 200 });
  }
}