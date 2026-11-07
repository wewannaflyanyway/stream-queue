import 'server-only';
import { getServiceSupabase } from '@/lib/supabase';
import { fetchWithTimeout, getStreamerAccessToken } from '@/lib/spotify';
import { reconcileStreamState, type StreamState } from './lifecycle';
import { associateQueue, type PlayerItem, type QueueItem, type QueueRequest } from './queue';

export interface StreamSnapshot {
  stream: StreamState | null;
  playbackAvailable: boolean;
  isPlaying: boolean | null;
  current: QueueItem | null;
  queue: QueueItem[];
  pending: QueueRequest[];
  history: QueueRequest[];
  requests: QueueRequest[];
}

async function loadRequests(sessionId: string | null, offlineSince: string | null): Promise<{ pending: QueueRequest[]; history: QueueRequest[] }> {
  const db = getServiceSupabase();
  async function collect(mode: 'pending' | 'history'): Promise<QueueRequest[]> {
    const rows: QueueRequest[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = db.from('song_requests').select('id,created_at,queued_at,stream_session_id,stream_history_hidden,track_name,artist_name,sender_name,sender_twitch_id,source,spotify_uri,status').order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + 999);
      if (mode === 'pending') query = query.eq('status', 'pending').eq('stream_pending_archived', false);
      else {
        query = query.in('status', ['approved', 'played']);
        query = sessionId ? query.eq('stream_session_id', sessionId) : query.is('stream_session_id', null).gte('created_at', offlineSince!);
      }
      const { data, error } = await query;
      if (error) throw new Error('Не удалось загрузить заявки.');
      rows.push(...(data as QueueRequest[]));
      if (data.length < 1000) break;
    }
    return rows;
  }
  const [pending, history] = await Promise.all([collect('pending'), sessionId || offlineSince ? collect('history') : Promise.resolve([])]);
  return { pending, history };
}

function item(raw: { uri?: string; name?: string; artists?: { name: string }[] } | null | undefined): PlayerItem | null {
  if (!raw?.uri || !raw.name) return null;
  return { uri: raw.uri, name: raw.name, artist: (raw.artists ?? []).map(a => a.name).join(', ') };
}

export async function getStreamSnapshot(): Promise<StreamSnapshot> {
  const stream = await reconcileStreamState(false);
  if (!stream) throw new Error('Не настроена база стрима.');
  const { pending, history } = await loadRequests(stream.online ? stream.session_id : null, stream.online ? null : stream.manual_offline_since);
  let current: PlayerItem | null = null;
  let queue: PlayerItem[] = [];
  let playbackAvailable = false;
  let isPlaying: boolean | null = null;
  const observedAt = new Date().toISOString();
  try {
    const token = await getStreamerAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const [queueRes, playerRes] = await Promise.all([
      fetchWithTimeout('https://api.spotify.com/v1/me/player/queue', { headers, cache: 'no-store' }),
      fetchWithTimeout('https://api.spotify.com/v1/me/player', { headers, cache: 'no-store' }),
    ]);
    if (queueRes.ok) {
      const data = await queueRes.json() as { currently_playing?: Parameters<typeof item>[0]; queue?: Parameters<typeof item>[0][] };
      current = item(data.currently_playing);
      queue = (data.queue ?? []).map(item).filter((entry): entry is PlayerItem => entry !== null);
      playbackAvailable = true;
    }
    if (playerRes.ok && playerRes.status !== 204) {
      const player = await playerRes.json() as { is_playing?: boolean };
      isPlaying = Boolean(player.is_playing);
    }
  } catch { /* Surface unavailable rather than inventing a queue. */ }
  const associated = associateQueue(current, queue, history);
  if (playbackAvailable && isPlaying === true && current && stream.automation_enabled && stream.online && stream.session_id && stream.online_subscription_id && stream.offline_subscription_id) {
    const { error } = await getServiceSupabase().rpc('music_observe_playback', {
      p_session: stream.session_id, p_uri: current.uri,
      p_request: associated.current?.request?.id ?? null, p_observed_at: observedAt,
    });
    if (error) throw new Error('Не удалось синхронизировать историю воспроизведения.');
  }
  const live = stream.online && stream.automation_enabled && stream.online_subscription_id && stream.offline_subscription_id;
  return { stream, playbackAvailable, isPlaying, current: associated.current, queue: associated.queue, pending, requests: history, history: live ? history.filter(request => !request.stream_history_hidden).reverse() : [] };
}
