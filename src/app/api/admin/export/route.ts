import { NextResponse } from 'next/server';
import { getStreamerAccessToken } from '@/lib/spotify';
import { getServiceSupabase } from '@/lib/supabase';

export async function POST() {
  try {
    const token = await getStreamerAccessToken();
    const supabase = getServiceSupabase();

    const userRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userData = await userRes.json();

    const { data: tracks } = await supabase
      .from('song_requests')
      .select('spotify_uri')
      .in('status', ['played', 'approved'])
      .order('created_at', { ascending: true });

    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'Нет одобренных треков для экспорта' }, { status: 400 });
    }

    const uris = [...new Set(tracks.map(t => t.spotify_uri).filter(Boolean))];
    const date = new Date().toLocaleDateString('ru-RU');
    
    const playlistRes = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Стрим-заказы (${date})`,
        description: 'Треки, заказанные зрителями на стриме.',
        public: true
      })
    });
    const playlistData = await playlistRes.json();

    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      await fetch(`https://api.spotify.com/v1/playlists/${playlistData.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: chunk })
      });
    }

    return NextResponse.json({ success: true, url: playlistData.external_urls.spotify });
  } catch (error) {
    return NextResponse.json({ error: 'Ошибка при экспорте' }, { status: 500 });
  }
}