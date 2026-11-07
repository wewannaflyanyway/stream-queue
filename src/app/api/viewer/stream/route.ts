import { getStreamSnapshot } from '@/lib/stream/snapshot';
import type { QueueItem, QueueRequest } from '@/lib/stream/queue';

function publicRequest(request: QueueRequest) {
  const { sender_twitch_id, ...safe } = request;
  void sender_twitch_id;
  return safe;
}
function publicItem(item: QueueItem) {
  return { ...item, request: item.request ? publicRequest(item.request) : null };
}

export async function GET(request: Request) {
  void request.url;
  try {
    const { stream, requests, ...snapshot } = await getStreamSnapshot();
    void requests;
    return Response.json({ ...snapshot, current: snapshot.current ? publicItem(snapshot.current) : null, queue: snapshot.queue.map(publicItem), pending: snapshot.pending.map(publicRequest), history: snapshot.history.map(publicRequest), stream: stream && { online: stream.online, automationEnabled: stream.automation_enabled, sessionId: stream.session_id, connectionHealthy: Boolean(stream.online_subscription_id && stream.offline_subscription_id) } }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=5' } });
  } catch {
    return Response.json({ error: 'Не удалось загрузить очередь и состояние стрима.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
