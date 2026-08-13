import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateConfig,
  formatConfigErrors,
  TRACK_TYPES,
  ADAPTERS,
} from '../config-validator';
import defaultConfig from '../config';

const minimalValidConfig = {
  categories: [
    {
      name: 'MY_CATEGORY',
      label: 'My category',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'my-track',
          label: 'My track',
          trackType: 'nightingale-track-canvas',
          tooltip: 'My locally-hosted features',
          data: [
            { url: './data/my-features.json', adapter: 'feature-adapter' },
          ],
        },
      ],
    },
  ],
};

describe('validateConfig', () => {
  it('accepts a minimal user-supplied configuration', () => {
    const result = validateConfig(minimalValidConfig);
    expect(result.valid).toBe(true);
  });

  it('accepts the built-in UniProt configuration', () => {
    const result = validateConfig(defaultConfig);
    expect(result.valid).toBe(true);
  });

  it('rejects non-object values', () => {
    for (const value of [null, undefined, 42, 'config', []]) {
      const result = validateConfig(value);
      expect(result.valid).toBe(false);
    }
  });

  it('requires a non-empty categories array', () => {
    const result = validateConfig({ categories: [] });
    expect(result).toEqual({
      valid: false,
      errors: [
        {
          path: '/categories',
          message: 'categories is required and must be a non-empty array',
        },
      ],
    });
  });

  it('reports all errors with JSON-pointer paths, not just the first', () => {
    const result = validateConfig({
      categories: [
        {
          name: '',
          label: 'Broken category',
          trackType: 'not-a-track-type',
          tracks: [
            {
              name: 'broken-track',
              trackType: 'nightingale-track-canvas',
              tooltip: 'tooltip',
              data: [{ url: '', adapter: 'not-an-adapter' }],
            },
          ],
        },
      ],
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('/categories/0/name');
    expect(paths).toContain('/categories/0/trackType');
    expect(paths).toContain('/categories/0/tracks/0/data/0/url');
    expect(paths).toContain('/categories/0/tracks/0/data/0/adapter');
  });

  it('requires track data to be a non-empty array', () => {
    const config = structuredClone(minimalValidConfig);
    config.categories[0].tracks[0].data = [];
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0].path).toBe('/categories/0/tracks/0/data');
  });

  it('accepts an array of urls in a data source', () => {
    const config = structuredClone(minimalValidConfig);
    config.categories[0].tracks[0].data[0].url = [
      './data/a.json',
      './data/b.json',
    ] as unknown as string;
    expect(validateConfig(config).valid).toBe(true);
  });

  it('accepts categories with an empty tracks array', () => {
    const config = structuredClone(minimalValidConfig);
    config.categories[0].tracks = [];
    expect(validateConfig(config).valid).toBe(true);
  });
});

describe('formatConfigErrors', () => {
  it('produces one line per problem', () => {
    const message = formatConfigErrors([
      { path: '/categories', message: 'oops' },
      { path: '/categories/0/name', message: 'bad name' },
    ]);
    expect(message).toContain('2 problems');
    expect(message).toContain('/categories: oops');
    expect(message).toContain('/categories/0/name: bad name');
  });
});

describe('schema/validator consistency', () => {
  // The JSON Schema is the canonical public contract; the runtime validator
  // is a dependency-free mirror. These tests fail if the enums drift apart.
  const schema = JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'schema', 'protvista-config.schema.json'),
      'utf-8'
    )
  );

  it('trackType enums match', () => {
    expect(schema.$defs.trackType.enum).toEqual([...TRACK_TYPES]);
  });

  it('adapter enums match', () => {
    expect(schema.$defs.adapter.enum).toEqual([...ADAPTERS]);
  });
});
