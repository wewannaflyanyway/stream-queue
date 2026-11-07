import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('verified chat deliveries are accepted only in enabled mode and only once', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table song_requests(id uuid); create table stream_poll_twitch(id int, broadcaster_id text, subscription_id text, status text); insert into stream_poll_twitch values(1,'10','sub','enabled');");
    await db.exec(await readFile(new URL('../supabase/migrations/202611050000_twitch_chat_commands.sql', import.meta.url), 'utf8'));
    const claim = async (message: string, broadcaster = '10') => (await db.query<{ ok: boolean }>('select music_claim_chat_message($1,$2,$3) as ok', ['sub', broadcaster, message])).rows[0].ok;
    assert.equal(await claim('one'), false);
    await db.exec('update stream_poll_twitch set music_commands_enabled=true, chat_write_granted=true');
    assert.equal(await claim('one', 'wrong'), false);
    assert.equal(await claim('one'), true);
    assert.equal(await claim('one'), false);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from music_chat_deliveries'), /permission denied/);
    await assert.rejects(db.query("select music_claim_chat_message('sub','10','two')"), /permission denied/);
  } finally { await db.close(); }
});
