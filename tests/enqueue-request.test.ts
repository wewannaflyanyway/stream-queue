import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('Spotify failures keep uncertain requests locked, while no active player allows retry', async () => {
  let failure: string | null = null;
  let claimed = true;
  const outcomes: string[] = [];
  mock.module(new URL('../src/lib/spotify.ts', import.meta.url).href, { namedExports: { addTrackToSpotifyQueue: async () => { if (failure) throw new Error(failure); } } });
  try {
    const { enqueueRequest } = await import('../src/lib/enqueue-request');
    const db = { rpc: async (name: string, args: { p_outcome?: string }) => name === 'music_claim_request' ? { data: claimed ? 'spotify:track:test' : null, error: null } : (outcomes.push(args.p_outcome!), { data: true, error: null }) };
    assert.equal(await enqueueRequest(db as never, 'one'), 'queued');
    failure = 'NO_ACTIVE_DEVICE';
    assert.equal(await enqueueRequest(db as never, 'two'), 'not_available');
    failure = 'timeout';
    assert.equal(await enqueueRequest(db as never, 'three'), 'uncertain');
    claimed = false;
    assert.equal(await enqueueRequest(db as never, 'four'), 'already_claimed');
    assert.deepEqual(outcomes, ['queued', 'retry', 'uncertain']);
  } finally { mock.restoreAll(); }
});
