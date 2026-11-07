import { musicCommandsEnabled } from '@/lib/chat/mode';
import { positionText } from '@/lib/chat/position';

export async function GET(request: Request) {
  try {
    if (await musicCommandsEnabled()) return new Response('Команды музыки обрабатываются напрямую через Twitch. Удали эту команду в Nightbot.');
    const user = new URL(request.url).searchParams.get('user')?.trim().slice(0, 25) || '';
    return new Response(await positionText(user));
  } catch { return new Response('Не удалось проверить режим команд. Попробуйте позже.'); }
}
