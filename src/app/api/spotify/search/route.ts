import { NextRequest, NextResponse } from 'next/server';
import { searchSpotifyTracks } from '@/lib/spotify';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ tracks: [] });
  }

  try {
    const tracks = await searchSpotifyTracks(q);
    return NextResponse.json({ tracks });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Ошибка поиска' }, { status: 500 });
  }
}