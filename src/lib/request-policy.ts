import type { SupabaseClient } from '@supabase/supabase-js';

export interface RequestTrack {
  uri: string;
  name: string;
  artist: string;
  durationMs: number;
  isExplicit: boolean;
}

export interface RequestSettings {
  is_accepting: boolean;
  auto_approve: boolean;
  max_queue_size: number;
  max_duration_sec: number;
  cooldown_user_sec: number;
  prevent_duplicates: boolean;
  duplicate_cooldown_min: number;
  explicit_mode: 'allow' | 'manual' | 'block';
  banned_words: string | null;
  banned_artists: string | null;
}

export class RequestPolicyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function validateTrackPolicy(track: RequestTrack, settings: RequestSettings): void {
  if (!settings.is_accepting) throw new RequestPolicyError('Прием музыки сейчас закрыт стримером.', 403);
  if (!/^spotify:track:[a-z0-9]{22}$/i.test(track.uri) || !track.name || !track.artist || !Number.isFinite(track.durationMs) || track.durationMs <= 0) throw new RequestPolicyError('Не удалось проверить данные трека в Spotify.');
  if (Math.ceil(track.durationMs / 1000) > settings.max_duration_sec) throw new RequestPolicyError(`Трек слишком длинный (максимум ${Math.floor(settings.max_duration_sec / 60)} мин).`);
  if (settings.explicit_mode === 'block' && track.isExplicit) throw new RequestPolicyError('Треки 18+ запрещены стримером.');
  const words = (settings.banned_words || '').split(',').map(value => value.trim().toLocaleLowerCase('ru')).filter(Boolean);
  const artists = (settings.banned_artists || '').split(',').map(value => value.trim().toLocaleLowerCase('ru')).filter(Boolean);
  const name = track.name.toLocaleLowerCase('ru');
  const artist = track.artist.toLocaleLowerCase('ru');
  if (words.some(word => name.includes(word) || artist.includes(word)) || artists.some(value => artist.includes(value))) throw new RequestPolicyError('Этот трек или автор заблокирован.');
}

export async function validateRequestLimits(db: SupabaseClient, track: RequestTrack, settings: RequestSettings, sender: string, twitchUserId: string | null = null): Promise<void> {
  const pending = await db.from('song_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('stream_pending_archived', false);
  if (pending.error || pending.count === null) throw new RequestPolicyError('Не удалось проверить очередь. Попробуйте позже.', 503);
  if (pending.count >= settings.max_queue_size) throw new RequestPolicyError('Очередь заполнена. Попробуйте позже.', 429);
  if (settings.prevent_duplicates && settings.duplicate_cooldown_min > 0) {
    const since = new Date(Date.now() - settings.duplicate_cooldown_min * 60_000).toISOString();
    const recent = await db.from('song_requests').select('id').eq('spotify_uri', track.uri).neq('status', 'rejected').gte('created_at', since).limit(1);
    if (recent.error) throw new RequestPolicyError('Не удалось проверить повторы. Попробуйте позже.', 503);
    if (recent.data?.length) throw new RequestPolicyError('Этот трек уже заказывали совсем недавно.');
  }
  // Anonymous web visitors do not share one artificial cooldown identity.
  if (sender && sender.toLocaleLowerCase('ru') !== 'аноним' && settings.cooldown_user_sec > 0) {
    const since = new Date(Date.now() - settings.cooldown_user_sec * 1000).toISOString();
    const safeName = sender.replace(/[\\%_]/g, '\\$&');
    let query = db.from('song_requests').select('id');
    query = twitchUserId ? query.eq('sender_twitch_id', twitchUserId) : query.ilike('sender_name', safeName);
    const recent = await query.neq('status', 'rejected').gte('created_at', since).limit(1);
    if (recent.error) throw new RequestPolicyError('Не удалось проверить интервал заказов. Попробуйте позже.', 503);
    if (recent.data?.length) throw new RequestPolicyError('Пожалуйста, подождите перед следующим заказом.', 429);
  }
}
