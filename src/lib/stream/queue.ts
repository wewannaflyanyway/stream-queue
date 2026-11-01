export interface QueueRequest {
  id: string;
  created_at: string;
  queued_at: string | null;
  stream_session_id: string | null;
  stream_history_hidden?: boolean;
  track_name: string;
  artist_name: string;
  sender_name: string;
  spotify_uri: string;
  status: string;
}
export interface PlayerItem { uri: string; name: string; artist: string }
export interface QueueItem extends PlayerItem { request: QueueRequest | null; ambiguous: boolean }

export function associateQueue(current: PlayerItem | null, queue: PlayerItem[], requests: QueueRequest[]): { current: QueueItem | null; queue: QueueItem[] } {
  const allItems = current ? [current, ...queue] : queue;
  const approved = requests.filter(request => request.status === 'approved');
  const mapItem = (item: PlayerItem): QueueItem => {
    const matchingItems = allItems.filter(candidate => candidate.uri === item.uri);
    const matchingRequests = approved.filter(candidate => candidate.spotify_uri === item.uri);
    const ambiguous = matchingItems.length > 1 || matchingRequests.length > 1;
    return { ...item, request: !ambiguous && matchingRequests.length === 1 ? matchingRequests[0] : null, ambiguous };
  };
  return { current: current ? mapItem(current) : null, queue: queue.map(mapItem) };
}

export type Position = { kind: 'pending' } | { kind: 'playing' } | { kind: 'unknown' } | { kind: 'none' } | { kind: 'queued'; ahead: number; track: string };
export function positionForUser(user: string, requests: QueueRequest[], current: QueueItem | null, queue: QueueItem[], playbackAvailable: boolean): Position {
  const matches = requests.filter(request => request.sender_name.toLocaleLowerCase('ru') === user.toLocaleLowerCase('ru') && ['approved', 'pending'].includes(request.status));
  const latest = matches.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest) return { kind: 'none' };
  if (latest.status === 'pending') return { kind: 'pending' };
  if (!playbackAvailable) return { kind: 'unknown' };
  if (current?.request?.id === latest.id) return { kind: 'playing' };
  const index = queue.findIndex(item => item.request?.id === latest.id);
  return index < 0 ? { kind: 'unknown' } : { kind: 'queued', ahead: index, track: latest.track_name };
}
