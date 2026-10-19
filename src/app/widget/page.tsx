'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Music, SkipForward, AlertCircle, User } from 'lucide-react';

interface TrackInfo {
  name: string;
  artist: string;
  orderedBy?: string | null;
}

interface WidgetSettings {
  widget_bg_color: string;
  widget_text_color: string;
  widget_accent_color: string;
  widget_opacity: number;
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
  if (hex) {
    const cleanHex = hex.replace('#', '');
    if (cleanHex.length === 6) {
      r = parseInt(cleanHex.substring(0, 2), 16);
      g = parseInt(cleanHex.substring(2, 4), 16);
      b = parseInt(cleanHex.substring(4, 6), 16);
    }
  }
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

export default function WidgetPage() {
  const [data, setData] = useState<NowPlayingData>({ isPlaying: false });
  const [clientError, setClientError] = useState<string | null>(null);
  
  // Счетчик неудачных запросов (чтобы игнорировать разовые просадки сети)
  const failCountRef = useRef(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/spotify/now-playing?t=${Date.now()}`);
        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
        
        const json = await res.json();
        setData(json);
        setClientError(null);
        failCountRef.current = 0; // Сбрасываем счетчик ошибок при успехе
      } catch (err: any) {
        failCountRef.current += 1;
        // Показываем ошибку, только если Spotify не отвечает 3 раза подряд (около 10 сек)
        if (failCountRef.current >= 3) {
          setClientError(err.message || 'Не удалось получить данные');
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3500);
    return () => clearInterval(interval);
  }, []);

  const bgColor = hexToRgba(data.settings?.widget_bg_color || '#121212', data.settings?.widget_opacity ?? 90);
  const textColor = data.settings?.widget_text_color || '#ffffff';
  const accentColor = data.settings?.widget_accent_color || '#1DB954';

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        body, html { background: transparent !important; }
        .marquee-container {
          overflow: hidden; white-space: nowrap; position: relative; padding-left: 2px;
          mask-image: linear-gradient(to right, black 85%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
        }
        .marquee-content { display: inline-block; animation: marquee 15s linear infinite; padding-right: 60px; }
        .marquee-content.short { animation: none; padding-right: 0; }
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
      `}} />

      <div className="w-screen h-screen overflow-hidden flex items-start justify-start p-6">
        
        {(clientError || data.error) && (
          <div className="max-w-[600px] rounded-2xl bg-red-600/90 border border-red-400 p-5 text-white shadow-2xl backdrop-blur-md">
            <div className="flex gap-3 items-start">
              <AlertCircle className="w-7 h-7 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-lg">Ошибка виджета:</p>
                <p className="opacity-90 mt-1.5 font-mono break-all text-sm">{clientError || data.error}</p>
              </div>
            </div>
          </div>
        )}

        {!clientError && !data.error && !data.isPlaying && (
          <div 
            className="w-[600px] rounded-3xl border border-white/10 p-5 shadow-xl backdrop-blur-md"
            style={{ backgroundColor: bgColor }}
          >
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center border shrink-0" style={{ backgroundColor: `${accentColor}1A`, borderColor: `${accentColor}33` }}>
                <Music className="w-10 h-10" style={{ color: accentColor }} />
              </div>
              <div>
                <p className="font-bold text-xl" style={{ color: textColor }}>Музыка на паузе</p>
                <p className="text-base mt-1" style={{ color: textColor, opacity: 0.6 }}>Включите трек в Spotify</p>
              </div>
            </div>
          </div>
        )}

        {!clientError && !data.error && data.isPlaying && data.current && (
          <div 
            className="w-[600px] rounded-3xl border border-white/10 p-5 shadow-2xl backdrop-blur-md"
            style={{ backgroundColor: bgColor }}
          >
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 rounded-2xl flex items-center justify-center border shrink-0 shadow-inner" style={{ backgroundColor: `${accentColor}1A`, borderColor: `${accentColor}33` }}>
                <Music className="w-12 h-12" style={{ color: accentColor }} />
              </div>

              {/* Жесткая минимальная высота для устранения прыжков виджета */}
              <div className="flex-1 min-w-0 flex flex-col justify-center min-h-[100px]">
                <div className="marquee-container w-full">
                  <div className={`marquee-content ${data.current.name.length < 26 ? 'short' : ''}`}>
                    <span className="font-bold text-2xl tracking-tight mr-12" style={{ color: textColor }}>
                      {data.current.name}
                    </span>
                    {data.current.name.length >= 26 && (
                      <span className="font-bold text-2xl tracking-tight" style={{ color: textColor }}>
                        {data.current.name}
                      </span>
                    )}
                  </div>
                </div>
                
                <p className="text-base truncate mt-1" style={{ color: textColor, opacity: 0.7 }}>
                  {data.current.artist}
                </p>

                {/* Блок заказчика (если нет, место не схлопывается из-за min-h-[100px]) */}
                {data.current.orderedBy && (
                  <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold truncate" style={{ color: accentColor }}>
                    <User className="w-4 h-4" />
                    <span>Заказ от: {data.current.orderedBy}</span>
                  </div>
                )}

                {data.next && (
                  <div className="mt-2.5 flex items-center gap-2 border-t pt-2" style={{ borderColor: `${textColor}20` }}>
                    <SkipForward className="w-5 h-5 shrink-0" style={{ color: accentColor }} />
                    <p className="text-sm truncate" style={{ color: textColor, opacity: 0.6 }}>
                      <span className="font-medium">Далее:</span> {data.next.artist} — {data.next.name}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}