import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

test('saving unrelated settings cannot override manual pause or open orders offline', async () => {
  const originalPin = process.env.ADMIN_PIN;
  process.env.ADMIN_PIN = 'local-test-pin';
  const updates: Record<string, unknown>[] = [];
  const manual: boolean[] = [];
  let accepting = false;
  mock.module(new URL('../src/lib/supabase.ts',import.meta.url).href, { namedExports: {
    getServiceSupabase: () => ({
      from: () => ({
        update: (values:Record<string, unknown>) => ({eq: async () => { updates.push(values); if (typeof values.is_accepting === 'boolean') accepting=values.is_accepting; return {error:null}; }}),
        select: () => ({eq: () => ({single: async () => ({data:{is_accepting:accepting},error:null})})}),
      }),
      rpc: async (name:string,args:{p_accepting:boolean}) => { if (name==='music_stream_manual') { manual.push(args.p_accepting); accepting=false; } return {error:null}; },
    }),
  } });
  mock.module(new URL('../src/lib/spotify.ts',import.meta.url).href, { namedExports: { addTrackToSpotifyQueue: async () => true, skipSpotifyTrack: async () => true } });
  mock.module(new URL('../src/lib/stream/lifecycle.ts',import.meta.url).href, { namedExports: {
    readStreamState: async () => ({automation_enabled:true,online:false}),
    reconcileStreamState: async () => null, enableStreamAutomation: async () => {},
  } });
  try {
    const { POST } = await import('../src/app/api/admin/route');
    const send = (action:string,payload:object,pin='local-test-pin') => POST(new NextRequest('http://localhost/api/admin', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin,action,payload}) }));
    assert.equal((await send('update_settings',{is_accepting:true,max_queue_size:20})).status,200);
    assert.deepEqual(updates,[{max_queue_size:20}]);
    assert.deepEqual(manual,[]);
    const response = await send('set_accepting',{is_accepting:true});
    assert.equal((await response.json()).is_accepting,false);
    assert.deepEqual(manual,[true]);
    assert.equal((await send('set_accepting',{is_accepting:true},'wrong')).status,401);
  } finally {
    if (originalPin === undefined) delete process.env.ADMIN_PIN; else process.env.ADMIN_PIN=originalPin;
    mock.restoreAll();
  }
});
