'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BarChart3, Check, Copy, ExternalLink, Eye, EyeOff, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { DEFAULT_STYLE, PREVIEW_POLL, type Poll, type PollAdminState, type PollDraft, type PollStyle } from '@/lib/polls/model';
import { PollWidget } from './poll-widget';

const EMPTY_DRAFT: PollDraft = { id: '', question: '', options: ['', ''], durationSec: 120, allowRevote: true, hideResults: false, votingMode: 'number' };
const CHAT_LABELS: Record<string,string> = { disconnected: 'Не подключен', connecting: 'Подключение…', webhook_callback_verification_pending: 'Ожидаем подтверждение Twitch', enabled: 'Подключен', revoked: 'Доступ отозван', error: 'Ошибка подключения' };
const subscribeOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const serverOrigin = () => '';

export function PollsPanel({ pin }: { pin: string }) {
  const [data, setData] = useState<PollAdminState | null>(null);
  const [draft, setDraft] = useState<PollDraft>(EMPTY_DRAFT);
  const [style, setStyle] = useState<PollStyle>(DEFAULT_STYLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const origin = useSyncExternalStore(subscribeOrigin, getOrigin, serverOrigin);
  const [copied, setCopied] = useState(false);
  const initialized = useRef(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const api = useCallback(async (action: string, payload?: unknown) => {
    const res = await fetch('/api/polls/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, action, payload }), signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? 'Не удалось выполнить действие.');
    return result;
  }, [pin]);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = generation.current;
      try {
        if (!busyRef.current) {
          const result: PollAdminState = await api('state');
          if (!stopped && version === generation.current) {
            setData(result); setClockOffset(Date.parse(result.serverNow)-Date.now()); setNow(Date.now());
            if (!initialized.current) {
              setStyle(result.style);
              const outcome = new URLSearchParams(window.location.search).get('polls');
              if (outcome) setNotice(outcome === 'connected' ? 'Канал авторизован. Проверьте статус подключения ниже.' : 'Twitch не подключился. Проверьте настройки и повторите вход.');
              initialized.current = true;
            }
            setLoadError('');
          }
        }
      } catch (e) { if (!stopped && version === generation.current) setLoadError((e as Error).message); }
      finally { if (!stopped) timeout = setTimeout(refresh, 2500); }
    }
    void refresh();
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { stopped = true; mounted.current = false; clearTimeout(timeout); clearInterval(tick); };
  }, [api]);

  async function act(action: string, payload?: unknown, success?: string) {
    if (busyRef.current) return;
    busyRef.current = true; generation.current++;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(action,payload);
      if (!mounted.current) return;
      if (action === 'connect') { window.location.assign(result.url); return; }
      setData(result);
      setClockOffset(Date.parse(result.serverNow)-Date.now()); setNow(Date.now());
      if (action === 'style') setStyle(result.style);
      if (action === 'start') setDraft(EMPTY_DRAFT);
      if (success) setNotice(success);
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function save(start: boolean) {
    const id = draft.id || crypto.randomUUID();
    const payload = { ...draft, id };
    setDraft(payload);
    void act(start ? 'start' : 'save', payload, start ? 'Голосование запущено.' : 'Черновик сохранен.');
  }
  function reuse(poll: Poll, existing = false) {
    setDraft({ id: existing ? poll.id : '', question: poll.question, options: [...poll.options], durationSec: poll.durationSec, allowRevote: poll.allowRevote, hideResults: poll.hideResults, votingMode: poll.votingMode });
    setNotice(existing ? 'Черновик открыт в редакторе.' : 'Вопрос скопирован в новое голосование.');
  }
  function preset(theme: 'dark' | 'light' | 'compact') {
    setStyle({ ...DEFAULT_STYLE, ...(theme === 'light' ? { background: '#ffffff', text: '#202029', accent: '#8057d8', track: '#202029' } : theme === 'compact' ? { width: 400, fontSize: 14, radius: 16 } : {}) });
  }
  const active = data?.poll?.status === 'running' ? data.poll : null;
  // The preview uses sample counts only and never creates votes.
  const preview: Poll = { ...PREVIEW_POLL, question: draft.question || PREVIEW_POLL.question, options: draft.options.map((v,i) => v || `Вариант ${i+1}`), votingMode: draft.votingMode, allowRevote: draft.allowRevote, hideResults: draft.hideResults, counts: draft.hideResults ? null : draft.options.map((_,i) => [26,15,9,7,4,2][i]), totalVotes: draft.options.reduce((sum,_,i) => sum + [26,15,9,7,4,2][i],0) };
  const widgetUrl = `${origin}/widget/poll`;
  return <div className="poll-admin">
    <div className="poll-admin-heading"><div><span className="poll-kicker">TWITCH × STREAMQUEUE</span><h2>Голосования в чате</h2><p>Задай вопрос. Зрители выберут номер. Результаты появятся на стриме.</p></div><BarChart3 size={36}/></div>
    {error && <div className="poll-alert is-error" role="alert">{error}</div>}
    {loadError && <div className="poll-alert is-error" role="alert">{loadError}</div>}
    {notice && <div className="poll-alert" role="status">{notice}</div>}
    <section className="poll-card poll-chat">
      <div><h3><span className={`poll-status-dot ${data?.chat.status === 'enabled' ? 'is-online' : ''}`}/>Чат Twitch {data?.chat.login ? `· ${data.chat.login}` : ''}</h3><p>{data ? CHAT_LABELS[data.chat.status] ?? data.chat.status : loadError ? 'Ожидаем настройки сервера' : 'Проверяем подключение…'}</p>
        {data?.chat.lastEventAt && <small>Последнее сообщение: {new Date(data.chat.lastEventAt).toLocaleTimeString('ru-RU')}</small>}
        {data?.chat.lastCheckedAt && <small>Проверка подписки: {new Date(data.chat.lastCheckedAt).toLocaleTimeString('ru-RU')}</small>}
      </div>
      <div className="poll-actions"><button disabled={busy || !data?.chat.configured} onClick={() => act('check')}><RefreshCw size={15}/>Проверить</button><button className="is-primary" disabled={busy || !data?.chat.configured} onClick={() => act('connect')}><ExternalLink size={15}/>Подключить Twitch</button></div>
      {data && !data.chat.configured && <div className="poll-setup">Для подключения зарегистрируй приложение Twitch и добавь на сервер: <code>{data.chat.missing.join(', ')}</code>. Подробные шаги — в <code>docs/POLLS_SETUP.md</code>. Секреты в браузере вводить не нужно.</div>}
      <details className="poll-help"><summary>Как впервые подключить Twitch</summary><ol><li>Открой <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">Twitch Developer Console</a> → Register Your Application.</li><li>Название: StreamQueue и твой ник. Категория: Chat Bot. Тип: Confidential.</li><li>OAuth Redirect URL: <code>{origin}/api/twitch/oauth/callback</code></li><li>В Manage создай New Secret. Сохрани Client ID и Client Secret в переменные окружения сервера, выполни миграцию и деплой.</li><li>На этой странице нажми «Подключить Twitch» и войди в аккаунт своего канала.</li></ol></details>
    </section>

    {data?.poll && <section className="poll-card poll-current"><div className="poll-section-title"><h3>{active ? 'Сейчас в эфире' : 'Последний результат'}</h3><span>{data.poll.totalVotes} голосов</span></div><h4>{data.poll.question}</h4>
      <div className="poll-mini-results">{data.poll.options.map((label,i) => <div key={i}><span>{i+1}. {label}</span><b>{data.poll?.counts?.[i] ?? 0}</b></div>)}</div>
      <div className="poll-actions">{active && <><button className="is-danger" disabled={busy} onClick={() => act('finish',{id:active.id},'Голосование завершено.')}><Square size={14}/>Завершить</button><button disabled={busy || !active.endsAt} onClick={() => act('extend',{id:active.id})}>+30 секунд</button><span className="poll-live-time">{active.endsAt ? `${Math.max(0,Math.ceil((Date.parse(active.endsAt)-now-clockOffset)/1000))} сек. (по серверу)` : 'Без таймера'}</span></>}
        <button disabled={busy} onClick={() => act('visibility',{visible:!data.visible})}>{data.visible ? <EyeOff size={15}/> : <Eye size={15}/>} {data.visible ? 'Скрыть виджет' : 'Показать виджет'}</button>
      </div>
    </section>}

    <div className="poll-admin-grid">
      <section className="poll-card poll-editor"><div className="poll-section-title"><h3>{draft.id ? 'Редактор черновика' : 'Новое голосование'}</h3><button className="poll-text-button" onClick={() => setDraft(EMPTY_DRAFT)}>Очистить</button></div>
        <label className="poll-field">Вопрос<span className="poll-input-wrap"><input value={draft.question} maxLength={160} placeholder="Что делаем на следующем стриме?" onChange={e => setDraft({...draft,question:e.target.value})}/></span></label>
        <div className="poll-field">Варианты ответа<div className="poll-options-editor">{draft.options.map((option,i) => <div key={i}><span>{i+1}</span><input aria-label={`Вариант ${i+1}`} value={option} maxLength={80} placeholder={`Вариант ${i+1}`} onChange={e => setDraft({...draft,options:draft.options.map((v,j) => j === i ? e.target.value : v)})}/><button aria-label={`Удалить вариант ${i+1}`} disabled={draft.options.length<=2} onClick={() => setDraft({...draft,options:draft.options.filter((_,j) => j!==i)})}><Trash2 size={15}/></button></div>)}</div></div>
        {draft.options.length<6 && <button className="poll-add-option" onClick={() => setDraft({...draft,options:[...draft.options,'']})}><Plus size={15}/>Добавить вариант</button>}
        <div className="poll-field-row"><label className="poll-field">Длительность<select value={draft.durationSec ?? 'manual'} onChange={e => setDraft({...draft,durationSec:e.target.value==='manual'?null:Number(e.target.value)})}>{[30,60,120,300].map(n => <option key={n} value={n}>{n<60?`${n} секунд`:`${n/60} мин.`}</option>)}<option value="manual">До ручного завершения</option></select></label><label className="poll-field">Формат голоса<select value={draft.votingMode} onChange={e => setDraft({...draft,votingMode:e.target.value as PollDraft['votingMode']})}><option value="number">Число: 1, 2, 3</option><option value="command">Команда: !vote 2</option></select></label></div>
        <label className="poll-check"><input type="checkbox" checked={draft.allowRevote} onChange={e => setDraft({...draft,allowRevote:e.target.checked})}/>Разрешить менять свой голос</label>
        <label className="poll-check"><input type="checkbox" checked={draft.hideResults} onChange={e => setDraft({...draft,hideResults:e.target.checked})}/>Скрывать распределение голосов до конца</label>
        <div className="poll-actions poll-editor-actions"><button disabled={busy || !data} onClick={() => save(false)}>Сохранить черновик</button><button className="is-primary" disabled={busy || !!active || data?.chat.status!=='enabled'} onClick={() => save(true)}><Play size={15}/>Начать голосование</button></div>
        {active && <p className="poll-muted">Сначала заверши текущее голосование. Следующий вопрос можно сохранить в черновик.</p>}
      </section>

      <section className="poll-card poll-preview-card"><div className="poll-section-title"><h3>Так увидят зрители</h3><span>Демонстрационные голоса</span></div><div className="poll-preview-stage"><PollWidget poll={preview} style={style} now={0} preview/></div><p className="poll-muted">Предпросмотр с демонстрационными голосами. Реальные результаты не меняются.</p>
        <div className="poll-obs-link"><span>Ссылка для OBS · Browser Source</span><div><input aria-label="Адрес виджета OBS" readOnly value={widgetUrl}/><button aria-label="Скопировать адрес виджета" onClick={async () => { try { await navigator.clipboard.writeText(widgetUrl); setCopied(true); setTimeout(() => setCopied(false),2000); } catch { setError('Не удалось скопировать. Скопируйте адрес из поля вручную.'); } }}>{copied?<Check size={16}/>:<Copy size={16}/>}</button><a href={`${widgetUrl}?preview=1`} target="_blank" rel="noreferrer" aria-label="Открыть тестовый виджет"><ExternalLink size={16}/></a></div></div>
        <p className="poll-muted">Размер источника: 1000 × 1000. Без голосования фон прозрачен. Для теста открой ссылку со значком ↗.</p>
      </section>
    </div>

    <section className="poll-card"><div className="poll-section-title"><h3>Оформление виджета</h3><div className="poll-actions">{(['dark','light','compact'] as const).map((theme,i) => <button key={theme} onClick={() => preset(theme)}>{['Темный','Светлый','Компактный'][i]}</button>)}</div></div>
      <div className="poll-style-grid">{([['background','Фон'],['text','Текст'],['accent','Акцент'],['track','Дорожка']] as const).map(([key,label]) => <label className="poll-color" key={key}><input type="color" value={style[key]} onChange={e => setStyle({...style,[key]:e.target.value})}/>{label}</label>)}</div>
      <div className="poll-style-grid">{([['opacity','Непрозрачность, %',0,100],['width','Ширина, px',320,960],['fontSize','Текст, px',14,28],['radius','Скругление, px',0,40],['resultsSeconds','Итоги на экране, сек.',0,300]] as const).map(([key,label,min,max]) => <label className="poll-field" key={key}>{label}<input type="number" min={min} max={max} value={style[key]} onChange={e => setStyle({...style,[key]:Number(e.target.value)})}/></label>)}</div>
      <div className="poll-style-switches">{([['showTimer','Таймер'],['showCounts','Число голосов'],['showPercentages','Проценты'],['showTotal','Всего зрителей'],['optionColors','Цвет каждого варианта']] as const).map(([key,label]) => <label className="poll-check" key={key}><input type="checkbox" checked={style[key]} onChange={e => setStyle({...style,[key]:e.target.checked})}/>{label}</label>)}</div>
      {style.optionColors && <div className="poll-style-grid">{style.colors.map((color,i) => <label className="poll-color" key={i}><input aria-label={`Цвет варианта ${i+1}`} type="color" value={color} onChange={e => setStyle({...style,colors:style.colors.map((c,j)=>i===j?e.target.value:c)})}/>{i+1}</label>)}</div>}
      <div className="poll-actions"><button className="is-primary" disabled={busy || !data} onClick={() => act('style',style,'Оформление сохранено. Виджет обновится автоматически.')}>Сохранить оформление</button><span className="poll-muted">0 секунд — показывать итоги до следующего голосования.</span></div>
    </section>
    <div className="poll-admin-grid">{(['drafts','history'] as const).map(key => <section className="poll-card" key={key}><h3>{key==='drafts'?'Черновики':'История голосований'}</h3><p className="poll-muted">Последние 50 {key==='drafts'?'черновиков':'голосований'}.</p>{!data?.[key].length && <p className="poll-muted">{key==='drafts'?'Сохраняй вопросы заранее, чтобы быстро запускать их во время стрима.':'Здесь появятся завершенные голосования.'}</p>}
      <div className="poll-history">{data?.[key].map(p => <article key={p.id}><div><strong>{p.question}</strong><span>{p.options.length} варианта{key==='history'?` · ${p.totalVotes} голосов`:''}</span>{key==='history' && <details><summary>Результаты</summary>{p.options.map((label,i) => <p key={i}>{i+1}. {label} — {p.counts?.[i] ?? 0}</p>)}</details>}</div><div className="poll-actions"><button disabled={busy} onClick={() => reuse(p,key==='drafts')}>{key==='drafts'?'Открыть':'Повторить'}</button>{key==='drafts' && <button aria-label="Удалить черновик" disabled={busy} onClick={() => act('delete',{id:p.id})}><Trash2 size={15}/></button>}</div></article>)}</div>
    </section>)}</div>
  </div>;
}
