import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTrackPolicy, type RequestSettings, type RequestTrack } from '../src/lib/request-policy';

const track: RequestTrack = { uri: 'spotify:track:5aEzGuXQrhQxgG20NM2b26', name: 'Numb', artist: 'Linkin Park', durationMs: 180000, isExplicit: false };
const settings: RequestSettings = { is_accepting: true, auto_approve: false, max_queue_size: 15, max_duration_sec: 300, cooldown_user_sec: 0, prevent_duplicates: false, duplicate_cooldown_min: 10, explicit_mode: 'allow', banned_words: '', banned_artists: '' };

test('shared music policy applies regardless of the source of a request', () => {
  assert.doesNotThrow(() => validateTrackPolicy(track, settings));
  assert.throws(() => validateTrackPolicy(track, { ...settings, is_accepting: false }), /закрыт/);
  assert.throws(() => validateTrackPolicy(track, { ...settings, max_duration_sec: 60 }), /длинный/);
  assert.throws(() => validateTrackPolicy({ ...track, isExplicit: true }, { ...settings, explicit_mode: 'block' }), /18\+/);
  assert.throws(() => validateTrackPolicy(track, { ...settings, banned_words: 'numb' }), /заблокирован/);
  assert.throws(() => validateTrackPolicy(track, { ...settings, banned_artists: 'linkin' }), /заблокирован/);
  assert.throws(() => validateTrackPolicy({ ...track, uri: 'https://example.com' }, settings), /проверить/);
});
