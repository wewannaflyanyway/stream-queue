import { readPollState, pollResponseError } from '@/lib/polls/server';

export async function GET(request: Request) {
  void request.url; // Request-time endpoint: never prerender or cache the snapshot.
  try {
    const { poll, style, visible, serverNow } = await readPollState();
    return Response.json({ poll, style, visible, serverNow }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) { return pollResponseError(error); }
}
