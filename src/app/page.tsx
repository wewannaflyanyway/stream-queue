'use client';

import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import ProviderIcon from '@/components/provider-icon';
import ViewerStreamPanel, { type ViewerLiveStatus } from '@/components/viewer-stream-panel';
import { MUSIC_PROVIDER_NAMES, type MusicProvider } from '@/lib/music-provider';
import {
  Search,
  Music,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  X,
  User,
  ShieldAlert,
  Send,
  Loader2,
} from 'lucide-react';

interface Track {
  id: string;
  uri: string;
  name: string;
  artist: string;
  durationMs: number;
  isExplicit: boolean;
}

interface StreamSettings {
  is_accepting: boolean;
  cooldown_user_sec: number;
  max_duration_sec: number;
  max_queue_size: number;
  prevent_duplicates: boolean;
  duplicate_cooldown_min: number;
  explicit_mode: 'allow' | 'manual' | 'block';
  banned_words: string;
  banned_artists: string;
  rules_text: string;
}

function formatDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface SearchState {
  query: string;
  tracks: Track[];
  loading: boolean;
  error: string | null;
}

const EMPTY_SEARCH: SearchState = { query: '', tracks: [], loading: false, error: null };

function subscribeToViewerName(onChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === 'viewer_name' || event.key === null) onChange();
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}

function getSavedViewerName() {
  try {
    return localStorage.getItem('viewer_name') || '';
  } catch {
    return '';
  }
}

export default function ViewerPage() {
  const [provider, setProvider] = useState<MusicProvider>('spotify');
  const [settings, setSettings] = useState<StreamSettings | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [liveStatus, setLiveStatus] = useState<ViewerLiveStatus | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [editedSenderName, setSenderName] = useState<string | null>(null);
  const savedSenderName = useSyncExternalStore(subscribeToViewerName, getSavedViewerName, () => '');
  const senderName = editedSenderName ?? savedSenderName;
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownUntilRef = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const trimmedQuery = query.trim();
  const shouldSearch = provider === 'spotify' && !selectedTrack && trimmedQuery.length >= 2;
  const results = shouldSearch && search.query === trimmedQuery ? search.tracks : [];
  const isSearching = shouldSearch && (search.query !== trimmedQuery || search.loading);
  const searchError = shouldSearch && search.query === trimmedQuery ? search.error : null;

  // Sync the locally stored cooldown without blocking the initial render.
  useEffect(() => {
    const checkCooldown = () => {
      let until = cooldownUntilRef.current;
      try {
        until = Math.max(until, Number(localStorage.getItem('cooldown_until') || '0') || 0);
      } catch {
        // Requests still work when browser storage is unavailable.
      }
      cooldownUntilRef.current = until;
      const diff = Math.ceil((until - Date.now()) / 1000);
      setCooldownLeft(diff > 0 ? diff : 0);
    };

    const initialCheck = setTimeout(checkCooldown, 0);
    const timer = setInterval(checkCooldown, 1000);
    return () => {
      clearTimeout(initialCheck);
      clearInterval(timer);
    };
  }, []);

  // Only public settings and counts are exposed to viewers.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const refresh = async () => {
      controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/viewer/config', { signal: controller.signal });
        if (!response.ok) throw new Error('config unavailable');
        const data = await response.json() as { settings: StreamSettings; pendingCount: number };
        if (!stopped) { setSettings(data.settings); setPendingCount(data.pendingCount); setSettingsError(false); }
      } catch { if (!stopped) setSettingsError(true); }
      finally { clearTimeout(deadline); if (!stopped) timer = setTimeout(refresh, 10000); }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);

  // 3. Дебаунс-поиск по Spotify (450 мс) с отменой устаревших запросов и таймаутом
  useEffect(() => {
    const trimmed = query.trim();
    if (provider !== 'spotify' || selectedTrack || trimmed.length < 2) return;

    const controller = new AbortController();
    let active = true;

    const handler = setTimeout(async () => {
      setSearch({ query: trimmed, tracks: [], loading: true, error: null });
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(trimmed)}&t=${Date.now()}`,
          { signal: controller.signal, cache: 'no-store' }
        );
        const data = (await res.json()) as { tracks?: Track[]; error?: string };
        if (!res.ok) throw new Error(data.error || 'Не удалось выполнить поиск');
        if (active && !controller.signal.aborted) {
          setSearch({ query: trimmed, tracks: data.tracks || [], loading: false, error: null });
        }
      } catch {
        if (active) {
          setSearch({
            query: trimmed,
            tracks: [],
            loading: false,
            error: controller.signal.aborted
              ? 'Поиск занял слишком много времени. Попробуй еще раз.'
              : 'Не удалось найти треки. Проверь соединение и попробуй еще раз.',
          });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }, 450);

    return () => {
      active = false;
      clearTimeout(handler);
      controller.abort();
    };
  }, [query, selectedTrack, provider]);

  const switchProvider = (nextProvider: MusicProvider) => {
    if (provider === nextProvider || submitting) return;
    setProvider(nextProvider);
    setQuery('');
    setSearch(EMPTY_SEARCH);
    setSelectedTrack(null);
    setFeedback(null);
  };

  // 4. Клиентская валидация выбранного трека
  const getValidationError = (track: Track | null): string | null => {
    if (!track || !settings) return null;

    const durationSec = Math.ceil(track.durationMs / 1000);
    if (durationSec > settings.max_duration_sec) {
      const maxMin = Math.floor(settings.max_duration_sec / 60);
      return `Трек слишком длинный (максимум ${maxMin} мин)`;
    }

    if (settings.explicit_mode === 'block' && track.isExplicit) {
      return 'Треки 18+ запрещены стримером';
    }

    const lowerTrack = track.name.toLowerCase();
    const lowerArtist = track.artist.toLowerCase();

    const bannedWords = (settings.banned_words || '')
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const bannedArtists = (settings.banned_artists || '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);

    if (
      bannedWords.some((w) => lowerTrack.includes(w) || lowerArtist.includes(w)) ||
      bannedArtists.some((a) => lowerArtist.includes(a))
    ) {
      return 'Этот трек или автор заблокирован';
    }

    return null;
  };

  const maxQueueSize = settings?.max_queue_size || 15;
  const isQueueFull = pendingCount >= maxQueueSize;
  const isAccepting = (settings?.is_accepting ?? false) && liveStatus !== null && liveStatus !== 'unknown';
  const isLoadingOrder = (!settings && !settingsError) || liveStatus === null;
  const validationError = getValidationError(selectedTrack);

  // 5. Отправка трека
  const handleSubmit = async () => {
    if (provider !== 'spotify' || submitting || !selectedTrack || validationError || cooldownLeft > 0 || !isAccepting || isQueueFull) return;

    setSubmitting(true);
    setFeedback(null);

    const cleanName = senderName.trim().slice(0, 24);
    try {
      localStorage.setItem('viewer_name', cleanName);
    } catch {
      // Storing the nickname is optional.
    }

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotify_uri: selectedTrack.uri,
          sender_name: cleanName || 'Аноним',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Ошибка отправки заявки' });
      } else {
        const cdSec = settings?.cooldown_user_sec ?? 300;
        if (cdSec > 0) {
          cooldownUntilRef.current = Date.now() + cdSec * 1000;
          try {
            localStorage.setItem('cooldown_until', String(cooldownUntilRef.current));
          } catch {
            // Keep the countdown available for this open page.
          }
          setCooldownLeft(cdSec);
        }
        setSelectedTrack(null);
        setQuery('');
        setFeedback({
          type: data.warning ? 'error' : 'success',
          text:
            data.warning || (data.status === 'approved'
              ? 'Трек мгновенно добавлен в очередь Spotify стримера!'
              : 'Заявка отправлена! Ожидай подтверждения стримером.'),
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Сетевая ошибка при отправке' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="viewer-page min-h-screen font-sans" data-provider={provider}>
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Карточка 1: Статус стрима (На всю ширину сверху) */}
          <div className="lg:col-span-12 rounded-3xl bg-[var(--viewer-panel)] border border-[var(--viewer-panel-border)] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[var(--viewer-accent-medium)] border border-[var(--viewer-accent-border)] flex items-center justify-center text-[var(--viewer-accent)] shrink-0">
                <ProviderIcon provider={provider} className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                    wewannaflyanyway • Music
                  </h1>
                  <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${liveStatus === 'online' ? 'bg-[var(--viewer-success-soft)] text-[var(--viewer-success)] border-[var(--viewer-success-border)]' : 'bg-[var(--viewer-neutral)] text-[var(--viewer-muted)] border-[var(--viewer-input-border)]'}`}>
                    <span className="w-2 h-2 rounded-full bg-current" />
                    {liveStatus === null ? 'Проверяем стрим…' : liveStatus === 'online' ? 'Стрим онлайн' : liveStatus === 'offline' ? 'Стрим офлайн' : liveStatus === 'unmanaged' ? 'Автостатус не включён' : 'Статус стрима недоступен'}
                  </span>
                  {provider === 'youtube' ? (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--viewer-accent-medium)] text-[var(--viewer-accent)] border border-[var(--viewer-accent-border)]">
                      <span className="w-2 h-2 rounded-full bg-[var(--viewer-accent)]" />
                      YouTube скоро
                    </span>
                  ) : isLoadingOrder ? (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--viewer-neutral)] text-[var(--viewer-muted)] border border-[var(--viewer-input-border)]">Проверяем приём заказов…</span>
                  ) : isAccepting ? (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--viewer-accent-medium)] text-[var(--viewer-accent)] border border-[var(--viewer-accent-border)]">
                      <span className="w-2 h-2 rounded-full bg-[var(--viewer-accent)] animate-pulse" />
                      Прием треков открыт
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--viewer-neutral)] text-[var(--viewer-muted)] border border-[var(--viewer-input-border)]">
                      <span className="w-2 h-2 rounded-full bg-[#A7A7A7]" />
                      {settingsError || liveStatus === 'unknown' ? 'Не удалось проверить приём' : 'Прием музыки закрыт'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--viewer-muted)] mt-1">
                  {provider === 'spotify'
                    ? 'Закажи любимый трек напрямую в очередь Spotify на стриме'
                    : 'Любимые видео и музыка с YouTube — скоро на стриме'}
                </p>
              </div>
            </div>

            <div className="w-full sm:w-auto sm:shrink-0 flex items-center justify-between sm:justify-end gap-3 whitespace-nowrap bg-[var(--viewer-surface)] px-4 py-2.5 rounded-2xl border border-[var(--viewer-divider)]">
              <span className="text-xs text-[var(--viewer-muted)]">Очередь ожидания:</span>
              <span
                className={`text-sm font-bold ${
                  isQueueFull ? 'text-[var(--viewer-danger)]' : 'text-[var(--viewer-text)]'
                }`}
              >
                {pendingCount} / {maxQueueSize}
              </span>
            </div>
          </div>

          {/* Карточка 2: Живой поиск и заказ (Левая основная колонка) */}
          <div className="lg:col-span-7 self-start rounded-3xl bg-[var(--viewer-panel)] border border-[var(--viewer-panel-border)] p-6 flex flex-col relative z-10">
            <div>
              <h2 id="music-order-heading" className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[var(--viewer-accent)]" />
                Заказать музыку
              </h2>

              <div className="viewer-provider-switch" role="group" aria-label="Источник музыки">
                {(['spotify', 'youtube'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="viewer-provider-button"
                    data-provider={option}
                    aria-pressed={provider === option}
                    aria-controls="music-order-form"
                    disabled={submitting}
                    onClick={() => switchProvider(option)}
                  >
                    <ProviderIcon provider={option} className="w-5 h-5" />
                    {MUSIC_PROVIDER_NAMES[option]}
                    {option === 'youtube' && <span className="viewer-soon">Скоро</span>}
                  </button>
                ))}
              </div>

              <div key={provider} id="music-order-form" className="viewer-order-content relative z-10" role="region" aria-labelledby="music-order-heading">

              {/* Блокировки если закрыто или очередь полная */}
                {provider === 'spotify' && isLoadingOrder ? (
                <div className="space-y-4" role="status" aria-label="Загружаем настройки заказов">
                  <div className="h-12 rounded-2xl bg-[var(--viewer-surface)] border border-[var(--viewer-panel-border)]" />
                  <div className="h-11 rounded-2xl bg-[var(--viewer-surface)] border border-[var(--viewer-panel-border)]" />
                </div>
                ) : provider === 'spotify' && !isAccepting ? (
                <div className="rounded-2xl bg-[var(--viewer-surface)] border border-[var(--viewer-panel-border)] p-6 text-center my-4">
                  <AlertCircle className="w-8 h-8 text-[var(--viewer-muted)] mx-auto mb-2" />
                  <p className="font-medium text-[var(--viewer-text)]">{settingsError || liveStatus === 'unknown' ? 'Не удалось проверить приём заказов' : 'Прием заказов сейчас приостановлен'}</p>
                  <p className="text-xs text-[var(--viewer-muted)] mt-1">
                    {settingsError || liveStatus === 'unknown' ? 'Проверь соединение и попробуй ещё раз' : 'Подожди, пока стример снова откроет очередь'}
                  </p>
                </div>
                ) : provider === 'spotify' && isQueueFull ? (
                <div className="rounded-2xl bg-[var(--viewer-danger-soft)] border border-[var(--viewer-danger-border)] p-6 text-center my-4">
                  <AlertCircle className="w-8 h-8 text-[var(--viewer-danger)] mx-auto mb-2" />
                  <p className="font-medium text-[var(--viewer-text)]">
                    Очередь заполнена. Новые заказы откроются по мере воспроизведения
                  </p>
                </div>
              ) : (
                <>
                  {/* Поиск или Выбранный трек */}
                  {!selectedTrack ? (
                    <div className="relative">
                      <div className="relative flex items-center">
                        <Search className="w-5 h-5 text-[var(--viewer-muted)] absolute left-4 pointer-events-none" />
                        <input
                          type="text"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          disabled={provider === 'youtube'}
                          aria-label={provider === 'spotify' ? 'Название трека или исполнитель в Spotify' : 'Ссылка на видео YouTube'}
                          placeholder={provider === 'spotify' ? 'Название трека или исполнитель...' : 'Ссылка на видео YouTube'}
                          className="w-full min-h-[48px] pl-12 pr-10 py-3 rounded-2xl bg-[var(--viewer-input)] border border-[var(--viewer-input-border)] text-[var(--viewer-text)] placeholder-[var(--viewer-muted)] text-sm focus:outline-none focus:border-[var(--viewer-accent)] transition"
                        />
                        {isSearching && (
                          <Loader2 className="w-4 h-4 text-[var(--viewer-accent)] animate-spin absolute right-4" />
                        )}
                      </div>

                      {provider === 'youtube' && (
                        <div className="mt-3 rounded-2xl bg-[var(--viewer-accent-soft)] border border-[var(--viewer-accent-border)] p-4 flex items-start gap-3">
                          <ProviderIcon provider="youtube" className="w-6 h-6 text-[var(--viewer-accent)] shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-semibold">Готовим заказы с YouTube</p>
                            <p className="text-xs text-[var(--viewer-muted)] mt-1 leading-relaxed">
                              Скоро здесь можно будет отправить ссылку на видео. Пока любимые треки можно заказать через Spotify.
                            </p>
                          </div>
                        </div>
                      )}

                      {searchError && (
                        <p role="status" className="mt-3 text-xs text-[var(--viewer-danger)]">
                          {searchError}
                        </p>
                      )}

                      {/* Выпадающий список результатов (Без тяжелых картинок) */}
                      {results.length > 0 && (
                        <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-[var(--viewer-dropdown)] border border-[var(--viewer-input-border)] shadow-2xl overflow-hidden z-50 max-h-80 overflow-y-auto divide-y divide-[var(--viewer-divider)]">
                          {results.map((track) => (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => {
                                setSelectedTrack(track);
                                setSearch(EMPTY_SEARCH);
                                setFeedback(null);
                              }}
                              className="w-full p-3 flex items-center gap-3.5 hover:bg-[var(--viewer-hover)] active:bg-[var(--viewer-hover)] transition text-left"
                            >
                              <div className="w-11 h-11 rounded-xl bg-[var(--viewer-accent-soft)] border border-[var(--viewer-accent-border)] flex items-center justify-center text-[var(--viewer-accent)] shrink-0">
                                <Music className="w-5 h-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-[var(--viewer-text)] truncate">
                                    {track.name}
                                  </p>
                                  {track.isExplicit && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--viewer-danger-soft)] text-[var(--viewer-danger)] border border-[var(--viewer-danger-border)] shrink-0">
                                      E
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-[var(--viewer-muted)] truncate mt-0.5">
                                  {track.artist}
                                </p>
                              </div>
                              <span className="text-xs font-mono text-[var(--viewer-muted)] shrink-0">
                                {formatDuration(track.durationMs)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Карточка выбранного трека (Без картинки) */
                    <div className="rounded-2xl bg-[var(--viewer-accent-soft)] border border-[var(--viewer-accent-border)] p-3.5 flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[var(--viewer-accent-strong)] border border-[var(--viewer-accent-border-strong)] flex items-center justify-center text-[var(--viewer-accent)] shrink-0">
                        <Music className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-[var(--viewer-text)] truncate">
                            {selectedTrack.name}
                          </p>
                          {selectedTrack.isExplicit && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#E91429] text-white shrink-0">
                              E
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--viewer-muted)] truncate mt-0.5">
                          {selectedTrack.artist} • {formatDuration(selectedTrack.durationMs)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedTrack(null)}
                        className="w-9 h-9 rounded-xl bg-[var(--viewer-input)] hover:bg-[var(--viewer-hover)] flex items-center justify-center text-[var(--viewer-muted)] hover:text-[var(--viewer-text)] transition shrink-0"
                        title="Сбросить выбор"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Поле никнейма */}
                  <div className="mt-4">
                    <div className="relative flex items-center">
                      <User className="w-4 h-4 text-[var(--viewer-muted)] absolute left-4 pointer-events-none" />
                      <input
                        type="text"
                        maxLength={24}
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        placeholder="Твой никнейм (необязательно)"
                        className="w-full min-h-[44px] pl-11 pr-4 py-2.5 rounded-2xl bg-[var(--viewer-input)] border border-[var(--viewer-panel-border)] text-[var(--viewer-text)] placeholder-[var(--viewer-muted)] text-sm focus:outline-none focus:border-[var(--viewer-accent)] transition"
                      />
                    </div>
                  </div>

                  {/* Ошибка валидации */}
                  {validationError && (
                    <div className="mt-4 rounded-2xl bg-[var(--viewer-danger-soft)] border border-[var(--viewer-danger-border)] px-4 py-3 flex items-center gap-2.5 text-xs text-[var(--viewer-danger)]">
                      <ShieldAlert className="w-4 h-4 text-[var(--viewer-danger)] shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}
                </>
              )}

              </div>

              {/* Уведомление об отправке */}
              {feedback && (
                <div
                  className={`mt-4 rounded-2xl px-4 py-3 flex items-center gap-2.5 text-xs border ${
                    feedback.type === 'success'
                      ? 'bg-[var(--viewer-success-soft)] border-[var(--viewer-success-border)] text-[var(--viewer-success)]'
                      : 'bg-[var(--viewer-danger-soft)] border-[var(--viewer-danger-border)] text-[var(--viewer-danger)]'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}
            </div>

            {/* Кнопка отправки */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                provider === 'youtube' ||
                !selectedTrack ||
                Boolean(validationError) ||
                cooldownLeft > 0 ||
                submitting ||
                !isAccepting ||
                isQueueFull
              }
              className="mt-6 w-full min-h-[48px] rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition shadow-lg disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--viewer-accent)] hover:bg-[var(--viewer-accent-hover)] text-[var(--viewer-on-accent)] cursor-pointer"
            >
              {provider === 'youtube' ? (
                <>
                  <ProviderIcon provider="youtube" className="w-5 h-5" />
                  Заказы с YouTube скоро откроются
                </>
              ) : submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Отправляем...
                </>
              ) : cooldownLeft > 0 ? (
                <>
                  <Clock className="w-4 h-4" />
                  Следующий заказ через {Math.floor(cooldownLeft / 60)}:
                  {(cooldownLeft % 60).toString().padStart(2, '0')}
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Заказать трек
                </>
              )}
            </button>
          </div>

          {/* Правая колонка: Правила + Виджет очереди */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Карточка 3: Правила стрима */}
            <div className="rounded-3xl bg-[var(--viewer-panel)] border border-[var(--viewer-panel-border)] p-6">
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[var(--viewer-accent)]" />
                Правила заказа музыки
              </h2>
              <div className="text-xs text-[var(--viewer-muted)] whitespace-pre-line leading-relaxed">
                {settings?.rules_text ||
                  '1. Без треков с бан-вордами Twitch/YouTube.\n2. Без скримеров, бассбуста и троллинга.\n3. Соблюдайте лимит по времени трека.'}
              </div>
            </div>

            <ViewerStreamPanel onLiveStatus={setLiveStatus} />
          </div>
        </div>
      </div>
    </div>
  );
}
