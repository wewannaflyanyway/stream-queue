import { getServiceSupabase } from '@/lib/supabase';
import { helix } from '@/lib/polls/twitch';
import { requestSong } from './song-request';
import { cancelPendingRequest } from './cancel-request';
import { positionText } from './position';
import { nowPlayingText } from './now-playing';

interface ChatCommandEvent { broadcasterId: string; subscriptionId: string; userId: string; login: string; messageId: string; text: string }

export async function handleTwitchMusicCommand(event: ChatCommandEvent): Promise<void> {
  const match = /^!(sr|song|wrongsong|очередь)(?:\s+(.*))?\s*$/iu.exec(event.text.trim());
  if (!match || !/^[a-z0-9_]{1,25}$/i.test(event.login) || !/^\d+$/.test(event.userId)) return;
  const { data: claimed, error } = await getServiceSupabase().rpc('music_claim_chat_message', { p_subscription: event.subscriptionId, p_broadcaster: event.broadcasterId, p_message: event.messageId });
  if (error) throw new Error('Не удалось проверить сообщение чата.');
  if (!claimed) return;
  let message: string;
  try {
    switch (match[1].toLocaleLowerCase('ru')) {
      case 'sr': message = await (await requestSong(match[2] || null, event.login, event.userId)).text(); break;
      case 'song': message = await nowPlayingText(); break;
      case 'wrongsong': message = await cancelPendingRequest(event.login, event.userId); break;
      default: message = await positionText(event.login, event.userId);
    }
  } catch { message = `@${event.login}, произошла ошибка. Попробуй ещё раз.`; }
  const response = await helix('chat/messages', { method: 'POST', body: JSON.stringify({ broadcaster_id: event.broadcasterId, sender_id: event.broadcasterId, message: Array.from(message).slice(0, 450).join(''), reply_parent_message_id: event.messageId }) });
  if (!response.ok) throw new Error(`Не удалось отправить ответ Twitch (${response.status}).`);
  const result = await response.json() as { data?: { is_sent?: boolean; drop_reason?: { code?: string } | null }[] };
  if (!result.data?.[0]?.is_sent) throw new Error(`Twitch не доставил ответ: ${result.data?.[0]?.drop_reason?.code || 'unknown'}.`);
}
