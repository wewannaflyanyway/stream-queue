import { GET as getNowPlaying } from '@/app/api/spotify/now-playing/route';

export async function nowPlayingText(): Promise<string> {
  try {
    const data = await (await getNowPlaying(new Request('http://localhost/api/spotify/now-playing'))).json() as { isPlaying: boolean; error?: string; current?: { name: string; artist: string; orderedBy?: string | null } };
    if (data.error) return 'Ошибка при получении трека 😔';
    if (!data.isPlaying || !data.current) return 'Сейчас ничего не играет 🤫';
    const requester = data.current.orderedBy ? ` (Заказал: @${data.current.orderedBy})` : '';
    return `🎵 Сейчас играет: ${data.current.artist} - ${data.current.name}${requester}`;
  } catch { return 'Ошибка при получении трека 😔'; }
}
