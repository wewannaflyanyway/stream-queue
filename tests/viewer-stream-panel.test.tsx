import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewerStreamContent, type ViewerSnapshot } from '../src/components/viewer-stream-panel';

test('viewer sees a compact queue of requested tracks, moderation and live history', () => {
  const request = { id:'request',created_at:'2026-11-01',queued_at:null,stream_session_id:'session',track_name:'Заказ гостя',artist_name:'Музыкант',sender_name:'гость',spotify_uri:'spotify:demo',status:'approved' };
  const data: ViewerSnapshot = {
    stream: { online:true, automationEnabled:true, sessionId:'session', connectionHealthy:true },
    playbackAvailable:true,isPlaying:true,current:{ uri:'spotify:current',name:'Играет сейчас',artist:'Артист',request:null,ambiguous:false,possiblyRequested:false },
    queue:[{uri:'spotify:manual',name:'Личный трек',artist:'Исполнитель',request:null,ambiguous:false,possiblyRequested:false}, ...Array.from({length:7},(_,i) => ({uri:`spotify:${i}`,name:`Трек ${i+1}`,artist:'Исполнитель',request:{...request,id:`request-${i}`},ambiguous:false,possiblyRequested:true}))],
    pending:[{...request,id:'pending',status:'pending'}],history:[request],
  };
  const html = renderToStaticMarkup(<ViewerStreamContent data={data} error={false}/>);
  for (const text of ['Стрим онлайн','Играет сейчас','Трек 1','Трек 5','Показать все заказы (7)','На модерации','Заказ гостя','История заказов']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Трек 7'));
  assert.ok(!html.includes('Личный трек'));
  const offline = renderToStaticMarkup(<ViewerStreamContent data={{...data,stream:{...data.stream!,online:false}}} error={false}/>);
  assert.ok(offline.includes('Стрим офлайн'));
  assert.ok(offline.includes('История появится с началом стрима'));
  const stale = renderToStaticMarkup(<ViewerStreamContent data={data} error/>);
  assert.ok(stale.includes('Статус стрима недоступен'));
  assert.ok(stale.includes('Не удалось загрузить историю'));
  const unmanaged = renderToStaticMarkup(<ViewerStreamContent data={{...data,stream:{...data.stream!,automationEnabled:false}}} error={false}/>);
  assert.ok(unmanaged.includes('История текущего стрима появится после включения автоматики Twitch'));
  const ambiguous = renderToStaticMarkup(<ViewerStreamContent data={{...data,queue:[{uri:'spotify:duplicate',name:'Повтор',artist:'Исполнитель',request:null,ambiguous:true,possiblyRequested:true}]}} error={false}/>);
  assert.ok(ambiguous.includes('Повтор'));
  assert.ok(ambiguous.includes('возможно, заказанный трек'));
});

test('viewer sees a connection error instead of an invented empty queue', () => {
  const html = renderToStaticMarkup(<ViewerStreamContent data={null} error/>);
  assert.ok(html.includes('Очередь Spotify временно недоступна'));
  assert.ok(!html.includes('В очереди пока нет заказанных треков'));
});
