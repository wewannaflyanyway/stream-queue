import { getServiceSupabase } from '@/lib/supabase';

export async function GET(request: Request) {
  void request.url;
  try {
    const db = getServiceSupabase();
    const [settings, pending] = await Promise.all([
      db.from('stream_settings').select('is_accepting,cooldown_user_sec,max_duration_sec,max_queue_size,prevent_duplicates,duplicate_cooldown_min,explicit_mode,rules_text').eq('id', 1).single(),
      db.from('song_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('stream_pending_archived', false),
    ]);
    if (settings.error || !settings.data || pending.error || pending.count === null) throw new Error('Unable to load public settings');
    return Response.json({ settings: { ...settings.data, banned_words: '', banned_artists: '' }, pendingCount: pending.count }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=5' } });
  } catch { return Response.json({ error: 'Не удалось загрузить настройки.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
