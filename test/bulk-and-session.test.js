import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYoteiSpawnCatalog, parseBulkYoteiWavesText } from '../src/wizard/bulk-waves-text.js';
import { normalizeDraftShape } from '../src/data/rotation.js';

test('parseBulkYoteiWavesText parses full 12-wave input', () => {
  const catalog = buildYoteiSpawnCatalog('broken-castle', 'en');
  assert.ok(catalog.length >= 1);
  const token = catalog[0].displayLine;

  const lines = [];
  for (let w = 1; w <= 12; w++) {
    const slots = w <= 9 ? 3 : 4;
    lines.push(`${w}. ${Array.from({ length: slots }, () => token).join(', ')}`);
  }

  const parsed = parseBulkYoteiWavesText(lines.join('\n'), catalog);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.assignments.length, 39);
  }
});

test('normalizeDraftShape restores canonical yotei form', () => {
  const normalized = normalizeDraftShape(
    {
      week: '2',
      map_slug: 'broken-castle',
      waves: { wave_1: { '1': { zone_en: 'Foundry', spawn_en: 'left', attunements: ['Sun'] } } },
    },
    'yotei',
  );
  assert.equal(normalized.week, 2);
  assert.equal(normalized.map_slug, 'broken-castle');
  assert.equal(normalized.waves.wave_1['1'].zone_en, 'Foundry');
  assert.equal(normalized.waves.wave_10['4'].spawn_en, '');
  assert.equal('zone_ru' in normalized.waves.wave_1['1'], false);
  assert.equal('spawn_ru' in normalized.waves.wave_1['1'], false);
});

test('normalizeDraftShape migrates legacy RU fields to EN-only shape', () => {
  const normalized = normalizeDraftShape(
    {
      week: '1.1',
      map_slug: 'shadow-cliffs',
      map_name_ru: 'Скалы',
      mods: [{ mod1_ru: 'Мод 1', mod2_ru: 'Мод 2' }],
      objectives: { objective_1: { objective_ru: 'Цель' } },
      waves: {
        wave_1: {
          '1': { zone_en: 'Cliffs', zone_ru: 'Скалы', spawn_en: 'Left', spawn_ru: 'Лево' },
        },
      },
    },
    'tsushima',
  );

  assert.equal(normalized.map_slug, 'shadow-cliffs');
  assert.equal('map_name_ru' in normalized, false);
  assert.equal('mod1_ru' in normalized.mods[0], false);
  assert.equal('objective_ru' in normalized.objectives.objective_1, false);
  assert.equal('zone_ru' in normalized.waves.wave_1['1'], false);
  assert.equal('spawn_ru' in normalized.waves.wave_1['1'], false);
});
