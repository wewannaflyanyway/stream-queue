import { NextRequest, NextResponse } from 'next/server';
import { musicCommandsEnabled } from '@/lib/chat/mode';
import { cancelPendingRequest } from '@/lib/chat/cancel-request';

export async function GET(req: NextRequest) {
  try {
    if (await musicCommandsEnabled()) return new NextResponse('Команды музыки обрабатываются напрямую через Twitch. Удали эту команду в Nightbot.');
    return new NextResponse(await cancelPendingRequest(req.nextUrl.searchParams.get('user') || ''));
  } catch { return new NextResponse('Не удалось проверить режим команд. Попробуйте позже.'); }
}
