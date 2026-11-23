/**
 * Community-view discovery: what an `examples/<dir>/` folder with a
 * `preset.json` turns into, from the text of its `preset.json` and
 * `config.yaml`, so it is tested even while no such folder exists.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../schema/load.js';
import { createRegistry } from '../../schema/registry.js';
import { communityPreset, communityPresetsFrom } from '../presets.js';
import { DEFAULT_ACCESSION } from '../url-state.js';
import defaultConfigYaml from '../../default-config.yaml?raw';
import extendDefaultConfig from '../../../examples/extend-default/config.yaml?raw';
import sequenceInlineConfig from '../../../examples/sequence-inline/config.yaml?raw';
import { version } from '../../../package.json';

const PTEN = [
  'accession: P60484',
  'rows:',
  '  - id: variants',
  '    kind: features',
  '    data: ./variants.csv',
  '',
].join('\n');
const MANIFEST = '{ "label": "Clinical variants (PTEN)", "length": 403 }';

/** The docs site serves the shipped base config here (see presets.ts). */
const extendsFetcher = async (ref: string): Promise<string> => {
  if (ref === '/protvista/default-config.yaml') return defaultConfigYaml;
  throw new Error(`unexpected extends target: ${ref}`);
};

describe('communityPreset', () => {
  it('turns a folder into a preset with its served data and accession', () => {
    const preset = communityPreset('pten-team', MANIFEST, PTEN);
    expect(preset).toMatchObject({
      id: 'community-pten-team',
      label: 'Clinical variants (PTEN)',
      accession: 'P60484',
      length: 403,
    });
    expect(preset.config).toContain(
      'data: /protvista/sample-data/pten-team/variants.csv'
    );
  });

  it.each([
    ['examples/extend-default', extendDefaultConfig],
    [
      'the starter-kit recipe pin',
      extendDefaultConfig.replace(
        /^extends: .*$/m,
        `extends: https://cdn.jsdelivr.net/npm/protvista-uniprot@${version}/dist/default-config.yaml`
      ),
    ],
  ])('a view that extends the default viewer like %s loads', async (_, raw) => {
    const preset = communityPreset('ext-team', '{ "label": "Mine" }', raw);
    expect(preset.config).toMatch(
      /^extends: \/protvista\/default-config\.yaml$/m
    );
    await expect(
      loadConfig(preset.config, {
        accession: preset.accession,
        registry: createRegistry(),
        extendsFetcher,
        requireProtein: true,
      })
    ).resolves.toBeDefined();
  });

  it.each([
    ['no label', '{ "title": "Team B" }', /examples\/b\/preset\.json: "label"/],
    ['a blank label', '{ "label": " " }', /examples\/b\/preset\.json: "label"/],
    ['a numeric label', '{ "label": 7 }', /examples\/b\/preset\.json: "label"/],
    ['null', 'null', /examples\/b\/preset\.json: "label"/],
    ['a trailing comma', '{ "label": "B", }', /examples\/b\/preset\.json: /],
    ['a string length', '{ "label": "B", "length": "403" }', /"length"/],
    [
      'a numeric description',
      '{ "label": "B", "description": 1 }',
      /"description"/,
    ],
  ])('names the folder for a preset.json with %s', (_, manifest, message) => {
    expect(() => communityPreset('b', manifest, PTEN)).toThrow(message);
  });

  it('names the folder for a preset.json with no config.yaml', () => {
    expect(() => communityPreset('b', MANIFEST, undefined)).toThrow(
      'examples/b: preset.json but no config.yaml'
    );
  });

  it('rejects a folder name the served path and #preset= link cannot carry', () => {
    expect(() => communityPreset('PTEN team', MANIFEST, PTEN)).toThrow(
      /examples\/PTEN team: use only letters/
    );
  });

  it('drops the length of a sequence: view rather than file it under the default accession', () => {
    const preset = communityPreset(
      'construct',
      '{ "label": "My construct", "length": 240 }',
      sequenceInlineConfig
    );
    expect(preset.accession).toBe(DEFAULT_ACCESSION);
    expect(preset.length).toBeUndefined();
  });
});

describe('communityPresetsFrom', () => {
  it('pairs each preset.json with its config.yaml and sorts by label', () => {
    const presets = communityPresetsFrom(
      {
        '../../examples/pten/preset.json': MANIFEST,
        '../../examples/abc/preset.json': '{ "label": "Antibody design" }',
      },
      {
        '../../examples/pten/config.yaml': PTEN,
        '../../examples/abc/config.yaml': sequenceInlineConfig,
        '../../examples/csv/config.yaml': 'accession: P05067\n',
      }
    );
    expect(presets.map((p) => p.id)).toEqual([
      'community-abc',
      'community-pten',
    ]);
  });

  it('names the folder whose preset.json has no config.yaml', () => {
    expect(() =>
      communityPresetsFrom({ '../../examples/lone/preset.json': MANIFEST }, {})
    ).toThrow('examples/lone: preset.json but no config.yaml');
  });
});
