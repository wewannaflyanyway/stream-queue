import { getServiceSupabase } from '@/lib/supabase';

export async function cancelPendingRequest(userName: string, twitchUserId: string | null = null): Promise<string> {
  if (!userName) return 'Ошибка: не указан никнейм.';
  try {
    const db = getServiceSupabase();
    let query = db.from('song_requests').select('id, track_name').eq('status', 'pending').eq('stream_pending_archived', false);
    query = twitchUserId ? query.eq('sender_twitch_id', twitchUserId) : query.eq('sender_name', userName.toLowerCase());
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
    if (error) return 'Произошла ошибка при отмене трека.';
    if (!data?.length) return `@${userName}, у вас нет треков в очереди на модерации.`;
    const result = await db.from('song_requests').update({ status: 'rejected' }).eq('id', data[0].id).eq('status', 'pending').select('id');
    if (result.error) return 'Произошла ошибка при отмене трека.';
    if (!result.data?.length) return `@${userName}, заявку уже обработали.`;
    return `@${userName}, ваш трек "${data[0].track_name}" успешно отменен! 🗑️`;
  } catch { return 'Произошла ошибка при отмене трека.'; }
}
