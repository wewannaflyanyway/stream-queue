import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('automation verifies both subscriptions and reconciles a missed offline event', async () => {
  const state: Record<string, unknown> = { automation_enabled:false,online:false,manual_paused:false,session_id:null,offline_at:null,last_event_at:null,last_checked_at:null,current_twitch_stream_id:null,online_subscription_id:null,offline_subscription_id:null,secret_fingerprint:null };
  const calls: { name:string; args:Record<string, unknown> }[] = [];
  let live = true;
  let confirmations = false;
  const subscriptions: { id:string; type:string; status:string; condition:{broadcaster_user_id:string}; transport:{callback:string} }[] = [];
  mock.module(new URL('../src/lib/supabase.ts',import.meta.url).href, { namedExports: {
    getServiceSupabase: () => ({
      from: (table:string) => ({
        select: () => ({eq: () => ({single: async () => ({data:table === 'stream_poll_twitch' ? {broadcaster_id:'channel'} : {...state},error:null})})}),
        update: (values:Record<string, unknown>) => ({eq: async () => { Object.assign(state,values); return {error:null}; }}),
      }),
      rpc: async (name:string,args:Record<string, unknown>) => {
        calls.push({name,args});
        if (name === 'music_stream_event') Object.assign(state,{online:args.p_type==='online',session_id:'session',current_twitch_stream_id:args.p_stream_id,last_event_at:args.p_event_at});
        if (name === 'music_stream_automation') state.automation_enabled=args.p_enabled;
        return {error:null};
      },
    }),
  } });
  mock.module(new URL('../src/lib/polls/twitch.ts',import.meta.url).href, { namedExports: {
    eventSecret: () => 'secret', twitchConfig: () => ({origin:'https://example.test'}),
    helix: async (path:string, init?:RequestInit) => {
      if (path.startsWith('streams?')) return Response.json({data:live ? [{id:'stream-1',started_at:'2026-11-01T10:00:00Z'}] : []});
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const sub = {id:body.type, type:body.type,status:'webhook_callback_verification_pending',condition:body.condition,transport:body.transport};
        subscriptions.push(sub); return Response.json({data:[sub]});
      }
      const query = new URL(`https://api.twitch.tv/helix/${path}`).searchParams;
      if (query.has('id')) return Response.json({data:[{status:confirmations ? 'enabled' : 'webhook_callback_verification_pending'}]});
      return Response.json({data:subscriptions.filter(sub=>sub.type===query.get('type')),pagination:{}});
    },
  } });
  try {
    const { enableStreamAutomation, reconcileStreamState } = await import('../src/lib/stream/lifecycle');
    await assert.rejects(enableStreamAutomation(), /еще не подтвердил/);
    assert.equal(state.automation_enabled,false);
    confirmations=true;
    await enableStreamAutomation();
    assert.equal(state.automation_enabled,true);
    assert.equal(state.online,true);
    assert.equal(state.online_subscription_id,'stream.online');
    assert.equal(state.offline_subscription_id,'stream.offline');
    assert.equal(subscriptions.length,2); // retry reuses the pending subscriptions
    live=false;
    state.last_event_at='2026-01-01T00:00:00Z'; state.last_checked_at=null;
    await reconcileStreamState();
    assert.equal(state.online,false);
    assert.equal(calls.at(-1)?.args.p_type,'offline');
    state.offline_subscription_id=null;
    await assert.rejects(reconcileStreamState(),/восстановить/);
    assert.equal((await reconcileStreamState(false))?.online,false);
  } finally { mock.restoreAll(); }
});
