import { NextRequest, NextResponse } from 'next/server';
import { searchSpotifyTracks } from '@/lib/spotify';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json(
      { tracks: [] },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  try {
    const tracks = await searchSpotifyTracks(q);
    return NextResponse.json(
      { tracks },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Ошибка поиска' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}