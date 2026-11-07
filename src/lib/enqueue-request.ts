import type { SupabaseClient } from '@supabase/supabase-js';
import { addTrackToSpotifyQueue } from '@/lib/spotify';

export type EnqueueResult = 'queued' | 'not_available' | 'uncertain' | 'already_claimed';

export async function enqueueRequest(db: SupabaseClient, requestId: string): Promise<EnqueueResult> {
  const claim = await db.rpc('music_claim_request', { p_id: requestId });
  if (claim.error) throw new Error('Не удалось начать добавление заявки.');
  if (!claim.data || typeof claim.data !== 'string') return 'already_claimed';
  try {
    await addTrackToSpotifyQueue(claim.data);
  } catch (error) {
    const definitelyNotQueued = error instanceof Error && error.message === 'NO_ACTIVE_DEVICE';
    const result = await db.rpc('music_resolve_claim', { p_id: requestId, p_outcome: definitelyNotQueued ? 'retry' : 'uncertain' });
    if (result.error || result.data !== true) throw new Error('Не удалось сохранить результат. Проверь очередь Spotify до повторного добавления.');
    return definitelyNotQueued ? 'not_available' : 'uncertain';
  }
  const result = await db.rpc('music_resolve_claim', { p_id: requestId, p_outcome: 'queued' });
  if (result.error || result.data !== true) throw new Error('Трек мог быть добавлен в Spotify, но статус не сохранился. Проверь очередь перед повтором.');
  return 'queued';
}
