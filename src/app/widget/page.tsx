'use client';

import React, { useEffect, useState } from 'react';
import { Music, SkipForward, AlertCircle, Loader2, User } from 'lucide-react';

interface TrackInfo {
  name: string;
  artist: string;
  orderedBy?: string | null;
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
    const interval = setInterval(fetchData, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        body, html { 
          background-color: transparent !important; 
          background: transparent !important;
        }
        .marquee-container {
          overflow: hidden;
          white-space: nowrap;
          position: relative;
          padding-left: 2px;
          mask-image: linear-gradient(to right, black 85%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
        }
        .marquee-content {
          display: inline-block;
          animation: marquee 15s linear infinite; 
          padding-right: 60px; 
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

      <div className="w-screen h-screen overflow-hidden flex items-start justify-start p-6">
        
        {loading && (
          <div className="flex items-center gap-3 rounded-2xl bg-[#1DB954] text-black font-bold px-6 py-4 shadow-lg text-lg">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Подключение...</span>
          </div>
        )}

        {(clientError || data.error) && !loading && (
          <div className="max-w-[600px] rounded-2xl bg-red-600 border border-red-400 p-5 text-white shadow-2xl">
            <div className="flex gap-3 items-start">
              <AlertCircle className="w-7 h-7 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-lg">Ошибка виджета:</p>
                <p className="opacity-90 mt-1.5 font-mono break-all text-sm">{clientError || data.error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Состояние: Музыка на паузе */}
        {!loading && !clientError && !data.error && !data.isPlaying && (
          <div className="w-[600px] rounded-3xl bg-[#121212]/90 border border-white/20 p-5 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10 shrink-0">
                <Music className="w-10 h-10 text-white/50" />
              </div>
              <div>
                <p className="text-white font-bold text-xl">Музыка на паузе</p>
                <p className="text-[#A7A7A7] text-base mt-1">Включите трек в Spotify</p>
              </div>
            </div>
          </div>
        )}

        {/* Состояние: Музыка играет */}
        {!loading && !clientError && !data.error && data.isPlaying && data.current && (
          <div className="w-[600px] rounded-3xl bg-[#121212]/90 border border-white/20 p-5 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-5">
              
              {/* ЗАМЕНА ОБЛОЖКИ НА СТИЛЬНУЮ ИКОНКУ */}
              <div className="w-20 h-20 rounded-2xl bg-[#1DB954]/10 flex items-center justify-center border border-[#1DB954]/20 shrink-0 shadow-inner">
                <Music className="w-10 h-10 text-[#1DB954]" />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="marquee-container w-full">
                  <div className={`marquee-content ${data.current.name.length < 26 ? 'short' : ''}`}>
                    <span className="text-white font-bold text-2xl tracking-tight mr-12">
                      {data.current.name}
                    </span>
                    {data.current.name.length >= 26 && (
                      <span className="text-white font-bold text-2xl tracking-tight">
                        {data.current.name}
                      </span>
                    )}
                  </div>
                </div>
                
                <p className="text-[#A7A7A7] text-base truncate mt-1">
                  {data.current.artist}
                </p>

                {data.current.orderedBy && (
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-[#1ed760] font-semibold truncate">
                    <User className="w-4 h-4 text-[#1ed760]" />
                    <span>Заказ от: {data.current.orderedBy}</span>
                  </div>
                )}

                {data.next && (
                  <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-2.5">
                    <SkipForward className="w-5 h-5 text-[#1DB954] shrink-0" />
                    <p className="text-sm text-[#A7A7A7] truncate">
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