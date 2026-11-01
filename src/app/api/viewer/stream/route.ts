import { getStreamSnapshot } from '@/lib/stream/snapshot';

export async function GET(request: Request) {
  void request.url;
  try {
    const { stream, requests, ...snapshot } = await getStreamSnapshot();
    void requests;
    return Response.json({ ...snapshot, stream: stream && { online: stream.online, automationEnabled: stream.automation_enabled, sessionId: stream.session_id, connectionHealthy: Boolean(stream.online_subscription_id && stream.offline_subscription_id) } }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=5' } });
  } catch {
    return Response.json({ error: 'Не удалось загрузить очередь и состояние стрима.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
