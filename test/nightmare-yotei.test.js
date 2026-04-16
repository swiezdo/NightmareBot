import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYoteiApiBodyToCanonical,
  buildYoteiApiPayload,
  isYoteiCanonicalApiObject,
} from '../src/api/nightmare-yotei.js';
import { createEmptyYoteiDraft } from '../src/data/rotation.js';

test('parseYoteiApiBodyToCanonical parses canonical flat payload', () => {
  const apiBody = {
    week: 3,
    credits: 'Test credits',
    map_slug: 'broken-castle',
    challenge_cards_slugs: ['a', 'b', 'c', 'd'],
    waves: [{ wave: 1, spawns: [{ order: 1, location: 'Foundry', spawn: 'left' }] }],
  };
  const parsed = parseYoteiApiBodyToCanonical(apiBody);
  assert.ok(parsed);
  assert.equal(parsed?.map_slug, 'broken-castle');
  assert.equal(parsed?.week, 3);
  assert.equal(parsed?.waves.length, 12);
  assert.equal(isYoteiCanonicalApiObject(parsed), true);
});

test('buildYoteiApiPayload builds valid waves grid', () => {
  const draft = createEmptyYoteiDraft();
  draft.week = 4;
  draft.map_slug = 'broken-castle';
  draft.credits = 'Team';
  draft.waves.wave_1['1'] = {
    zone_en: 'Foundry',
    spawn_en: 'left',
    attunements: ['Sun'],
  };
  const payload = buildYoteiApiPayload(draft);
  assert.equal(payload.week, 4);
  assert.equal(payload.waves.length, 12);
  assert.equal(payload.waves[0].spawns[0].location, 'foundry');
});
