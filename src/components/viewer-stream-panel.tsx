'use client';

import { useEffect, useState } from 'react';
import { Clock, ListMusic, Music } from 'lucide-react';
import ProviderIcon from '@/components/provider-icon';
import type { StreamSnapshot } from '@/lib/stream/snapshot';

export type ViewerSnapshot = Omit<StreamSnapshot, 'stream' | 'requests'> & { stream: { online: boolean; automationEnabled: boolean; sessionId: string | null; connectionHealthy: boolean } | null };
export type ViewerLiveStatus = 'online' | 'offline' | 'unknown' | 'unmanaged';

export default function ViewerStreamPanel({ onLiveStatus }: { onLiveStatus: (status: ViewerLiveStatus) => void }) {
  const [data, setData] = useState<ViewerSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function refresh() {
      controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/viewer/stream', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json() as ViewerSnapshot;
        if (!stopped) {
          setData(result); setError(false);
          onLiveStatus(!result.stream ? 'unknown' : !result.stream.automationEnabled ? 'unmanaged' : !result.stream.connectionHealthy ? 'unknown' : result.stream.online ? 'online' : 'offline');
        }
      } catch { if (!stopped) { setError(true); onLiveStatus('unknown'); } }
      finally { clearTimeout(deadline); if (!stopped) timer = setTimeout(refresh, 15000); }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [onLiveStatus]);
  return <ViewerStreamContent data={data} error={error} />;
}

export function ViewerStreamContent({ data, error }: { data: ViewerSnapshot | null; error: boolean }) {
  return <>
    <section className="rounded-3xl bg-[var(--viewer-panel)] backdrop-blur-xl border border-[var(--viewer-panel-border)] p-6">
      <div className="flex flex-wrap justify-between gap-2 mb-4"><h2 className="text-base font-semibold flex items-center gap-2"><Music className="w-4 h-4 text-[var(--viewer-accent)]"/>Сейчас играет</h2>
        <span className="text-xs text-[var(--viewer-muted)]">{error ? 'Статус стрима недоступен' : !data ? 'Проверяем стрим…' : data.stream?.automationEnabled ? !data.stream.connectionHealthy ? 'Статус Twitch недоступен' : data.stream.online ? '● Стрим онлайн' : '○ Стрим офлайн' : 'Статус стрима недоступен'}</span></div>
      {data?.current ? <div><p className="font-semibold text-sm break-words">{data.current.name}</p><p className="text-xs text-[var(--viewer-muted)] mt-1 break-words">{data.current.artist}{data.current.request ? ` · заказал ${data.current.request.sender_name}` : ''}{data.isPlaying === false ? ' · на паузе' : ''}</p></div>
        : <p className="text-xs text-[var(--viewer-muted)]">{error || (data && !data.playbackAvailable) ? 'Не удалось получить данные Spotify.' : data ? 'Плеер сейчас ничего не воспроизводит.' : 'Загружаем плеер…'}</p>}
    </section>
    <section className="rounded-3xl bg-[var(--viewer-panel)] backdrop-blur-xl border border-[var(--viewer-panel-border)] p-6">
      <h2 className="text-base font-semibold mb-3.5 flex items-center gap-2"><ListMusic className="w-4 h-4 text-[var(--viewer-accent)]"/>Очередь плеера</h2>
      {!data?.playbackAvailable ? <p className="text-xs text-[var(--viewer-muted)]">{error || data ? 'Очередь Spotify временно недоступна.' : 'Загружаем очередь…'}</p>
        : data.queue.length === 0 ? <p className="text-xs text-[var(--viewer-muted)]">В очереди плеера пока пусто.</p>
        : <ol className="space-y-2.5">{data.queue.map((entry, index) => <li key={`${entry.uri}-${index}`} className="p-2.5 rounded-2xl bg-[var(--viewer-surface)] border border-[var(--viewer-divider)] flex items-center gap-3">
          <span className="text-xs text-[var(--viewer-muted)] w-5 text-center shrink-0">{index + 1}</span><span className="viewer-source-mark"><ProviderIcon provider="spotify" className="w-5 h-5"/></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold truncate">{entry.name}</p><p className="text-[11px] text-[var(--viewer-muted)] truncate">{entry.artist}{entry.request ? ` · от ${entry.request.sender_name}` : entry.ambiguous ? ' · заказчик не определен' : ''}</p></div>
        </li>)}</ol>}
      {data?.pending && data.pending.length > 0 && <div className="mt-5"><h3 className="text-xs font-semibold text-[var(--viewer-muted)] mb-2">На модерации · {data.pending.length}</h3><p className="text-[11px] text-[var(--viewer-muted)] mb-2">Порядок воспроизведения станет известен после одобрения.</p><ul className="space-y-2">{data.pending.map(entry => <li key={entry.id} className="p-2.5 rounded-2xl bg-[var(--viewer-surface)] border border-[var(--viewer-divider)]"><p className="text-xs font-semibold break-words">{entry.track_name}</p><p className="text-[11px] text-[var(--viewer-muted)] break-words">{entry.artist_name} · от {entry.sender_name}</p></li>)}</ul></div>}
      {error && data && <p className="text-xs text-[var(--viewer-danger)] mt-3" role="status">Нет связи с сервером, данные могут быть устаревшими.</p>}
    </section>
    {!error && data?.stream?.online && data.stream.automationEnabled && data.stream.connectionHealthy && <section className="rounded-3xl bg-[var(--viewer-panel)] backdrop-blur-xl border border-[var(--viewer-panel-border)] p-6"><h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-[var(--viewer-accent)]"/>Заказы этого стрима</h2>
      {data.history.length ? <ol className="space-y-2">{data.history.map(entry => <li key={entry.id} className="text-xs text-[var(--viewer-muted)] break-words"><span className="text-[var(--viewer-text)]">{entry.artist_name} — {entry.track_name}</span> · от {entry.sender_name}</li>)}</ol> : <p className="text-xs text-[var(--viewer-muted)]">На этом стриме пока нет одобренных заказов.</p>}
    </section>}
  </>;
}
