import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewerStreamContent, type ViewerSnapshot } from '../src/components/viewer-stream-panel';

test('viewer sees all player tracks, pending requests and live stream history', () => {
  const request = { id:'request',created_at:'2026-11-01',queued_at:null,stream_session_id:'session',track_name:'Заказ гостя',artist_name:'Музыкант',sender_name:'гость',spotify_uri:'spotify:demo',status:'approved' };
  const data: ViewerSnapshot = {
    stream: { online:true, automationEnabled:true, sessionId:'session', connectionHealthy:true },
    playbackAvailable:true,isPlaying:true,current:{ uri:'spotify:current',name:'Играет сейчас',artist:'Артист',request:null,ambiguous:false },
    queue:Array.from({length:7},(_,i) => ({uri:`spotify:${i}`,name:`Трек ${i+1}`,artist:'Исполнитель',request:null,ambiguous:false})),
    pending:[{...request,id:'pending',status:'pending'}],history:[request],
  };
  const html = renderToStaticMarkup(<ViewerStreamContent data={data} error={false}/>);
  for (const text of ['Стрим онлайн','Играет сейчас','Трек 1','Трек 7','На модерации','Заказ гостя','Заказы этого стрима']) assert.ok(html.includes(text), text);
  const offline = renderToStaticMarkup(<ViewerStreamContent data={{...data,stream:{...data.stream!,online:false}}} error={false}/>);
  assert.ok(offline.includes('Стрим офлайн'));
  assert.ok(!offline.includes('Заказы этого стрима'));
  const stale = renderToStaticMarkup(<ViewerStreamContent data={data} error/>);
  assert.ok(stale.includes('Статус стрима недоступен'));
  assert.ok(!stale.includes('Заказы этого стрима'));
});

test('viewer sees a connection error instead of an invented empty queue', () => {
  const html = renderToStaticMarkup(<ViewerStreamContent data={null} error/>);
  assert.ok(html.includes('Очередь Spotify временно недоступна'));
  assert.ok(!html.includes('В очереди плеера пока пусто'));
});
