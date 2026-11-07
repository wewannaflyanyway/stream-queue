import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('admin sessions are signed, expire and are invalidated when secrets change', async () => {
  const savedPin = process.env.ADMIN_PIN;
  const savedSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PIN = 'test-pin';
  process.env.ADMIN_SESSION_SECRET = 'test-session-secret';
  mock.module(new URL('../src/lib/supabase.ts', import.meta.url).href, { namedExports: { getServiceSupabase: () => ({ rpc: async (_name: string, args: { p_success: boolean }) => ({ data: args.p_success, error: null }) }) } });
  try {
    const { createAdminSession, hasAdminSession, verifyAdmin } = await import('../src/lib/admin-auth');
    const now = Date.now();
    const token = createAdminSession(now);
    const req = (value: string) => new Request('http://localhost', { headers: { cookie: `streamqueue_admin=${value}` } });
    assert.equal(hasAdminSession(req(token), now), true);
    assert.equal(hasAdminSession(req(`${token}f`), now), false);
    assert.equal(hasAdminSession(req(token), now + 9 * 60 * 60 * 1000), false);
    assert.equal(await verifyAdmin(req(''), 'wrong'), false);
    assert.equal(await verifyAdmin(req(''), 'test-pin'), true);
    process.env.ADMIN_PIN = 'changed';
    assert.equal(hasAdminSession(req(token), now), false);
  } finally {
    if (savedPin === undefined) delete process.env.ADMIN_PIN; else process.env.ADMIN_PIN = savedPin;
    if (savedSecret === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = savedSecret;
    mock.restoreAll();
  }
});
