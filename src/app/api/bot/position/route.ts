import { getStreamSnapshot } from '@/lib/stream/snapshot';
import { positionForUser } from '@/lib/stream/queue';

export async function GET(request: Request) {
  const user = new URL(request.url).searchParams.get('user')?.trim().slice(0, 25);
  if (!user) return new Response('Не удалось определить зрителя.');
  try {
    const snapshot = await getStreamSnapshot();
    if (snapshot.stream?.automation_enabled && (!snapshot.stream.online_subscription_id || !snapshot.stream.offline_subscription_id)) return new Response(`@${user}, не удалось проверить состояние стрима. Попробуй позже.`);
    if (!snapshot.stream?.online && !snapshot.stream?.manual_offline_since) return new Response(`@${user}, сейчас нет активного стрима.`);
    const result = positionForUser(user, [...snapshot.pending, ...snapshot.requests], snapshot.current, snapshot.queue, snapshot.playbackAvailable);
    if (result.kind === 'none') return new Response(`@${user}, активных заявок не найдено.`);
    if (result.kind === 'pending') return new Response(`@${user}, твоя заявка ожидает модерации. Позиция пока неизвестна.`);
    if (result.kind === 'playing') return new Response(`@${user}, твой трек сейчас в плеере.`);
    if (result.kind === 'unknown') return new Response(`@${user}, не удалось точно определить позицию твоего трека в Spotify.`);
    return new Response(`@${user}, перед треком «${result.track}» в очереди Spotify: ${result.ahead}. Текущий трек считается отдельно.`);
  } catch { return new Response(`@${user}, сейчас не удалось проверить очередь. Попробуй позже.`); }
}
