import { NextRequest, NextResponse } from 'next/server';
import { musicCommandsEnabled } from '@/lib/chat/mode';
import { requestSong } from '@/lib/chat/song-request';

export async function GET(req: NextRequest) {
  try {
    if (await musicCommandsEnabled()) return new NextResponse('Команды музыки обрабатываются напрямую через Twitch. Удали эту команду в Nightbot.');
    return await requestSong(req.nextUrl.searchParams.get('query'), req.nextUrl.searchParams.get('user') || 'Аноним');
  } catch { return new NextResponse('Не удалось проверить режим команд. Попробуйте позже.'); }
}
