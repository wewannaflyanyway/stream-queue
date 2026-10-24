'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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
  ListMusic,
  Send,
  Loader2,
} from 'lucide-react';

interface Track {
  id: string;
  uri: string;
  name: string;
  artist: string;
  albumCover: string;
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

interface SongRequest {
  id: string;
  created_at: string;
  track_name: string;
  artist_name: string;
  album_cover_url: string;
  spotify_uri: string;
  duration_ms: number;
  is_explicit: boolean;
  sender_name: string;
  status: 'pending' | 'approved' | 'rejected' | 'played';
}

function formatDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ViewerPage() {
  const [settings, setSettings] = useState<StreamSettings | null>(null);
  const [queue, setQueue] = useState<SongRequest[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [senderName, setSenderName] = useState('');
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 1. Загрузка имени и кулдауна из localStorage
  useEffect(() => {
    const savedName = localStorage.getItem('viewer_name');
    if (savedName) setSenderName(savedName);

    const checkCooldown = () => {
      const until = Number(localStorage.getItem('cooldown_until') || '0');
      const diff = Math.ceil((until - Date.now()) / 1000);
      setCooldownLeft(diff > 0 ? diff : 0);
    };

    checkCooldown();
    const timer = setInterval(checkCooldown, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Загрузка данных из Supabase + Realtime подписка
  useEffect(() => {
    const fetchInitialData = async () => {
      const { data: sData } = await supabase
        .from('stream_settings')
        .select('*')
        .eq('id', 1)
        .single();
      if (sData) setSettings(sData);

      const { data: qData } = await supabase
        .from('song_requests')
        .select('*')
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(20);
      if (qData) setQueue(qData);
    };

    fetchInitialData();

    const channel = supabase
      .channel('public-viewer-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stream_settings' },
        (payload) => {
          if (payload.new) setSettings(payload.new as StreamSettings);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'song_requests' },
        async () => {
          const { data: qData } = await supabase
            .from('song_requests')
            .select('*')
            .in('status', ['pending', 'approved'])
            .order('created_at', { ascending: false })
            .limit(20);
          if (qData) setQueue(qData);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 3. Дебаунс-поиск по Spotify (450 мс) с отменой устаревших запросов и таймаутом
  useEffect(() => {
    const trimmed = query.trim();
    if (selectedTrack || trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);

    const handler = setTimeout(async () => {
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(trimmed)}&t=${Date.now()}`,
          { signal: controller.signal, cache: 'no-store' }
        );
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (!controller.signal.aborted) {
          setResults(data.tracks || []);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (!controller.signal.aborted && err?.name !== 'AbortError') {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 450);

    return () => {
      clearTimeout(handler);
      controller.abort();
    };
  }, [query, selectedTrack]);

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

  const pendingCount = queue.filter((r) => r.status === 'pending').length;
  const maxQueueSize = settings?.max_queue_size || 15;
  const isQueueFull = pendingCount >= maxQueueSize;
  const isAccepting = settings?.is_accepting ?? true;
  const validationError = getValidationError(selectedTrack);

  // 5. Отправка трека
  const handleSubmit = async () => {
    if (!selectedTrack || validationError || cooldownLeft > 0 || !isAccepting || isQueueFull) return;

    setSubmitting(true);
    setFeedback(null);

    const cleanName = senderName.trim().slice(0, 24);
    localStorage.setItem('viewer_name', cleanName);

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_name: selectedTrack.name,
          artist_name: selectedTrack.artist,
          album_cover_url: selectedTrack.albumCover,
          spotify_uri: selectedTrack.uri,
          duration_ms: selectedTrack.durationMs,
          is_explicit: selectedTrack.isExplicit,
          sender_name: cleanName || 'Аноним',
          source: 'web',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Ошибка отправки заявки' });
      } else {
        const cdSec = settings?.cooldown_user_sec ?? 300;
        if (cdSec > 0) {
          localStorage.setItem('cooldown_until', String(Date.now() + cdSec * 1000));
          setCooldownLeft(cdSec);
        }
        setSelectedTrack(null);
        setQuery('');
        setFeedback({
          type: 'success',
          text:
            data.status === 'approved'
              ? 'Трек мгновенно добавлен в очередь Spotify стримера!'
              : 'Заявка отправлена! Ожидай подтверждения стримером.',
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Сетевая ошибка при отправке' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#05180f] via-[#0c100e] to-[#121212] text-white font-sans selection:bg-[#1DB954] selection:text-black">
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Карточка 1: Статус стрима (На всю ширину сверху) */}
          <div className="lg:col-span-12 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#1DB954]/15 border border-[#1DB954]/30 flex items-center justify-center text-[#1DB954] shrink-0">
                <Music className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                    wewannaflyanyway • Music
                  </h1>
                  {isAccepting ? (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#1DB954]/15 text-[#1DB954] border border-[#1DB954]/30">
                      <span className="w-2 h-2 rounded-full bg-[#1DB954] animate-pulse" />
                      Прием треков открыт
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-[#A7A7A7] border border-white/10">
                      <span className="w-2 h-2 rounded-full bg-[#A7A7A7]" />
                      Прием музыки закрыт
                    </span>
                  )}
                </div>
                <p className="text-sm text-[#A7A7A7] mt-1">
                  Закажи любимый трек напрямую в очередь Spotify на стриме
                </p>
              </div>
            </div>

            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 bg-black/30 px-4 py-2.5 rounded-2xl border border-white/[0.06]">
              <span className="text-xs text-[#A7A7A7]">Очередь ожидания:</span>
              <span
                className={`text-sm font-bold ${
                  isQueueFull ? 'text-[#E91429]' : 'text-white'
                }`}
              >
                В очереди: {pendingCount} / {maxQueueSize}
              </span>
            </div>
          </div>

          {/* Карточка 2: Живой поиск и заказ (Левая основная колонка) */}
          <div className="lg:col-span-7 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6 flex flex-col justify-between relative">
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#1DB954]" />
                Заказать музыку
              </h2>

              {/* Блокировки если закрыто или очередь полная */}
              {!isAccepting ? (
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 text-center my-4">
                  <AlertCircle className="w-8 h-8 text-[#A7A7A7] mx-auto mb-2" />
                  <p className="font-medium text-white">Прием заказов сейчас приостановлен</p>
                  <p className="text-xs text-[#A7A7A7] mt-1">
                    Подожди, пока стример снова откроет очередь
                  </p>
                </div>
              ) : isQueueFull ? (
                <div className="rounded-2xl bg-[#E91429]/10 border border-[#E91429]/30 p-6 text-center my-4">
                  <AlertCircle className="w-8 h-8 text-[#E91429] mx-auto mb-2" />
                  <p className="font-medium text-white">
                    Очередь заполнена. Новые заказы откроются по мере воспроизведения
                  </p>
                </div>
              ) : (
                <>
                  {/* Поиск или Выбранный трек */}
                  {!selectedTrack ? (
                    <div className="relative">
                      <div className="relative flex items-center">
                        <Search className="w-5 h-5 text-[#A7A7A7] absolute left-4 pointer-events-none" />
                        <input
                          type="text"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Название трека или исполнитель..."
                          className="w-full min-h-[48px] pl-12 pr-10 py-3 rounded-2xl bg-black/40 border border-white/[0.1] text-white placeholder-[#A7A7A7] text-sm focus:outline-none focus:border-[#1DB954] transition"
                        />
                        {isSearching && (
                          <Loader2 className="w-4 h-4 text-[#1DB954] animate-spin absolute right-4" />
                        )}
                      </div>

                      {/* Выпадающий список результатов (Без тяжелых картинок) */}
                      {results.length > 0 && (
                        <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-[#161917] border border-white/[0.12] shadow-2xl overflow-hidden z-50 max-h-80 overflow-y-auto divide-y divide-white/[0.06]">
                          {results.map((track) => (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => {
                                setSelectedTrack(track);
                                setResults([]);
                                setFeedback(null);
                              }}
                              className="w-full p-3 flex items-center gap-3.5 hover:bg-white/[0.06] active:bg-white/[0.1] transition text-left"
                            >
                              <div className="w-11 h-11 rounded-xl bg-[#1DB954]/10 border border-[#1DB954]/20 flex items-center justify-center text-[#1DB954] shrink-0">
                                <Music className="w-5 h-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-white truncate">
                                    {track.name}
                                  </p>
                                  {track.isExplicit && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#E91429]/20 text-[#E91429] border border-[#E91429]/40 shrink-0">
                                      E
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-[#A7A7A7] truncate mt-0.5">
                                  {track.artist}
                                </p>
                              </div>
                              <span className="text-xs font-mono text-[#A7A7A7] shrink-0">
                                {formatDuration(track.durationMs)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Карточка выбранного трека (Без картинки) */
                    <div className="rounded-2xl bg-[#1DB954]/10 border border-[#1DB954]/30 p-3.5 flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#1DB954]/20 border border-[#1DB954]/40 flex items-center justify-center text-[#1DB954] shrink-0">
                        <Music className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-white truncate">
                            {selectedTrack.name}
                          </p>
                          {selectedTrack.isExplicit && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#E91429] text-white shrink-0">
                              E
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#A7A7A7] truncate mt-0.5">
                          {selectedTrack.artist} • {formatDuration(selectedTrack.durationMs)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedTrack(null)}
                        className="w-9 h-9 rounded-xl bg-black/40 hover:bg-black/60 flex items-center justify-center text-[#A7A7A7] hover:text-white transition shrink-0"
                        title="Сбросить выбор"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Поле никнейма */}
                  <div className="mt-4">
                    <div className="relative flex items-center">
                      <User className="w-4 h-4 text-[#A7A7A7] absolute left-4 pointer-events-none" />
                      <input
                        type="text"
                        maxLength={24}
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        placeholder="Твой никнейм (необязательно)"
                        className="w-full min-h-[44px] pl-11 pr-4 py-2.5 rounded-2xl bg-black/40 border border-white/[0.08] text-white placeholder-[#A7A7A7] text-sm focus:outline-none focus:border-[#1DB954] transition"
                      />
                    </div>
                  </div>

                  {/* Ошибка валидации */}
                  {validationError && (
                    <div className="mt-4 rounded-2xl bg-[#E91429]/15 border border-[#E91429]/40 px-4 py-3 flex items-center gap-2.5 text-xs text-[#ff6b78]">
                      <ShieldAlert className="w-4 h-4 text-[#E91429] shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}
                </>
              )}

              {/* Уведомление об отправке */}
              {feedback && (
                <div
                  className={`mt-4 rounded-2xl px-4 py-3 flex items-center gap-2.5 text-xs border ${
                    feedback.type === 'success'
                      ? 'bg-[#1DB954]/15 border-[#1DB954]/40 text-[#1ed760]'
                      : 'bg-[#E91429]/15 border-[#E91429]/40 text-[#ff6b78]'
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
                !selectedTrack ||
                Boolean(validationError) ||
                cooldownLeft > 0 ||
                submitting ||
                !isAccepting ||
                isQueueFull
              }
              className="mt-6 w-full min-h-[48px] rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition shadow-lg disabled:opacity-40 disabled:cursor-not-allowed bg-[#1DB954] hover:bg-[#1ed760] text-black cursor-pointer"
            >
              {submitting ? (
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
            <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6">
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#1DB954]" />
                Правила заказа музыки
              </h2>
              <div className="text-xs text-[#A7A7A7] whitespace-pre-line leading-relaxed">
                {settings?.rules_text ||
                  '1. Без треков с бан-вордами Twitch/YouTube.\n2. Без скримеров, бассбуста и троллинга.\n3. Соблюдайте лимит по времени трека.'}
              </div>
            </div>

            {/* Карточка 4: Текущие заявки (Без картинок) */}
            <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6 flex-1">
              <h2 className="text-base font-semibold mb-3.5 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ListMusic className="w-4 h-4 text-[#1DB954]" />
                  Ближайшие заявки
                </span>
                <span className="text-xs font-normal text-[#A7A7A7]">Live</span>
              </h2>

              {queue.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#A7A7A7]">
                  В очереди пока пусто — будь первым!
                </div>
              ) : (
                <div className="space-y-2.5">
                  {queue.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-2xl bg-black/30 border border-white/[0.05] flex items-center gap-3"
                    >
                      <div className="w-10 h-10 rounded-xl bg-[#1DB954]/10 border border-[#1DB954]/20 flex items-center justify-center text-[#1DB954] shrink-0">
                        <Music className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate">
                          {item.track_name}
                        </p>
                        <p className="text-[11px] text-[#A7A7A7] truncate">
                          {item.artist_name} • от {item.sender_name}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${
                          item.status === 'approved'
                            ? 'bg-[#1DB954]/15 text-[#1DB954] border border-[#1DB954]/30'
                            : 'bg-white/10 text-[#A7A7A7]'
                        }`}
                      >
                        {item.status === 'approved' ? 'В плеере' : 'Ждет'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}