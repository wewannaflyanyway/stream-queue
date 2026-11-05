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
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const orderedQueue = data?.queue.filter(entry => entry.request || entry.possiblyRequested) ?? [];
  const liveHistory = !error && data?.stream?.online && data.stream.automationEnabled && data.stream.connectionHealthy;
  return <>
    <section className="min-h-[120px] rounded-3xl bg-[var(--viewer-panel)] border border-[var(--viewer-panel-border)] p-6">
      <div className="flex flex-wrap justify-between gap-2 mb-4"><h2 className="text-base font-semibold flex items-center gap-2"><Music className="w-4 h-4 text-[var(--viewer-accent)]"/>Сейчас играет</h2>
        <span className="text-xs text-[var(--viewer-muted)]">{error ? 'Статус стрима недоступен' : !data ? 'Проверяем стрим…' : data.stream?.automationEnabled ? !data.stream.connectionHealthy ? 'Статус Twitch недоступен' : data.stream.online ? '● Стрим онлайн' : '○ Стрим офлайн' : 'Статус стрима недоступен'}</span></div>
      {data?.current ? <div><p className="font-semibold text-sm break-words">{data.current.name}</p><p className="text-xs text-[var(--viewer-muted)] mt-1 break-words">{data.current.artist}{data.current.request ? ` · заказал ${data.current.request.sender_name}` : ''}{data.isPlaying === false ? ' · на паузе' : ''}</p></div>
        : <p className="text-xs text-[var(--viewer-muted)]">{error || (data && !data.playbackAvailable) ? 'Не удалось получить данные Spotify.' : data ? 'Плеер сейчас ничего не воспроизводит.' : 'Загружаем плеер…'}</p>}
    </section>
    <section className="min-h-[196px] rounded-3xl bg-[var(--viewer-panel)] border border-[var(--viewer-panel-border)] p-6">
      <h2 className="text-base font-semibold mb-3.5 flex items-center gap-2"><ListMusic className="w-4 h-4 text-[var(--viewer-accent)]"/>Очередь заказов {orderedQueue.length > 0 && <span className="text-xs text-[var(--viewer-muted)]">· {orderedQueue.length}</span>}</h2>
      {!data && !error ? <div role="status" aria-label="Загружаем очередь" className="space-y-2"><div className="h-10 rounded-xl bg-[var(--viewer-surface)]"/><div className="h-10 rounded-xl bg-[var(--viewer-surface)]"/><div className="h-10 rounded-xl bg-[var(--viewer-surface)]"/></div>
        : !data?.playbackAvailable ? <p className="text-xs text-[var(--viewer-muted)]">Очередь Spotify временно недоступна.</p>
        : orderedQueue.length === 0 ? <p className="text-xs text-[var(--viewer-muted)]">{data.stream?.automationEnabled ? 'В очереди пока нет заказанных треков.' : 'Включите автоматику Twitch, чтобы отслеживать заказы текущего стрима.'}</p>
        : <><p className="text-[11px] text-[var(--viewer-muted)] mb-3">Между заказами могут играть другие треки Spotify.</p><ol className="space-y-2.5">{(queueExpanded ? orderedQueue : orderedQueue.slice(0, 5)).map((entry, index) => <li key={`${entry.uri}-${index}`} className="p-2.5 rounded-2xl bg-[var(--viewer-surface)] border border-[var(--viewer-divider)] flex items-center gap-3">
          <span className="text-xs text-[var(--viewer-muted)] w-5 text-center shrink-0">{index + 1}</span><span className="viewer-source-mark"><ProviderIcon provider="spotify" className="w-5 h-5"/></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold truncate">{entry.name}</p><p className="text-[11px] text-[var(--viewer-muted)] truncate">{entry.artist}{entry.request ? ` · от ${entry.request.sender_name}` : ' · возможно, заказанный трек'}</p></div>
        </li>)}</ol>{orderedQueue.length > 5 && <button type="button" aria-expanded={queueExpanded} onClick={() => setQueueExpanded(!queueExpanded)} className="mt-3 text-xs font-semibold text-[var(--viewer-accent)]">{queueExpanded ? 'Свернуть очередь' : `Показать все заказы (${orderedQueue.length})`}</button>}</>}
      {data?.pending && data.pending.length > 0 && <div className="mt-5"><h3 className="text-xs font-semibold text-[var(--viewer-muted)] mb-2">На модерации · {data.pending.length}</h3><p className="text-[11px] text-[var(--viewer-muted)] mb-2">Порядок воспроизведения станет известен после одобрения.</p><ul className="space-y-2">{(pendingExpanded ? data.pending : data.pending.slice(0, 5)).map(entry => <li key={entry.id} className="p-2.5 rounded-2xl bg-[var(--viewer-surface)] border border-[var(--viewer-divider)]"><p className="text-xs font-semibold break-words">{entry.track_name}</p><p className="text-[11px] text-[var(--viewer-muted)] break-words">{entry.artist_name} · от {entry.sender_name}</p></li>)}</ul>{data.pending.length > 5 && <button type="button" aria-expanded={pendingExpanded} onClick={() => setPendingExpanded(!pendingExpanded)} className="mt-3 text-xs font-semibold text-[var(--viewer-accent)]">{pendingExpanded ? 'Свернуть заявки' : `Показать все заявки (${data.pending.length})`}</button>}</div>}
      {error && data && <p className="text-xs text-[var(--viewer-danger)] mt-3" role="status">Нет связи с сервером, данные могут быть устаревшими.</p>}
    </section>
    <section className="min-h-[120px] rounded-3xl bg-[var(--viewer-panel)] border border-[var(--viewer-panel-border)] p-6"><h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-[var(--viewer-accent)]"/>История заказов</h2>
      {liveHistory && data ? data.history.length ? <><p className="text-[11px] text-[var(--viewer-muted)] mb-3">Заказы этого стрима, включая те, что ещё в очереди.</p><ol className="space-y-2">{(historyExpanded ? data.history : data.history.slice(0, 5)).map(entry => <li key={entry.id} className="text-xs text-[var(--viewer-muted)] break-words"><span className="text-[var(--viewer-text)]">{entry.artist_name} — {entry.track_name}</span> · от {entry.sender_name}</li>)}</ol>{data.history.length > 5 && <button type="button" aria-expanded={historyExpanded} onClick={() => setHistoryExpanded(!historyExpanded)} className="mt-3 text-xs font-semibold text-[var(--viewer-accent)]">{historyExpanded ? 'Свернуть историю' : `Показать всю историю (${data.history.length})`}</button>}</> : <p className="text-xs text-[var(--viewer-muted)]">На этом стриме пока нет одобренных заказов.</p> : <p className="text-xs text-[var(--viewer-muted)]">{error ? 'Не удалось загрузить историю.' : !data ? 'Загружаем историю…' : !data.stream?.automationEnabled ? 'История текущего стрима появится после включения автоматики Twitch в админке.' : !data.stream.connectionHealthy ? 'История временно недоступна: проверьте подключение Twitch.' : 'История появится с началом стрима.'}</p>}
    </section>
  </>;
}
