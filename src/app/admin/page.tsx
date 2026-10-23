'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
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

// Мягкий звуковой сигнал (Web Audio API синусоида 800 Гц)
function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
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

  const [settings, setSettings] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'queue' | 'history' | 'settings' | 'widget'>('queue');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const soundEnabledRef = useRef(true);

  const showToast = (text: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Авто-вход если PIN уже сохранен в сессии
  useEffect(() => {
    const savedPin = sessionStorage.getItem('admin_pin');
    if (savedPin) {
      setPin(savedPin);
      verifyPinCode(savedPin);
    }
  }, []);

  const verifyPinCode = async (codeToTest: string) => {
    setAuthError('');
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: codeToTest, action: 'verify_pin' }),
      });
      if (res.ok) {
        sessionStorage.setItem('admin_pin', codeToTest);
        setIsAuthorized(true);
      } else {
        setAuthError('Неверный PIN-код');
        sessionStorage.removeItem('admin_pin');
      }
    } catch {
      setAuthError('Ошибка соединения с сервером');
    }
  };

  // Загрузка данных и Realtime подписка после входа
  useEffect(() => {
    if (!isAuthorized) return;

    const loadAll = async () => {
      const { data: sData } = await supabase
        .from('stream_settings')
        .select('*')
        .eq('id', 1)
        .single();
      if (sData) {
        setSettings(sData);
        soundEnabledRef.current = sData.sound_alerts;
      }

      const { data: rData } = await supabase
        .from('song_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (rData) setRequests(rData);
    };

    loadAll();

    const channel = supabase
      .channel('admin-realtime-queue')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'song_requests' },
        (payload) => {
          const newReq = payload.new as any;
          setRequests((prev) => [newReq, ...prev]);
          if (soundEnabledRef.current && newReq.status === 'pending') {
            playNotificationChime();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'song_requests' },
        (payload) => {
          const updated = payload.new as any;
          setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'stream_settings' },
        (payload) => {
          if (payload.new) {
            setSettings(payload.new);
            soundEnabledRef.current = (payload.new as any).sound_alerts;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthorized]);

  // Универсальный вызов API админки
  const callAdminApi = async (action: string, payload?: any) => {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, action, payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка операции');
    return data;
  };

  // Быстрые тумблеры в шапке
  const toggleQuickSetting = async (key: string, currentVal: boolean) => {
    const nextVal = !currentVal;
    setSettings((prev: any) => ({ ...prev, [key]: nextVal }));
    if (key === 'sound_alerts') soundEnabledRef.current = nextVal;
    try {
      await callAdminApi('update_settings', { [key]: nextVal });
    } catch (e: any) {
      showToast(e.message, 'err');
    }
  };

  // Одобрить трек
  const handleApprove = async (reqItem: any) => {
    setLoadingId(reqItem.id);
    try {
      await callAdminApi('approve', { id: reqItem.id, spotify_uri: reqItem.spotify_uri });
      showToast(`Добавлено в Spotify: ${reqItem.track_name}`);
    } catch (e: any) {
      showToast(e.message, 'err');
    } finally {
      setLoadingId(null);
    }
  };

  // Отклонить трек
  const handleReject = async (id: string) => {
    setLoadingId(id);
    try {
      await callAdminApi('reject', { id });
    } catch (e: any) {
      showToast(e.message, 'err');
    } finally {
      setLoadingId(null);
    }
  };

  // Скип трека в Spotify
  const handleSkip = async () => {
    try {
      await callAdminApi('skip');
      showToast('Трек в Spotify переключен (Skip)');
    } catch (e: any) {
      showToast(e.message, 'err');
    }
  };

  // Panic Button: Очистить очередь
  const handleClearQueue = async () => {
    if (!confirm('Точно отклонить ВСЕ ожидающие треки в очереди?')) return;
    try {
      await callAdminApi('clear_queue');
      showToast('Очередь ожидания очищена');
    } catch (e: any) {
      showToast(e.message, 'err');
    }
  };

  // Очистить историю
  const handleClearHistory = async () => {
    if (!confirm('Точно удалить всю историю одобренных и отклоненных треков? Это действие необратимо.')) return;
    try {
      await callAdminApi('clear_history');
      showToast('История полностью очищена');
      setRequests((prev) => prev.filter((r) => r.status === 'pending'));
    } catch (e: any) {
      showToast(e.message, 'err');
    }
  };

  // Экспорт плейлиста
  const handleExportPlaylist = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/admin/export', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        showToast('Плейлист успешно создан!');
        window.open(data.url, '_blank');
      } else {
        showToast('Ошибка: ' + (data.error || 'Неизвестная ошибка'), 'err');
      }
    } catch (e) {
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
    } catch (err: any) {
      showToast(err.message, 'err');
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

  const pendingList = requests.filter((r) => r.status === 'pending');
  const approvedHistory = requests.filter((r) => r.status === 'approved');

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

        {/* Навигация по вкладкам */}
        <div className="flex items-center gap-2">
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
        </div>

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
                    <img
                      src={
                        item.album_cover_url ||
                        'https://placehold.co/64x64/121212/1DB954?text=♪'
                      }
                      alt={item.track_name}
                      className="w-14 h-14 rounded-2xl object-cover shrink-0 bg-black/40"
                    />
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
                          {item.source === 'twitch_chat' ? 'Twitch' : 'Сайт'}
                        </span>
                      </div>
                      <p className="text-sm text-[#A7A7A7] truncate mt-0.5">{item.artist_name}</p>
                      <p className="text-xs text-[#A7A7A7]/70 mt-1">
                        Заказал: <span className="text-white font-medium">{item.sender_name}</span> •{' '}
                        {timeAgo(item.created_at)}
                      </p>
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
                      disabled={loadingId === item.id}
                      onClick={() => handleReject(item.id)}
                      className="px-4 py-2.5 rounded-2xl bg-[#E91429]/15 hover:bg-[#E91429]/30 border border-[#E91429]/30 text-[#ff6b78] text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      Отклонить
                    </button>

                    <button
                      type="button"
                      disabled={loadingId === item.id}
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
            {/* Шапка с кнопкой очистки и экспорта */}
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-black/20">
              <span className="text-sm font-semibold text-white">Управление историей</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportPlaylist}
                  disabled={isExporting || approvedHistory.length === 0}
                  className="px-3 py-1.5 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
                >
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListMusic className="w-3.5 h-3.5" />}
                  {isExporting ? 'Создаем...' : 'Экспорт в плейлист'}
                </button>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  disabled={approvedHistory.length === 0}
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
                      <img
                        src={item.album_cover_url}
                        alt={item.track_name}
                        className="w-10 h-10 rounded-xl object-cover"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {item.track_name}
                        </p>
                        <p className="text-xs text-[#A7A7A7] truncate">{item.artist_name}</p>
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
                <p className="text-[10px] text-[#A7A7A7] mt-1.5">Будет показываться, когда плеер на паузе или у трека нет обложки.</p>
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