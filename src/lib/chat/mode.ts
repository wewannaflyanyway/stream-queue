import { getServiceSupabase } from '@/lib/supabase';

export async function musicCommandsEnabled(): Promise<boolean> {
  const { data, error } = await getServiceSupabase().from('stream_poll_twitch').select('music_commands_enabled').eq('id', 1).single();
  if (error || !data) throw new Error('Не удалось проверить режим команд чата.');
  return data.music_commands_enabled === true;
}
