import { getStreamSnapshot } from '@/lib/stream/snapshot';
import { positionForUser } from '@/lib/stream/queue';

export async function positionText(user: string, twitchUserId: string | null = null): Promise<string> {
  if (!user) return 'Не удалось определить зрителя.';
  try {
    const snapshot = await getStreamSnapshot();
    if (snapshot.stream?.automation_enabled && (!snapshot.stream.online_subscription_id || !snapshot.stream.offline_subscription_id)) return `@${user}, не удалось проверить состояние стрима. Попробуй позже.`;
    if (!snapshot.stream?.online && !snapshot.stream?.manual_offline_since) return `@${user}, сейчас нет активного стрима.`;
    const result = positionForUser(user, [...snapshot.pending, ...snapshot.requests], snapshot.current, snapshot.queue, snapshot.playbackAvailable, twitchUserId);
    if (result.kind === 'none') return `@${user}, активных заявок не найдено.`;
    if (result.kind === 'pending') return `@${user}, твоя заявка ожидает модерации. Позиция пока неизвестна.`;
    if (result.kind === 'playing') return `@${user}, твой трек сейчас в плеере.`;
    if (result.kind === 'unknown') return `@${user}, не удалось точно определить позицию твоего трека в Spotify.`;
    return `@${user}, перед треком «${result.track}» в очереди Spotify: ${result.ahead}. Текущий трек считается отдельно.`;
  } catch { return `@${user}, сейчас не удалось проверить очередь. Попробуй позже.`; }
}
