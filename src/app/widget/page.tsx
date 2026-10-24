'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Music, SkipForward, AlertCircle, User } from 'lucide-react';

interface TrackInfo {
  name: string;
  artist: string;
  cover?: string | null;
  orderedBy?: string | null;
}

interface WidgetSettings {
  widget_bg_color: string;
  widget_text_color: string;
  widget_accent_color: string;
  widget_opacity: number;
  widget_custom_image: string;
  widget_show_eq: boolean;
}

interface NowPlayingData {
  isPlaying: boolean;
  current?: TrackInfo;
  next?: TrackInfo;
  settings?: WidgetSettings;
  error?: string;
}

const hexToRgba = (hex: string, opacity: number) => {
  let r = 18, g = 18, b = 18;
  if (hex && hex.replace('#', '').length === 6) {
    const cleanHex = hex.replace('#', '');
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

export default function WidgetPage() {
  const [data, setData] = useState<NowPlayingData>({ isPlaying: false });
  const [clientError, setClientError] = useState<string | null>(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    let timeoutId: number | undefined;

    const fetchData = async () => {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 6000);

      try {
        const res = await fetch(`/api/spotify/now-playing?t=${Date.now()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        clearTimeout(abortTimer);

        const json = await res.json();

        if (isMounted) {
          setData(json);
          if (json.error) {
            setClientError(json.error);
          } else {
            setClientError(null);
          }
          failCountRef.current = 0;
        }
      } catch {
        clearTimeout(abortTimer);
        if (isMounted) {
          failCountRef.current += 1;
          if (failCountRef.current >= 5) {
            setClientError('Ожидание ответа от сервера...');
          }
        }
      } finally {
        if (isMounted) {
          timeoutId = window.setTimeout(fetchData, 3500);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const s = data.settings;
  const bgColor = hexToRgba(s?.widget_bg_color || '#121212', s?.widget_opacity ?? 90);
  const textColor = s?.widget_text_color || '#ffffff';
  const accentColor = s?.widget_accent_color || '#1DB954';

  // ПРИОРИТЕТ: Если пользователь указал свою картинку в настройках — используем её всегда. Иначе берем обложку Spotify.
  const rawImageUrl = s?.widget_custom_image ? s.widget_custom_image : (data.isPlaying && data.current?.cover ? data.current.cover : null);
  const imageUrl = rawImageUrl && (rawImageUrl.includes('scdn.co') || rawImageUrl.includes('spotify'))
    ? `/api/proxy-image?url=${encodeURIComponent(rawImageUrl)}`
    : rawImageUrl;

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        body, html { background: transparent !important; }
        .marquee-container { overflow: hidden; white-space: nowrap; position: relative; padding-left: 2px; mask-image: linear-gradient(to right, black 85%, transparent 100%); -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%); }
        .marquee-content { display: inline-block; animation: marquee 15s linear infinite; padding-right: 60px; }
        .marquee-content.short { animation: none; padding-right: 0; }
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .eq-bar { width: 4px; border-radius: 2px; animation: eq 1.2s ease-in-out infinite; }
        .eq-bar:nth-child(2) { animation-delay: 0.2s; }
        .eq-bar:nth-child(3) { animation-delay: 0.4s; }
        @keyframes eq { 0%, 100% { height: 6px; } 50% { height: 16px; } }
      `}} />

      <div className="w-screen h-screen overflow-hidden flex items-start justify-start p-6">
        {(clientError || data.error) && (
          <div className="w-[600px] rounded-2xl bg-red-600/90 border border-red-400 p-5 text-white shadow-2xl backdrop-blur-md flex gap-3 items-start">
            <AlertCircle className="w-7 h-7 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-lg">Ошибка виджета</p>
              <p className="opacity-90 mt-1.5 text-sm">{clientError || data.error}</p>
            </div>
          </div>
        )}

        {!clientError && !data.error && !data.isPlaying && (
          <div className="w-[600px] rounded-3xl border border-white/10 p-5 shadow-xl backdrop-blur-md flex items-center gap-5" style={{ backgroundColor: bgColor }}>
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0 bg-black/40 overflow-hidden border border-white/5">
              {imageUrl ? (
                <img key={imageUrl} src={imageUrl} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <Music className="w-10 h-10" style={{ color: accentColor }} />
              )}
            </div>
            <div>
              <p className="font-bold text-xl" style={{ color: textColor }}>Музыка на паузе</p>
              <p className="text-base mt-1" style={{ color: textColor, opacity: 0.6 }}>Включите трек в Spotify</p>
            </div>
          </div>
        )}

        {!clientError && !data.error && data.isPlaying && data.current && (
          <div className="w-[600px] rounded-3xl border border-white/10 p-5 shadow-2xl backdrop-blur-md flex flex-col" style={{ backgroundColor: bgColor }}>
            
            {/* Основной трек */}
            <div className="flex gap-6">
              <div className="w-24 h-24 rounded-2xl shrink-0 bg-black/40 overflow-hidden border border-white/5 flex items-center justify-center relative">
                {imageUrl ? (
                  <img key={imageUrl} src={imageUrl} alt="Cover" className="w-full h-full object-cover shadow-inner" />
                ) : (
                  <Music className="w-12 h-12" style={{ color: accentColor }} />
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex items-center gap-3 w-full">
                  <div className="marquee-container flex-1">
                    <div className={`marquee-content ${data.current.name.length < 24 ? 'short' : ''}`}>
                      <span className="font-bold text-2xl tracking-tight mr-12" style={{ color: textColor }}>{data.current.name}</span>
                      {data.current.name.length >= 24 && <span className="font-bold text-2xl tracking-tight" style={{ color: textColor }}>{data.current.name}</span>}
                    </div>
                  </div>
                  {s?.widget_show_eq && (
                    <div className="flex items-end justify-center gap-1 w-6 h-5 shrink-0 mb-1">
                      <div className="eq-bar" style={{ backgroundColor: accentColor }}></div>
                      <div className="eq-bar" style={{ backgroundColor: accentColor }}></div>
                      <div className="eq-bar" style={{ backgroundColor: accentColor }}></div>
                    </div>
                  )}
                </div>
                
                <p className="text-base truncate mt-0.5" style={{ color: textColor, opacity: 0.7 }}>{data.current.artist}</p>

                <div className="h-6 mt-1 flex items-center gap-1.5 text-sm font-semibold truncate" style={{ color: accentColor }}>
                  {data.current.orderedBy && (
                    <>
                      <User className="w-4 h-4" />
                      <span>Заказ от: {data.current.orderedBy}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Следующий трек */}
            {data.next && (
              <>
                <div className="w-full h-px bg-white/10 my-4" />
                <div className="flex items-center gap-3 px-1">
                  <SkipForward className="w-5 h-5 shrink-0" style={{ color: accentColor }} />
                  <div className="flex-1 min-w-0 flex items-center justify-between text-sm">
                    <div className="truncate" style={{ color: textColor, opacity: 0.8 }}>
                      <span className="font-semibold mr-1.5" style={{ color: textColor, opacity: 1 }}>Далее:</span>
                      {data.next.artist} — {data.next.name}
                    </div>
                    {data.next.orderedBy && (
                      <div className="shrink-0 flex items-center gap-1.5 ml-3 font-medium" style={{ color: accentColor }}>
                        <User className="w-3.5 h-3.5" />
                        <span>{data.next.orderedBy}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

          </div>
        )}
      </div>
    </>
  );
}