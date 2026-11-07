import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PIN attempts are shared, rate limited, and reset after expiry', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    await db.exec(await readFile(new URL('../supabase/migrations/202611050002_admin_rate_limit.sql', import.meta.url), 'utf8'));
    const id = 'a'.repeat(64); const other = 'b'.repeat(64);
    const gate = async (client: string, correct: boolean) => (await db.query<{ allowed: boolean }>('select admin_auth_gate($1,$2) as allowed', [client, correct])).rows[0].allowed;
    for (let i = 0; i < 8; i++) assert.equal(await gate(id, false), false);
    assert.equal(await gate(id, true), false);
    assert.equal(await gate(other, true), true);
    await db.query("update admin_auth_failures set window_started=clock_timestamp()-interval '16 minutes' where client_hash=$1", [id]);
    assert.equal(await gate(id, true), true);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from admin_auth_failures'), /permission denied/);
    await assert.rejects(db.query('select admin_auth_gate($1,$2)', [id, true]), /permission denied/);
  } finally { await db.close(); }
});
