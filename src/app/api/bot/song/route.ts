import { NextResponse } from 'next/server';
import { musicCommandsEnabled } from '@/lib/chat/mode';
import { nowPlayingText } from '@/lib/chat/now-playing';

export async function GET() {
  try {
    if (await musicCommandsEnabled()) return new NextResponse('Команды музыки обрабатываются напрямую через Twitch. Удали эту команду в Nightbot.');
    return new NextResponse(await nowPlayingText());
  } catch { return new NextResponse('Не удалось проверить режим команд. Попробуйте позже.'); }
}
