import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('claim prevents concurrent approval and requires explicit reconciliation after uncertainty', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table song_requests(id uuid primary key, spotify_uri text, status text, queued_at timestamptz, stream_pending_archived boolean default false); insert into song_requests(id,spotify_uri,status) values ('11111111-1111-1111-1111-111111111111','spotify:track:test','pending');");
    await db.exec(await readFile(new URL('../supabase/migrations/202611050003_enqueue_claims.sql', import.meta.url), 'utf8'));
    const id = '11111111-1111-1111-1111-111111111111';
    const claim = async () => (await db.query<{ uri: string | null }>('select music_claim_request($1) as uri', [id])).rows[0].uri;
    assert.equal(await claim(), 'spotify:track:test');
    assert.equal(await claim(), null);
    await assert.rejects(db.query("update song_requests set status='rejected' where id=$1", [id]), /обрабатывается/);
    assert.equal((await db.query<{ ok: boolean }>("select music_reconcile_claim($1,'retry') as ok", [id])).rows[0].ok, false);
    assert.equal((await db.query<{ ok: boolean }>("select music_resolve_claim($1,'uncertain') as ok", [id])).rows[0].ok, true);
    assert.equal(await claim(), null);
    assert.equal((await db.query<{ ok: boolean }>("select music_reconcile_claim($1,'queued') as ok", [id])).rows[0].ok, true);
    const row = (await db.query<{ status: string; queued_at: string }>('select status,queued_at from song_requests where id=$1', [id])).rows[0];
    assert.equal(row.status, 'approved');
    assert.ok(row.queued_at);
    assert.equal(await claim(), null);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from music_enqueue_claims'), /permission denied/);
  } finally { await db.close(); }
});
