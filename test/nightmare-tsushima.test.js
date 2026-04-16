import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTsushimaApiPayload,
  DEFAULT_TSUSHIMA_CREDIT_TEXT,
  summarizeNightmareApiFailure,
} from '../src/api/nightmare-tsushima.js';

test('buildTsushimaApiPayload uses default credits when empty', () => {
  const draft = {
    map_slug: 'shadow-cliffs',
    week: '1.1',
    credits: '   ',
    waves: Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [
        `wave_${i + 1}`,
        {
          '1': { zone_en: 'A', zone_ru: 'А', spawn_en: 'L', spawn_ru: 'Л' },
          '2': { zone_en: 'B', zone_ru: 'Б', spawn_en: 'M', spawn_ru: 'М' },
          '3': { zone_en: 'C', zone_ru: 'В', spawn_en: 'R', spawn_ru: 'Р' },
        },
      ]),
    ),
  };

  const payload = buildTsushimaApiPayload(draft);
  assert.equal(payload.credit_text, DEFAULT_TSUSHIMA_CREDIT_TEXT);
  assert.equal(payload.waves.length, 15);
  assert.equal(payload.waves[0].spawns.length, 3);
  assert.deepEqual(Object.keys(payload.waves[0].spawns[0]).sort(), ['order', 'spawn', 'zone']);
});

test('summarizeNightmareApiFailure includes validation details', () => {
  const message = summarizeNightmareApiFailure({
    ok: false,
    status: 400,
    json: {
      error: {
        message: 'Validation failed',
        details: [{ path: 'waves[0].spawns[0].zone', message: 'Required' }],
      },
    },
  });
  assert.match(message, /Validation failed/);
  assert.match(message, /waves\[0\]\.spawns\[0\]\.zone/);
});
