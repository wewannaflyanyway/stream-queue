'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PollsPanel } from '@/components/polls/polls-panel';
import {
  Check,
  X,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  Settings,
  History,
  ListMusic,
  Copy,
  Lock,
  Sparkles,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

function formatDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(dateStr: string) {
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diffSec < 45) return 'только что';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} мин назад`;
  const hrs = Math.floor(min / 60);
  return `${hrs} ч назад`;
}

interface AdminSettings {
  is_accepting: boolean; auto_approve: boolean; sound_alerts: boolean; cooldown_user_sec: number;
  max_duration_sec: number; max_queue_size: number; prevent_duplicates: boolean; duplicate_cooldown_min: number;
  explicit_mode: string; banned_words: string; banned_artists: string; rules_text: string;
  widget_bg_color: string; widget_text_color: string; widget_accent_color: string; widget_opacity: number;
  widget_custom_image: string; widget_show_eq: boolean;
}
interface AdminRequest {
  id: string; created_at: string; track_name: string; artist_name: string; spotify_uri: string;
  duration_ms: number; is_explicit: boolean; sender_name: string; source: string; status: string;
  stream_session_id: string | null; stream_history_hidden: boolean; stream_pending_archived: boolean;
  enqueue_claim?: { state: string; claimed_at: string; reviewable: boolean } | null;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Не удалось выполнить действие.'; }

// Мягкий звуковой сигнал (Web Audio API синусоида 800 Гц)
function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Игнорируем если браузер заблокировал автозвук
  }
}

export default function AdminPage() {
  const [pin, setPin] = useState('');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authError, setAuthError] = useState('');

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [streamState, setStreamState] = useState<{ online: boolean; automationEnabled: boolean; sessionId: string | null; connectionHealthy: boolean; verified: boolean; musicCommandsEnabled: boolean; chatWriteGranted: boolean } | null>(null);
  const [streamBusy, setStreamBusy] = useState(false);
  const [streamSessions, setStreamSessions] = useState<{ id: string; started_at: string; ended_at: string | null }[]>([]);
  const [historySession, setHistorySession] = useState('current');
  const [activeTab, setActiveTab] = useState<'queue' | 'history' | 'settings' | 'widget' | 'polls'>('queue');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const soundEnabledRef = useRef(true);
  const knownPendingRef = useRef<Set<string> | null>(null);

  const showToast = (text: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  const verifyPinCode = useCallback(async (codeToTest: string) => {
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: codeToTest, action: 'verify_pin' }),
      });
      if (res.ok) {
        setPin('');
        setIsAuthorized(true);
        if (new URLSearchParams(window.location.search).has('polls')) setActiveTab('polls');
      } else {
        const data = await res.json().catch(() => ({}));
        setAuthError(data.error || 'Неверный PIN-код');
      }
    } catch {
      setAuthError('Ошибка соединения с сервером');
    }
  }, []);

  // Restore the HttpOnly admin session; remove PINs saved by older versions.
  useEffect(() => {
    sessionStorage.removeItem('admin_pin');
    void fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify_session' }) })
      .then(response => { if (response.ok) { setIsAuthorized(true); if (new URLSearchParams(window.location.search).has('polls')) setActiveTab('polls'); } })
      .catch(() => {});
  }, []);

  // Admin data is loaded through the authenticated server endpoint.
  useEffect(() => {
    if (!isAuthorized) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_data', payload: { sessionId: historySession === 'current' ? null : historySession, includeHistory: activeTab === 'history' } }), signal: AbortSignal.timeout(8000) });
        if (response.status === 401) { if (!stopped) { setIsAuthorized(false); setAuthError('Сессия истекла. Войди снова.'); } return; }
        if (!response.ok) throw new Error('Не удалось загрузить заявки.');
        const data = await response.json();
        if (stopped) return;
        const pending = new Set<string>(data.requests.filter((item: { status: string; stream_pending_archived: boolean }) => item.status === 'pending' && !item.stream_pending_archived).map((item: { id: string }) => item.id));
        if (knownPendingRef.current && [...pending].some(id => !knownPendingRef.current!.has(id)) && soundEnabledRef.current) playNotificationChime();
        knownPendingRef.current = pending;
        setRequests(data.requests);
        setSettings(previous => activeTab === 'settings' || activeTab === 'widget' ? previous || data.settings : data.settings);
        if (activeTab !== 'settings' && activeTab !== 'widget') soundEnabledRef.current = data.settings.sound_alerts;
      } catch { /* Keep the last successful data until the next retry. */ }
      finally { if (!stopped) timer = setTimeout(refresh, activeTab === 'history' ? 15000 : 5000); }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [isAuthorized, historySession, activeTab, streamState?.sessionId]);

  useEffect(() => {
    if (!isAuthorized) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stream_status' }), signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const data = await response.json();
          if (!stopped) setStreamState(data.stream);
        } else if (!stopped) {
          setStreamState(previous => previous && { ...previous, verified: false });
        }
      } catch { if (!stopped) setStreamState(previous => previous && { ...previous, verified: false }); }
      finally { if (!stopped) timer = setTimeout(refresh, 15000); }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [isAuthorized]);

  useEffect(() => {
    if (!isAuthorized || activeTab !== 'history' || !streamState?.automationEnabled) return;
    let cancelled = false;
    void fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stream_sessions' }), signal: AbortSignal.timeout(8000) })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!cancelled && data) setStreamSessions(data.sessions); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthorized, activeTab, streamState?.automationEnabled, streamState?.sessionId]);

  // Универсальный вызов API админки
  const callAdminApi = async (action: string, payload: unknown = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), action === 'stream_enable' ? 60000 : 8000);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (res.status === 401) { setIsAuthorized(false); setAuthError('Сессия истекла. Войди снова.'); }
      if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
      return data;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Сервер долго не отвечает (таймаут 8 сек). Попробуй ещё раз.');
      }
      throw err;
    }
  };

  // Быстрые тумблеры в шапке
  const toggleQuickSetting = async (key: 'is_accepting' | 'sound_alerts' | 'auto_approve', current: boolean | undefined) => {
    const currentVal = Boolean(current);
    const nextVal = !currentVal;
    setSettings(prev => prev ? { ...prev, [key]: nextVal } : prev);
    if (key === 'sound_alerts') soundEnabledRef.current = nextVal;
    try {
      const result = await callAdminApi(key === 'is_accepting' ? 'set_accepting' : 'update_settings', { [key]: nextVal });
      if (key === 'is_accepting') setSettings(prev => prev ? { ...prev, is_accepting: result.is_accepting } : prev);
    } catch (e: unknown) {
      setSettings(prev => prev ? { ...prev, [key]: currentVal } : prev);
      if (key === 'sound_alerts') soundEnabledRef.current = currentVal;
      showToast(errorText(e), 'err');
    }
  };

  // Одобрить трек (с мгновенным скрытием из очереди)
  const handleApprove = async (reqItem: AdminRequest) => {
    setLoadingId(reqItem.id);
    const previousRequests = [...requests];
    
    // Мгновенно переводим трек в статус approved на экране, не дожидаясь ответа сервера
    setRequests((prev) =>
      prev.map((r) => (r.id === reqItem.id ? { ...r, status: 'approved' } : r))
    );

    try {
      await callAdminApi('approve', { id: reqItem.id, spotify_uri: reqItem.spotify_uri });
      showToast(`Добавлено в Spotify: ${reqItem.track_name}`);
    } catch (e: unknown) {
      // Если произошла ошибка — возвращаем карточку обратно в очередь
      setRequests(previousRequests);
      showToast(errorText(e), 'err');
    } finally {
      setLoadingId(null);
    }
  };

  // Отклонить трек (с мгновенным скрытием из очереди)
  const handleReject = async (id: string) => {
    setLoadingId(id);
    const previousRequests = [...requests];

    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'rejected' } : r))
    );

    try {
      await callAdminApi('reject', { id });
      showToast('Заявка отклонена');
    } catch (e: unknown) {
      setRequests(previousRequests);
      showToast(errorText(e), 'err');
    } finally {
      setLoadingId(null);
    }
  };

  const handleResolveEnqueue = async (id: string, outcome: 'queued' | 'retry') => {
    const message = outcome === 'queued' ? 'Ты проверил очередь Spotify и этот трек уже в ней?' : 'Ты проверил очередь Spotify и этого трека в ней нет? После этого его можно будет отправить повторно.';
    if (!confirm(message)) return;
    setLoadingId(id);
    try {
      await callAdminApi('resolve_enqueue', { id, outcome });
      setRequests(prev => prev.map(item => item.id === id ? { ...item, enqueue_claim: null, status: outcome === 'queued' ? 'approved' : item.status } : item));
      showToast(outcome === 'queued' ? 'Заявка отмечена как добавленная' : 'Заявку можно одобрить повторно');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось обновить заявку.', 'err'); }
    finally { setLoadingId(null); }
  };

  // Скип трека в Spotify
  const handleSkip = async () => {
    try {
      await callAdminApi('skip');
      showToast('Трек в Spotify переключен (Skip)');
    } catch (e: unknown) {
      showToast(errorText(e), 'err');
    }
  };
  
  // Panic Button: Очистить очередь (с мгновенным скрытием)
  const handleClearQueue = async () => {
    if (!confirm('Точно отклонить ВСЕ ожидающие треки в очереди?')) return;
    const previousRequests = [...requests];
    setRequests((prev) => prev.map((r) => (r.status === 'pending' && !r.stream_pending_archived ? { ...r, status: 'rejected' } : r)));
    try {
      await callAdminApi('clear_queue');
      showToast('Очередь ожидания очищена');
    } catch (e: unknown) {
      setRequests(previousRequests);
      showToast(errorText(e), 'err');
    }
  };

  // Очистить историю
  const handleClearHistory = async () => {
    if (!confirm(streamState?.automationEnabled ? 'Скрыть историю текущего стрима? Записи и очередь сохранятся.' : 'Точно удалить всю историю одобренных и отклоненных треков? Это действие необратимо.')) return;
    try {
      await callAdminApi('clear_history');
      showToast(streamState?.automationEnabled ? 'История текущего стрима скрыта' : 'История полностью очищена');
      setRequests((prev) => prev.filter((r) => r.status === 'pending' || (streamState?.automationEnabled && r.stream_session_id !== streamState.sessionId)));
    } catch (e: unknown) {
      showToast(errorText(e), 'err');
    }
  };

  // Экспорт плейлиста
  const handleExportPlaylist = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/admin/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: streamState?.automationEnabled ? (historySession === 'current' ? streamState.sessionId : historySession) : null }) });
      const data = await res.json();
      if (res.ok && data.url) {
        showToast('Плейлист успешно создан!');
        window.open(data.url, '_blank');
      } else {
        showToast('Ошибка: ' + (data.error || 'Неизвестная ошибка'), 'err');
      }
    } catch {
      showToast('Сбой при экспорте', 'err');
    } finally {
      setIsExporting(false);
    }
  };

  // Сохранение всех настроек
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await callAdminApi('update_settings', settings);
      showToast('Настройки стрима успешно сохранены!');
    } catch (err: unknown) {
      showToast(errorText(err), 'err');
    }
  };

  // Экран ввода PIN-кода
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#05180f] to-[#121212] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#1DB954]/15 border border-[#1DB954]/30 flex items-center justify-center text-[#1DB954] mx-auto mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold mb-1">Панель стримера</h1>
          <p className="text-xs text-[#A7A7A7] mb-6">Введи секретный ADMIN_PIN для доступа</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyPinCode(pin);
            }}
            className="space-y-4"
          >
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="w-full text-center text-lg tracking-widest py-3 rounded-2xl bg-black/40 border border-white/[0.1] focus:outline-none focus:border-[#1DB954]"
              autoFocus
            />
            {authError && <p className="text-xs text-[#E91429]">{authError}</p>}
            <button
              type="submit"
              className="w-full py-3 rounded-2xl bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold text-sm transition cursor-pointer"
            >
              Войти в пульт
            </button>
          </form>
        </div>
      </div>
    );
  }

  const pendingList = requests.filter((r) => r.status === 'pending' && !r.stream_pending_archived);
  const selectedSessionId = historySession === 'current' ? streamState?.sessionId : historySession;
  const approvedHistory = streamState ? requests.filter((r) => (['approved', 'played'].includes(r.status) || (streamState.automationEnabled && historySession !== 'current' && r.status === 'pending' && r.stream_pending_archived)) && (!streamState.automationEnabled || (selectedSessionId && r.stream_session_id === selectedSessionId && !r.stream_history_hidden))) : [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#05180f] via-[#0c100e] to-[#121212] text-white font-sans">
      {/* Всплывающий тост */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-medium flex items-center gap-2.5 ${
            toast.type === 'ok'
              ? 'bg-[#14291d] border-[#1DB954] text-white'
              : 'bg-[#2c1215] border-[#E91429] text-[#ff8a93]'
          }`}
        >
          {toast.type === 'err' && <AlertTriangle className="w-4 h-4 text-[#E91429] shrink-0" />}
          <span>{toast.text}</span>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Верхний пульт быстрых действий (Header Quick Actions) */}
        <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Тумблер 1: Прием заказов */}
            <button
              type="button"
              onClick={() => toggleQuickSetting('is_accepting', settings?.is_accepting)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
                settings?.is_accepting
                  ? 'bg-[#1DB954]/15 border-[#1DB954]/40 text-[#1DB954]'
                  : 'bg-white/5 border-white/10 text-[#A7A7A7]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  settings?.is_accepting ? 'bg-[#1DB954]' : 'bg-[#A7A7A7]'
                }`}
              />
              Прием заказов: {settings?.is_accepting ? 'ВКЛ' : 'ВЫКЛ'}
            </button>

            {/* Тумблер 2: Автодобавление */}
            <button
              type="button"
              onClick={() => toggleQuickSetting('auto_approve', settings?.auto_approve)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
                settings?.auto_approve
                  ? 'bg-[#1DB954]/15 border-[#1DB954]/40 text-[#1DB954]'
                  : 'bg-white/5 border-white/10 text-[#A7A7A7]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Автодобавление: {settings?.auto_approve ? 'ВКЛ' : 'ВЫКЛ'}
            </button>

            {/* Тумблер 3: Звук */}
            <button
              type="button"
              onClick={() => toggleQuickSetting('sound_alerts', settings?.sound_alerts)}
              className={`px-3.5 py-2.5 rounded-2xl text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
                settings?.sound_alerts
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-white/5 border-white/10 text-[#A7A7A7]'
              }`}
              title="Звуковой сигнал при новой заявке"
            >
              {settings?.sound_alerts ? (
                <Volume2 className="w-4 h-4 text-[#1DB954]" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
              Звук
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Скип трека */}
            <button
              type="button"
              onClick={handleSkip}
              className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold flex items-center gap-2 transition cursor-pointer"
            >
              <SkipForward className="w-4 h-4 text-[#1DB954]" />
              Скип трека
            </button>

            {/* Panic Button */}
            <button
              type="button"
              onClick={handleClearQueue}
              disabled={pendingList.length === 0}
              className="px-4 py-2.5 rounded-2xl bg-[#E91429]/15 hover:bg-[#E91429]/25 border border-[#E91429]/30 text-[#ff6b78] text-xs font-semibold flex items-center gap-2 transition disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              Очистить очередь
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">Стрим Twitch: {streamState?.automationEnabled ? !streamState.connectionHealthy ? 'подписка требует восстановления' : !streamState.verified ? 'не удалось проверить' : streamState.online ? 'в эфире' : 'не в эфире' : 'автоматическое управление выключено'}</p><p className="text-xs text-[#A7A7A7] mt-1">При обрыве до 30 минут история сохраняется. Заказы можно открыть вручную вне эфира; ручная пауза имеет приоритет.</p></div>
          <button type="button" disabled={streamBusy} onClick={async () => {
            setStreamBusy(true);
            try {
              await callAdminApi(streamState?.automationEnabled && streamState.connectionHealthy ? 'stream_disable' : 'stream_enable');
              const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stream_status' }) });
              if (response.ok) setStreamState((await response.json()).stream);
              const latest = await callAdminApi('read_data');
              if (latest.settings) setSettings(latest.settings);
              showToast(streamState?.automationEnabled && streamState.connectionHealthy ? 'Автоматическое управление выключено' : 'Автоматическое управление включено');
            } catch (e: unknown) { showToast(errorText(e), 'err'); }
            finally { setStreamBusy(false); }
          }} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold cursor-pointer disabled:opacity-50">{streamBusy ? 'Подключение…' : streamState?.automationEnabled ? streamState.connectionHealthy ? 'Выключить автоматику' : 'Восстановить подключение' : 'Включить автоматику Twitch'}</button>
        </div>

        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">Музыкальные команды Twitch: {streamState?.musicCommandsEnabled ? 'прямое подключение включено' : 'через Nightbot'}</p><p className="text-xs text-[#A7A7A7] mt-1">Перед включением переподключи Twitch во вкладке «Голосования» и отключи в Nightbot команды !sr, !song, !wrongsong и !очередь.</p></div>
          <button type="button" disabled={!streamState || streamBusy} onClick={async () => {
            if (!streamState) return;
            if (!streamState.musicCommandsEnabled && !streamState.chatWriteGranted) { setActiveTab('polls'); showToast('Переподключи Twitch и разреши отправку сообщений.', 'err'); return; }
            if (!streamState.musicCommandsEnabled && !confirm('Команды !sr, !song, !wrongsong и !очередь отключены в Nightbot? Иначе ответы будут дублироваться.')) return;
            setStreamBusy(true);
            try {
              await callAdminApi('chat_commands', { enabled: !streamState.musicCommandsEnabled });
              const result = await callAdminApi('stream_status');
              setStreamState(result.stream);
              showToast(streamState.musicCommandsEnabled ? 'Прямые команды выключены' : 'Прямые команды Twitch включены');
            } catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось изменить режим команд.', 'err'); }
            finally { setStreamBusy(false); }
          }} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold cursor-pointer disabled:opacity-50">{streamState?.musicCommandsEnabled ? 'Выключить прямые команды' : 'Включить прямые команды'}</button>
        </div>

        {/* Навигация по вкладкам */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'queue'
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/[0.04] text-[#A7A7A7] hover:text-white'
            }`}
          >
            <ListMusic className="w-4 h-4" />
            Очередь модерации ({pendingList.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/[0.04] text-[#A7A7A7] hover:text-white'
            }`}
          >
            <History className="w-4 h-4" />
            История стрима ({approvedHistory.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('widget')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'widget'
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/[0.04] text-[#A7A7A7] hover:text-white'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Виджет OBS
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/[0.04] text-[#A7A7A7] hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
            Настройки
          </button>
          <button type="button" onClick={() => setActiveTab('polls')} className={`px-5 py-2.5 rounded-2xl text-xs font-semibold self-start cursor-pointer ${activeTab === 'polls' ? 'bg-[#ad85ff] text-black' : 'bg-white/[0.04] text-[#A7A7A7] hover:text-white'}`}>
            Голосования
          </button>
        </div>
        {activeTab === 'polls' && <PollsPanel />}

        {/* ВКЛАДКА 1: ЖИВАЯ ОЧЕРЕДЬ (PENDING) */}
        {activeTab === 'queue' && (
          <div className="space-y-3">
            {pendingList.length === 0 ? (
              <div className="rounded-3xl bg-white/[0.04] border border-white/[0.08] p-12 text-center text-sm text-[#A7A7A7]">
                Новых заявок на модерации нет. Когда зритель закажет трек, он мгновенно появится здесь!
              </div>
            ) : (
              pendingList.map((item) => (
                <div
                  key={item.id}
                  className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition hover:border-white/[0.15]"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-14 h-14 rounded-2xl bg-[#1DB954]/10 border border-[#1DB954]/20 flex items-center justify-center text-[#1DB954] shrink-0">
                      <ListMusic className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-base text-white truncate">
                          {item.track_name}
                        </h3>
                        <span className="text-xs font-mono text-[#A7A7A7]">
                          {formatDuration(item.duration_ms)}
                        </span>
                        {item.is_explicit && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#E91429] text-white">
                            18+ Explicit
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-[10px] rounded-md bg-white/10 text-[#A7A7A7]">
                          {item.source === 'twitch_chat' || item.source === 'twitch' ? 'Twitch' : 'Сайт'}
                        </span>
                      </div>
                      <p className="text-sm text-[#A7A7A7] truncate mt-0.5">{item.artist_name}</p>
                      <p className="text-xs text-[#A7A7A7]/70 mt-1">
                        Заказал: <span className="text-white font-medium">{item.sender_name}</span> •{' '}
                        {timeAgo(item.created_at)}
                      </p>
                      {item.enqueue_claim && <p className="text-xs text-amber-300 mt-2">{!item.enqueue_claim.reviewable ? 'Отправляем в Spotify…' : 'Проверь очередь Spotify: подтверждение не получено.'}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(`${item.artist_name} - ${item.track_name}`);
                        showToast('Название скопировано в буфер');
                      }}
                      className="p-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-[#A7A7A7] hover:text-white transition cursor-pointer"
                      title="Скопировать название"
                    >
                      <Copy className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      disabled={loadingId === item.id || Boolean(item.enqueue_claim)}
                      onClick={() => handleReject(item.id)}
                      className="px-4 py-2.5 rounded-2xl bg-[#E91429]/15 hover:bg-[#E91429]/30 border border-[#E91429]/30 text-[#ff6b78] text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      Отклонить
                    </button>

                    {item.enqueue_claim?.reviewable && <>
                      <button type="button" disabled={loadingId === item.id} onClick={() => handleResolveEnqueue(item.id, 'queued')} className="px-3 py-2 rounded-xl bg-white/10 text-xs font-semibold cursor-pointer">Уже в Spotify</button>
                      <button type="button" disabled={loadingId === item.id} onClick={() => handleResolveEnqueue(item.id, 'retry')} className="px-3 py-2 rounded-xl bg-white/10 text-xs font-semibold cursor-pointer">Нет в Spotify</button>
                    </>}
                    <button
                      type="button"
                      disabled={loadingId === item.id || Boolean(item.enqueue_claim)}
                      onClick={() => handleApprove(item)}
                      className="px-5 py-2.5 rounded-2xl bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      {loadingId === item.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      Одобрить
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

       {/* ВКЛАДКА 2: ИСТОРИЯ СТРИМА */}
        {activeTab === 'history' && (
          <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] overflow-hidden">
            {streamState?.automationEnabled && <label className="flex items-center gap-3 px-5 pt-5 text-xs text-[#A7A7A7]">Период<select value={historySession} onChange={e => setHistorySession(e.target.value)} className="rounded-xl bg-[#1d1d1d] border border-white/10 px-3 py-2 text-white"><option value="current">Текущий / последний стрим</option>{streamSessions.filter(session => session.id !== streamState.sessionId).map(session => <option key={session.id} value={session.id}>{new Date(session.started_at).toLocaleString('ru-RU')}</option>)}</select></label>}
            {/* Шапка с кнопкой очистки и экспорта */}
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-black/20">
              <span className="text-sm font-semibold text-white">Управление историей</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportPlaylist}
                  disabled={isExporting || !approvedHistory.some(item => ['approved', 'played'].includes(item.status))}
                  className="px-3 py-1.5 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
                >
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListMusic className="w-3.5 h-3.5" />}
                  {isExporting ? 'Создаем...' : 'Экспорт в плейлист'}
                </button>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  disabled={approvedHistory.length === 0 || (streamState?.automationEnabled && historySession !== 'current')}
                  className="px-3 py-1.5 rounded-xl bg-[#E91429]/15 hover:bg-[#E91429]/25 border border-[#E91429]/30 text-[#ff6b78] text-xs font-semibold flex items-center gap-2 transition disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Очистить историю
                </button>
              </div>
            </div>

            {approvedHistory.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#A7A7A7]">
                История одобренных треков пока пуста
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {approvedHistory.map((item) => (
                  <div key={item.id} className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-[#1DB954]/10 border border-[#1DB954]/20 flex items-center justify-center text-[#1DB954] shrink-0">
                        <ListMusic className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {item.track_name}
                        </p>
                        <p className="text-xs text-[#A7A7A7] truncate">{item.artist_name}{item.stream_pending_archived ? ' · осталась на модерации' : ''}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-white font-medium">{item.sender_name}</p>
                      <p className="text-[11px] text-[#A7A7A7]">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ВКЛАДКА 3: НАСТРОЙКИ СТРИМА */}
        {activeTab === 'settings' && settings && (
          <form
            onSubmit={handleSaveSettings}
            className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6 space-y-5"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-[#A7A7A7] mb-1.5">
                  Кулдаун зрителя (в секундах)
                </label>
                <input
                  type="number"
                  value={settings.cooldown_user_sec}
                  onChange={(e) =>
                    setSettings({ ...settings, cooldown_user_sec: Number(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-[#A7A7A7] mb-1.5">
                  Макс. длина трека (в секундах, 420 = 7 мин)
                </label>
                <input
                  type="number"
                  value={settings.max_duration_sec}
                  onChange={(e) =>
                    setSettings({ ...settings, max_duration_sec: Number(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-[#A7A7A7] mb-1.5">
                  Вместимость очереди (макс. заявок)
                </label>
                <input
                  type="number"
                  value={settings.max_queue_size}
                  onChange={(e) =>
                    setSettings({ ...settings, max_queue_size: Number(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[#A7A7A7] mb-1.5">
                  Режим фильтрации 18+ (Explicit)
                </label>
                <select
                  value={settings.explicit_mode}
                  onChange={(e) => setSettings({ ...settings, explicit_mode: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#181818] border border-white/10 text-sm text-white"
                >
                  <option value="allow">Разрешить всем (Allow)</option>
                  <option value="manual">Только ручной аппрув стримером (Manual)</option>
                  <option value="block">Полный запрет (Block)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-[#A7A7A7] mb-1.5">
                  Защита от повторов (кулдаун трека в минутах)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.prevent_duplicates}
                    onChange={(e) =>
                      setSettings({ ...settings, prevent_duplicates: e.target.checked })
                    }
                    className="w-5 h-5 accent-[#1DB954]"
                  />
                  <input
                    type="number"
                    value={settings.duplicate_cooldown_min}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        duplicate_cooldown_min: Number(e.target.value),
                      })
                    }
                    className="w-full px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#A7A7A7] mb-1.5">
                Черный список слов в названии (через запятую)
              </label>
              <input
                type="text"
                value={settings.banned_words}
                onChange={(e) => setSettings({ ...settings, banned_words: e.target.value })}
                placeholder="скример, earrape, bassboost"
                className="w-full px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[#A7A7A7] mb-1.5">
                Черный список исполнителей (через запятую)
              </label>
              <input
                type="text"
                value={settings.banned_artists}
                onChange={(e) => setSettings({ ...settings, banned_artists: e.target.value })}
                placeholder="Исполнитель 1, Исполнитель 2"
                className="w-full px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[#A7A7A7] mb-1.5">
                Текст правил на главной странице
              </label>
              <textarea
                rows={4}
                value={settings.rules_text}
                onChange={(e) => setSettings({ ...settings, rules_text: e.target.value })}
                className="w-full p-4 rounded-2xl bg-black/40 border border-white/10 text-sm"
              />
            </div>

            <button
              type="submit"
              className="px-6 py-3 rounded-2xl bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-sm transition cursor-pointer"
            >
              Применить настройки
            </button>
          </form>
        )}
      
      {/* ВКЛАДКА 4: НАСТРОЙКИ ВИДЖЕТА OBS */}
        {activeTab === 'widget' && settings && (
          <form
            onSubmit={handleSaveSettings}
            className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6 space-y-6"
          >
            <h2 className="text-lg font-bold text-white mb-2">Внешний вид виджета (OBS Studio)</h2>
            <p className="text-xs text-[#A7A7A7] mb-6">Эти настройки применяются к виджету мгновенно без перезагрузки браузера в OBS.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs text-[#A7A7A7] mb-2">Цвет фона подложки</label>
                <div className="flex gap-3 items-center">
                  <input
                    type="color"
                    value={settings.widget_bg_color || '#121212'}
                    onChange={(e) => setSettings({ ...settings, widget_bg_color: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border-0 bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={settings.widget_bg_color || '#121212'}
                    onChange={(e) => setSettings({ ...settings, widget_bg_color: e.target.value })}
                    className="flex-1 px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#A7A7A7] mb-2">Цвет текста (Название и автор)</label>
                <div className="flex gap-3 items-center">
                  <input
                    type="color"
                    value={settings.widget_text_color || '#ffffff'}
                    onChange={(e) => setSettings({ ...settings, widget_text_color: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border-0 bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={settings.widget_text_color || '#ffffff'}
                    onChange={(e) => setSettings({ ...settings, widget_text_color: e.target.value })}
                    className="flex-1 px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#A7A7A7] mb-2">Акцентный цвет (Иконка, ник зрителя)</label>
                <div className="flex gap-3 items-center">
                  <input
                    type="color"
                    value={settings.widget_accent_color || '#1DB954'}
                    onChange={(e) => setSettings({ ...settings, widget_accent_color: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border-0 bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={settings.widget_accent_color || '#1DB954'}
                    onChange={(e) => setSettings({ ...settings, widget_accent_color: e.target.value })}
                    className="flex-1 px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#A7A7A7] mb-2">
                  Прозрачность фона виджета: <span className="text-white font-bold">{settings.widget_opacity || 90}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.widget_opacity || 90}
                  onChange={(e) => setSettings({ ...settings, widget_opacity: Number(e.target.value) })}
                  className="w-full mt-3 accent-[#1DB954]"
                />
              </div>
            </div>
            <div className="col-span-1 md:col-span-2 border-t border-white/10 pt-6 mt-2">
                <label className="block text-xs text-[#A7A7A7] mb-2">Ссылка на свою обложку-заглушку (URL картинки)</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={settings.widget_custom_image || ''}
                  onChange={(e) => setSettings({ ...settings, widget_custom_image: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm font-mono text-white"
                />
                <p className="text-[10px] text-[#A7A7A7] mt-1.5">Показывается в виджете вместо обложек треков.</p>
              </div>

              <div className="col-span-1 md:col-span-2 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.widget_show_eq ?? true}
                  onChange={(e) => setSettings({ ...settings, widget_show_eq: e.target.checked })}
                  className="w-5 h-5 accent-[#1DB954]"
                />
                <label className="text-sm font-medium text-white">Показывать анимацию эквалайзера</label>
              </div>
            <button
              type="submit"
              className="mt-6 px-6 py-3 rounded-2xl bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-sm transition cursor-pointer"
            >
              Сохранить дизайн виджета
            </button>
          </form>
        )}
        </div>
    </div>
  );
}
