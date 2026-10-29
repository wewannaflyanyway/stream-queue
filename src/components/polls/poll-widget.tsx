'use client';

import type { CSSProperties } from 'react';
import { BarChart3, Clock3, Users } from 'lucide-react';
import type { Poll, PollStyle } from '@/lib/polls/model';

export function PollWidget({ poll, style, now, preview = false }: { poll: Poll; style: PollStyle; now: number; preview?: boolean }) {
  const ended = poll.status === 'ended' || (!!poll.endsAt && Date.parse(poll.endsAt) <= now);
  const max = poll.counts ? Math.max(...poll.counts) : 0;
  const seconds = poll.endsAt ? Math.max(0, Math.ceil((Date.parse(poll.endsAt) - now) / 1000)) : null;
  const timer = seconds === null ? 'Без таймера' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
  const rgb = [1,3,5].map(i => parseInt(style.background.slice(i,i+2),16)).join(',');
  const vars = {
    '--poll-accent': style.accent, '--poll-text': style.text, '--poll-track': style.track,
    width: style.width, fontSize: style.fontSize, borderRadius: style.radius,
    background: `rgba(${rgb},${style.opacity / 100})`, color: style.text,
  } as CSSProperties;
  return <section className="poll-widget" style={vars} aria-label={preview ? 'Пример виджета голосования' : 'Голосование'}>
    <div className="poll-widget-top">
      <span className="poll-widget-eyebrow"><BarChart3 size={15}/>{preview ? 'ПРЕДПРОСМОТР' : ended ? 'ГОЛОСОВАНИЕ ЗАВЕРШЕНО' : 'ГОЛОСУЕМ В ЧАТЕ'}</span>
      {style.showTimer && <span className="poll-widget-timer"><Clock3 size={14}/>{ended ? 'Итоги' : preview ? '1:24' : timer}</span>}
    </div>
    <h2>{poll.question}</h2>
    <div className="poll-widget-options">
      {poll.options.map((option, i) => {
        const count = poll.counts?.[i] ?? 0;
        const percentage = poll.totalVotes ? Math.round(count / poll.totalVotes * 100) : 0;
        const leader = max > 0 && count === max;
        return <div className={`poll-widget-option ${leader ? 'is-leader' : ''}`} key={i}>
          <div className="poll-widget-option-line">
            <span className="poll-widget-number">{i+1}</span><span className="poll-widget-label">{option}</span>
            {poll.counts && <span className="poll-widget-score">{style.showCounts && <span>{count}</span>}{style.showPercentages && <strong>{percentage}%</strong>}</span>}
          </div>
          <div className="poll-widget-track" role="progressbar" aria-label={option} aria-valuemin={0} aria-valuemax={100} aria-valuenow={poll.counts ? percentage : undefined}><div className="poll-widget-fill" style={{ width: `${percentage}%`, background: style.optionColors ? style.colors[i] : style.accent }}/></div>
        </div>;
      })}
    </div>
    <footer className="poll-widget-footer">
      <span>{ended ? poll.counts === null ? 'Получаем итоги…' : max === 0 ? 'Голосов пока нет' : poll.counts.filter(v => v === max).length > 1 ? 'Ничья — несколько лидеров' : `Победил вариант ${poll.counts.indexOf(max)+1}` : poll.counts === null ? 'Результаты появятся в конце' : `Напиши ${poll.votingMode === 'command' ? '!vote и номер ' : ''}1–${poll.options.length} в чат Twitch`}</span>
      {style.showTotal && <span className="poll-widget-total"><Users size={14}/>{poll.totalVotes}</span>}
    </footer>
    {!ended && <p className="poll-widget-rule">{poll.allowRevote ? 'Один зритель — один голос. Выбор можно изменить.' : 'Один зритель — один голос. Учитывается первый выбор.'}</p>}
  </section>;
}
