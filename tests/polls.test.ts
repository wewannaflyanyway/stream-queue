import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_STYLE, PREVIEW_POLL, parseVote, publicPoll, validateDraft, validateStyle } from '../src/lib/polls/model';
import { verifyTwitchSignature } from '../src/lib/polls/signature';

test('vote syntax accepts exact choices and rejects ordinary chat', () => {
  assert.equal(parseVote(' 2 ', 'number', 3), 2);
  assert.equal(parseVote('!VOTE 3','command',3),3);
  for (const text of ['12','2!','!vote 2','1 2','0','4','I choose 2']) assert.equal(parseVote(text,'number',3),null);
  assert.equal(parseVote('2','command',3),null);
});

test('validation strips unknown settings, rejects CSS injection and duplicate options', () => {
  assert.deepEqual(validateStyle({...DEFAULT_STYLE, unexpected:'secret'}),DEFAULT_STYLE);
  assert.throws(() => validateStyle({...DEFAULT_STYLE,background:'url(https://example.com)'}));
  assert.throws(() => validateStyle({...DEFAULT_STYLE,width:99999}));
  const draft = {...PREVIEW_POLL,id:randomUUID()};
  assert.equal(validateDraft(draft).options.length,3);
  assert.throws(() => validateDraft({...draft,options:['Same',' same ']}));
  assert.throws(() => validateDraft({...draft,durationSec:-1}));
  assert.throws(() => validateDraft({...draft,options:[''] }));
});

test('public snapshot hides running distribution and reveals final result', () => {
  assert.equal(publicPoll({...PREVIEW_POLL,hideResults:true})?.counts,null);
  assert.deepEqual(publicPoll({...PREVIEW_POLL,hideResults:true,status:'ended'})?.counts,[26,15,9]);
  assert.deepEqual(PREVIEW_POLL.counts,[26,15,9]);
});

test('webhook requires exact signature, body and fresh timestamp', () => {
  const raw = '{"challenge":"hello"}', secret = 'test-secret', timestamp = new Date().toISOString();
  const headers = new Headers({ 'twitch-eventsub-message-id':'message-1', 'twitch-eventsub-message-timestamp':timestamp,
    'twitch-eventsub-message-signature':'sha256='+createHmac('sha256',secret).update('message-1'+timestamp+raw).digest('hex') });
  assert.equal(verifyTwitchSignature(raw,headers,secret),true);
  assert.equal(verifyTwitchSignature(raw+' ',headers,secret),false);
  assert.equal(verifyTwitchSignature(raw,headers,'other-secret'),false);
  assert.equal(verifyTwitchSignature(raw,headers,secret,Date.now()+601000),false);
  headers.delete('twitch-eventsub-message-id');
  assert.equal(verifyTwitchSignature(raw,headers,secret),false);
});

test('Postgres migration and poll lifecycle preserve votes and enforce permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610290001_stream_polls.sql',import.meta.url),'utf8'));
    const action = async (name:string,payload:unknown) => db.query('select stream_poll_action($1,$2::jsonb)',[name,JSON.stringify(payload)]);
    const snapshot = async (admin=true) => (await db.query<{state:{polls: {id:string;status:string;counts:number[];total_votes:number;ends_at:string}[]}}>('select stream_poll_state($1) as state',[admin])).rows[0].state;
    const draft = {...validateDraft({...PREVIEW_POLL,id:randomUUID()}),options:['First','Second'],hideResults:true};
    await action('save',draft);
    assert.equal((await snapshot(false)).polls.length,0);
    await assert.rejects(action('start',draft),/подключите/);
    await db.exec("update stream_poll_twitch set broadcaster_id='channel',subscription_id='subscription',status='enabled' where id=1");
    await action('start',draft);
    await action('start',draft); // retry is idempotent
    await assert.rejects(action('start',{...draft,id:randomUUID()}),/завершите/);
    await assert.rejects(action('save',draft),/редактировать/);
    const start = Date.now();
    const vote = async (user:string,text:string,millis:number,id:string,subscription='subscription') => {
      const result = await db.query<{accepted:boolean}>('select stream_poll_vote($1,$2,$3,$4,$5,$6) as accepted',[subscription,'channel',user,id,text,new Date(millis).toISOString()]);
      return result.rows[0].accepted;
    };
    assert.equal(await vote('alice','1',start,'m1'),true);
    assert.equal(await vote('alice','1',start,'m1'),false); // same webhook
    assert.equal(await vote('alice','2',start+2,'m2'),true); // latest choice
    assert.equal(await vote('alice','1',start+3,'m1'),false); // old message retried with a fresh delivery timestamp
    assert.equal(await vote('alice','1',start+1,'old-message'),false); // delayed delivery
    assert.equal(await vote('bob','1',start+3,'m3'),true);
    assert.equal(await vote('bob','2',start+4,'m4','wrong-subscription'),false);
    assert.equal(await vote('new-user','1',start-3600000,'before-start'),false);
    assert.equal(await vote('new-user','hello 1',start+5,'ordinary-chat'),false);
    assert.equal(await vote('new-user','3',start+5,'out-of-range'),false);
    let state = await snapshot();
    assert.deepEqual(state.polls[0].counts,[1,1]);
    assert.equal(state.polls[0].total_votes,2);
    const before = Date.parse(state.polls[0].ends_at);
    await action('extend',{id:draft.id});
    assert.equal(Date.parse((await snapshot()).polls[0].ends_at)-before,30000);
    await db.query("update stream_polls set ends_at=clock_timestamp()+interval '3 seconds' where id=$1",[draft.id]);
    assert.equal(await vote('future-user','1',Date.now()+5000,'beyond-deadline'),false);
    await action('finish',{id:draft.id});
    assert.equal(await vote('late-user','1',Date.now(),'late'),false);
    assert.equal((await snapshot()).polls[0].status,'ended');

    const second = {...draft,id:randomUUID(),allowRevote:false,votingMode:'command',durationSec:null};
    await action('start',second);
    assert.equal(await vote('alice','1',Date.now(),'plain-number'),false);
    assert.equal(await vote('alice','!vote 1',Date.now(),'command-1'),true);
    assert.equal(await vote('alice','!vote 2',Date.now()+1,'command-2'),false);
    state = await snapshot();
    assert.deepEqual(state.polls.find(p=>p.id===second.id)?.counts,[1,0]);
    await db.query("update stream_polls set ends_at=clock_timestamp()-interval '1 second' where id=$1",[second.id]);
    assert.equal(await vote('after-expiry','!vote 2',Date.now(),'expired'),false);
    assert.equal((await snapshot()).polls.find(p=>p.id===second.id)?.status,'ended');

    await db.exec('set role anon;');
    await assert.rejects(db.query('select * from stream_poll_votes'),/permission denied/);
    await assert.rejects(db.query('select stream_poll_state(true)'),/permission denied/);
    await assert.rejects(db.query("select stream_poll_action('style','{}')"),/permission denied/);
    await db.exec('reset role; set role authenticated;');
    await assert.rejects(db.query('select * from stream_poll_twitch'),/permission denied/);
    await db.exec('reset role; set role service_role;');
    assert.equal((await snapshot()).polls.length,2);
    await action('style',DEFAULT_STYLE);
    await action('visibility',{visible:false});
    await action('start',{...draft,id:randomUUID()});
    const visible = await db.query<{visible:boolean}>('select visible from stream_poll_settings where id=1');
    assert.equal(visible.rows[0].visible,true);
  } finally { await db.close(); }
});
