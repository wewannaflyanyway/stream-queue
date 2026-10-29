'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PollWidget } from '@/components/polls/poll-widget';
import { DEFAULT_STYLE, PREVIEW_POLL, type PollSnapshot } from '@/lib/polls/model';

function PollOverlay() {
  const preview = useSearchParams().get('preview') === '1';
  const [snapshot, setSnapshot] = useState<PollSnapshot | null>(null);
  const [clock, setClock] = useState(0);
  const [fault, setFault] = useState(false);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let failures = 0;
    async function refresh() {
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 8000);
      const sent = Date.now();
      try {
        const res = await fetch('/api/polls', { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error();
        const data: PollSnapshot = await res.json();
        if (!stopped) { setSnapshot(data); setClock(Date.now()); setOffset(Date.parse(data.serverNow) - (sent + Date.now()) / 2); setFault(false); failures = 0; }
      } catch {
        failures++;
        if (!stopped && failures >= 3) setFault(true);
      } finally { clearTimeout(deadline); if (!stopped) timeout = setTimeout(refresh, failures ? 4000 : 1500); }
    }
    if (!preview) void refresh();
    const tick = setInterval(() => setClock(Date.now()), 250);
    return () => { stopped = true; clearTimeout(timeout); clearInterval(tick); controller?.abort(); };
  }, [preview]);
  const now = clock + offset;
  const poll = preview ? PREVIEW_POLL : snapshot?.poll;
  const style = snapshot?.style ?? DEFAULT_STYLE;
  const resultEnd = poll?.endedAt ?? (poll?.endsAt && now >= Date.parse(poll.endsAt) ? poll.endsAt : null);
  const expired = resultEnd && style.resultsSeconds > 0 && now > Date.parse(resultEnd) + style.resultsSeconds * 1000;
  const shown = preview || (snapshot?.visible && !expired);
  return <main className="poll-overlay">
    {shown && poll && <PollWidget poll={poll} style={style} now={now} preview={preview}/>}
    {fault && <span className="poll-overlay-fault" role="status">Нет связи с голосованием · переподключение…</span>}
  </main>;
}

export default function PollOverlayPage() {
  return <Suspense fallback={<main className="poll-overlay"/>}><PollOverlay/></Suspense>;
}
