import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('music-table privacy migration denies anonymous reads and preserves service access', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table song_requests(id int); create table stream_settings(id int); insert into song_requests values(1); insert into stream_settings values(1); grant all on song_requests, stream_settings to anon, authenticated;');
    await db.exec(await readFile(new URL('../supabase/migrations/202611050001_private_music_tables.sql', import.meta.url), 'utf8'));
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from song_requests'), /permission denied/);
    await assert.rejects(db.query('select * from stream_settings'), /permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select * from song_requests')).rows.length, 1);
    assert.equal((await db.query('select * from stream_settings')).rows.length, 1);
  } finally { await db.close(); }
});
