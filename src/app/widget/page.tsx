'use client';

import React, { useEffect, useState } from 'react';
import { Music, SkipForward, AlertCircle, Loader2 } from 'lucide-react';

interface TrackInfo {
  name: string;
  artist: string;
  cover?: string;
}

interface NowPlayingData {
  isPlaying: boolean;
  current?: TrackInfo;
  next?: TrackInfo;
  error?: string;
}

export default function WidgetPage() {
  const [data, setData] = useState<NowPlayingData>({ isPlaying: false });
  const [loading, setLoading] = useState(true);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/spotify/now-playing?t=${Date.now()}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Ошибка сервера: ${res.status}`);
        }
        const json = await res.json();
        setData(json);
        setClientError(null);
      } catch (err: any) {
        setClientError(err.message || 'Не удалось получить данные');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3500); // Опрос раз в 3.5 секунды
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        /* Жесткая прозрачность для OBS */
        body, html { 
          background-color: transparent !important; 
          background: transparent !important;
        }
        .marquee-container {
          overflow: hidden;
          white-space: nowrap;
          position: relative;
          mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
        }
        .marquee-content {
          display: inline-block;
          animation: marquee 12s linear infinite;
          padding-right: 40px;
        }
        .marquee-content.short {
          animation: none;
          padding-right: 0;
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}} />

      <div className="w-screen h-screen overflow-hidden flex items-start justify-start p-4">
        
        {loading && (
          <div className="flex items-center gap-2 rounded-xl bg-[#1DB954] text-black font-bold px-4 py-2 shadow-lg">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Подключение...</span>
          </div>
        )}

        {(clientError || data.error) && !loading && (
          <div className="max-w-[360px] rounded-xl bg-red-600 border border-red-400 p-3 text-white text-xs shadow-2xl">
            <div className="flex gap-2 items-start">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-bold text-sm">Ошибка виджета:</p>
                <p className="opacity-90 mt-1 font-mono break-all">{clientError || data.error}</p>
              </div>
            </div>
          </div>
        )}

        {!loading && !clientError && !data.error && !data.isPlaying && (
          <div className="w-[360px] rounded-2xl bg-[#121212]/90 border border-white/20 p-3 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center border border-white/10 shrink-0">
                <Music className="w-6 h-6 text-white/50" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Музыка на паузе</p>
                <p className="text-[#A7A7A7] text-xs mt-0.5">Включите трек в Spotify</p>
              </div>
            </div>
          </div>
        )}

        {!loading && !clientError && !data.error && data.isPlaying && data.current && (
          <div className="w-[360px] rounded-2xl bg-[#121212]/90 border border-white/20 p-3 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-4">
              <div className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden shadow-lg border border-white/10 bg-[#1e1e1e]">
                {/* ПРОКСИРУЕМ КАРТИНКУ ДЛЯ OBS БЕЗ VPN */}
                <img 
                  src={data.current.cover ? `/api/proxy-image?url=${encodeURIComponent(data.current.cover)}` : 'https://placehold.co/64x64/121212/1DB954?text=♪'} 
                  alt="cover"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="marquee-container w-full">
                  <div className={`marquee-content ${data.current.name.length < 22 ? 'short' : ''}`}>
                    <span className="text-white font-bold text-sm tracking-tight mr-8">
                      {data.current.name}
                    </span>
                    {data.current.name.length >= 22 && (
                      <span className="text-white font-bold text-sm tracking-tight">
                        {data.current.name}
                      </span>
                    )}
                  </div>
                </div>
                
                <p className="text-[#A7A7A7] text-xs truncate mt-0.5">
                  {data.current.artist}
                </p>

                {data.next && (
                  <div className="mt-2 flex items-center gap-1.5 border-t border-white/10 pt-1.5">
                    <SkipForward className="w-3 h-3 text-[#1DB954] shrink-0" />
                    <p className="text-[10px] text-[#A7A7A7] truncate">
                      <span className="text-white/60 font-medium">Далее:</span> {data.next.artist} — {data.next.name}
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