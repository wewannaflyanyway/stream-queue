import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { associateQueue, positionForUser, type PlayerItem, type QueueRequest } from '../src/lib/stream/queue';

function request(id: string, uri: string, sender = 'viewer', status = 'approved'): QueueRequest {
  return { id, spotify_uri: uri, track_name: id, artist_name: 'artist', sender_name: sender, status, created_at: `2026-11-01T00:00:0${id.length}Z`, queued_at: null, stream_session_id: 'session' };
}
function item(uri: string): PlayerItem { return { uri, name: uri, artist: 'artist' }; }

test('queue positions include manually added Spotify items and exclude the current track', () => {
  const requests = [request('own', 'spotify:own')];
  const data = associateQueue(item('spotify:current'), [item('spotify:manual'), item('spotify:own')], requests);
  assert.deepEqual(positionForUser('VIEWER', requests, data.current, data.queue, true), { kind: 'queued', ahead: 1, track: 'own' });
  assert.equal(positionForUser('viewer', [request('pending', 'p', 'viewer', 'pending')], null, [], true).kind, 'pending');
  assert.equal(positionForUser('viewer', requests, null, [], false).kind, 'unknown');
});

test('duplicate tracks never produce a falsely precise position or attribution', () => {
  const requests = [request('one', 'same'), request('two', 'same', 'another')];
  const data = associateQueue(null, [item('same'), item('same')], requests);
  assert.equal(data.queue[0].request, null);
  assert.equal(data.queue[0].ambiguous, true);
  assert.equal(data.queue[0].possiblyRequested, true);
  assert.equal(associateQueue(null, [item('other'), item('other')], requests).queue[0].possiblyRequested, false);
  assert.equal(positionForUser('viewer', requests, null, data.queue, true).kind, 'unknown');
});

test('stream sessions preserve a 30-minute reconnect and respect a manual pause', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table stream_settings(id integer primary key, is_accepting boolean); insert into stream_settings values(1,true); create table song_requests(id uuid primary key default gen_random_uuid(), status text, spotify_uri text, created_at timestamptz default now());');
    await db.exec(await readFile(new URL('../supabase/migrations/202611010001_stream_sessions.sql', import.meta.url), 'utf8'));
    const event = async (type: string, time: string, id: string | null = null) => {
      const result = await db.query<{ state: { online: boolean; session_id: string } }>('select music_stream_event($1,$2,$3,$4) as state', [type, time, id, id ? time : null]);
      return result.rows[0].state;
    };
    const accepting = async () => (await db.query<{ is_accepting: boolean }>('select is_accepting from stream_settings where id=1')).rows[0].is_accepting;
    const first = await event('online', '2026-11-01T10:00:00Z', 'first');
    await db.exec("update music_stream_state set online_subscription_id='online',offline_subscription_id='offline' where id=1");
    await db.query('select music_stream_automation(true)');
    assert.equal(await accepting(), true);
    const firstRow = await db.query<{ id: string; stream_session_id: string; queued_at: string }>("insert into song_requests(status,spotify_uri) values ('approved','spotify:one') returning id,stream_session_id,queued_at");
    assert.equal(firstRow.rows[0].stream_session_id, first.session_id);
    assert.ok(firstRow.rows[0].queued_at);
    const pendingRow = await db.query<{ id: string }>("insert into song_requests(status,spotify_uri) values ('pending','spotify:pending') returning id");
    await db.query('select music_observe_playback($1,$2,$3,$4)', [first.session_id, 'spotify:one', firstRow.rows[0].id, '2026-11-01T10:05:00Z']);
    await db.query('select music_observe_playback($1,$2,$3,$4)', [first.session_id, 'spotify:old', null, '2026-11-01T10:04:00Z']);
    let trackStatus = await db.query<{ status: string }>('select status from song_requests where id=$1', [firstRow.rows[0].id]);
    assert.equal(trackStatus.rows[0].status, 'approved');
    await db.query('select music_observe_playback($1,$2,$3,$4)', [first.session_id, 'spotify:next', null, '2026-11-01T10:06:00Z']);
    trackStatus = await db.query<{ status: string }>('select status from song_requests where id=$1', [firstRow.rows[0].id]);
    assert.equal(trackStatus.rows[0].status, 'played');
    await db.query('select music_stream_manual(false)');
    assert.equal(await accepting(), false);
    await event('offline', '2026-11-01T11:00:00Z');
    const resumed = await event('online', '2026-11-01T11:29:59Z', 'second');
    assert.equal(resumed.session_id, first.session_id);
    const stillPending = await db.query<{ stream_pending_archived: boolean }>('select stream_pending_archived from song_requests where id=$1', [pendingRow.rows[0].id]);
    assert.equal(stillPending.rows[0].stream_pending_archived, false);
    assert.equal(await accepting(), false);
    await db.query('select music_stream_manual(true)');
    assert.equal(await accepting(), true);
    await event('offline', '2026-11-01T12:00:00Z');
    assert.equal(await accepting(), false);
    await assert.rejects(db.query("insert into song_requests(status) values ('pending')"), /Прием заявок закрыт/);
    await db.query('select music_stream_manual(true)');
    assert.equal(await accepting(), false);
    const next = await event('online', '2026-11-01T12:30:01Z', 'third');
    assert.notEqual(next.session_id, first.session_id);
    const archivedPending = await db.query<{ stream_pending_archived: boolean }>('select stream_pending_archived from song_requests where id=$1', [pendingRow.rows[0].id]);
    assert.equal(archivedPending.rows[0].stream_pending_archived, true);
    assert.equal(await accepting(), true);
    await event('offline', '2026-11-01T11:30:00Z'); // stale delivery must not end the new stream
    assert.equal(await accepting(), true);
    await db.query('select music_stream_revoke($1,$2,$3)', ['stream.offline', 'obsolete', '2026-11-01T12:31:00Z']);
    assert.equal(await accepting(), true);
    await db.query('select music_stream_revoke($1,$2,$3)', ['stream.offline', 'offline', '2026-11-01T12:31:00Z']);
    assert.equal(await accepting(), false);
    await db.query('select music_stream_manual(true)');
    assert.equal(await accepting(), false);
    const archived = await db.query<{ count: number }>('select count(*)::int as count from song_requests where stream_session_id=$1', [first.session_id]);
    assert.equal(archived.rows[0].count, 2);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from music_stream_state'), /permission denied/);
  } finally { await db.close(); }
});
