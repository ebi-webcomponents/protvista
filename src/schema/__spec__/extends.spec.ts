/**
 * `extends` merger contract tests (#20).
 *
 * Covers every rule specs/config-approach.md documents for `extends`:
 *   - sources merged by key (child wins)
 *   - defaults merged field-wise; rendering + colorScale nested
 *   - categories merged by id (extend in place, append new at end)
 *   - tracks merged by id within a merged category
 *   - rendering field-wise at every level
 *   - array extends: multi-parent, left-to-right, later wins
 *   - chains: recursive resolution
 *   - cycle detection: `a → b → a` with descriptive message
 *   - cannot-resolve-extends: unknown preset without URL/path pattern
 *   - resolver: function AND object form
 *   - URL/path fallback fetcher
 *   - `extends` never appears on output
 *   - `loadConfig` integration: partial child config merges pre-validate
 */

import { describe, it, expect } from 'vitest';
import { mergeExtends } from '../extends';
import { loadConfig } from '../load';
import { ConfigValidationError } from '../errors';
import type { ProtvistaViewerConfig } from '../types';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const base = (): ProtvistaViewerConfig => ({
  sources: {
    features: 'https://example.org/features',
    variation: 'https://example.org/variation',
  },
  defaults: {
    rendering: { layout: 'non-overlapping', color: '#333' },
    labelUrl: 'https://example.org/{accession}',
  },
  categories: [
    {
      id: 'DOMAINS',
      label: 'Domains',
      tracks: [
        { id: 'domain', kind: 'features', data: 'features' },
        { id: 'region', kind: 'features', data: 'features' },
      ],
    },
    {
      id: 'VARIATION',
      label: 'Variants',
      tracks: [{ id: 'variation', kind: 'variants', data: 'variation' }],
    },
  ],
});

// ─────────────────────────────────────────────────────────────
// No-op
// ─────────────────────────────────────────────────────────────

describe('mergeExtends — no extends', () => {
  it('returns a config without extends unchanged', async () => {
    const cfg = base();
    const out = await mergeExtends(cfg);
    expect(out).toEqual(cfg);
  });

  it('never returns an object with an `extends` key', async () => {
    const cfg: ProtvistaViewerConfig = {
      ...base(),
      extends: '@acme/base',
    };
    const out = await mergeExtends(cfg, { resolver: { '@acme/base': base() } });
    expect('extends' in out).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Simple two-layer merge
// ─────────────────────────────────────────────────────────────

describe('mergeExtends — basic merge', () => {
  it('child sources override same-key base sources', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      sources: { features: 'https://child.example/features' },
      categories: [],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.sources?.features).toBe('https://child.example/features');
    // base-only key survives
    expect(out.sources?.variation).toBe('https://example.org/variation');
  });

  it('child defaults override base defaults field-wise', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      defaults: { rendering: { color: '#ff0' } },
      categories: [],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.defaults?.rendering?.color).toBe('#ff0');
    // base defaults.rendering.layout survives
    expect(out.defaults?.rendering?.layout).toBe('non-overlapping');
    // base defaults.labelUrl survives
    expect(out.defaults?.labelUrl).toBe('https://example.org/{accession}');
  });

  it('categories with known id are extended in place', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [
        {
          id: 'DOMAINS',
          label: 'Overridden label',
          tracks: [],
        },
      ],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.categories[0].id).toBe('DOMAINS');
    expect(out.categories[0].label).toBe('Overridden label');
    // Base tracks survive when child provides empty tracks
    expect(out.categories[0].tracks.map((t) => t.id)).toEqual([
      'domain',
      'region',
    ]);
  });

  it('categories with new id are appended at the end', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [
        {
          id: 'MY_LAB',
          label: 'My Lab',
          tracks: [{ id: 'hotspots', kind: 'features', data: 'features' }],
        },
      ],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.categories.map((c) => c.id)).toEqual([
      'DOMAINS',
      'VARIATION',
      'MY_LAB',
    ]);
  });

  it('tracks within a merged category are matched by id', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [
        {
          id: 'DOMAINS',
          tracks: [
            // Extend existing `region`
            {
              id: 'region',
              label: 'Renamed region',
              kind: 'features',
              data: 'features',
            },
            // Append new
            {
              id: 'motif',
              kind: 'features',
              data: 'features',
            },
          ],
        },
      ],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    const dom = out.categories.find((c) => c.id === 'DOMAINS')!;
    expect(dom.tracks.map((t) => t.id)).toEqual(['domain', 'region', 'motif']);
    expect(dom.tracks.find((t) => t.id === 'region')?.label).toBe(
      'Renamed region'
    );
  });

  it('rendering merges field-wise at category level', async () => {
    const withBaseRendering: ProtvistaViewerConfig = {
      ...base(),
      categories: [
        {
          id: 'X',
          rendering: { color: '#000', height: 20 },
          tracks: [{ id: 't', kind: 'features', data: 'features' }],
        },
      ],
    };
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [
        {
          id: 'X',
          rendering: { color: '#fff' }, // override color only
          tracks: [],
        },
      ],
    };
    const out = await mergeExtends(child, {
      resolver: { '@base': withBaseRendering },
    });
    const cat = out.categories.find((c) => c.id === 'X')!;
    expect(cat.rendering?.color).toBe('#fff');
    expect(cat.rendering?.height).toBe(20);
  });

  it('colorScale nested sub-object merges field-wise', async () => {
    const withStops: ProtvistaViewerConfig = {
      ...base(),
      defaults: {
        rendering: {
          colorScale: {
            stops: [
              { value: 0, color: '#000' },
              { value: 1, color: '#fff' },
            ],
          },
        },
      },
    };
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      defaults: {
        rendering: { colorScale: { theme: 'alphafold-ramp' } },
      },
      categories: [],
    };
    const out = await mergeExtends(child, {
      resolver: { '@base': withStops },
    });
    const cs = out.defaults?.rendering?.colorScale;
    expect(cs?.theme).toBe('alphafold-ramp');
    // base stops survive
    expect(cs?.stops).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Array / chain / recursive
// ─────────────────────────────────────────────────────────────

describe('mergeExtends — array / chain', () => {
  it('accepts extends as an array; later parents override earlier', async () => {
    const a: ProtvistaViewerConfig = {
      sources: { features: 'https://a/features' },
      categories: [],
    };
    const b: ProtvistaViewerConfig = {
      sources: { features: 'https://b/features' },
      categories: [],
    };
    const child: ProtvistaViewerConfig = {
      extends: ['@a', '@b'],
      categories: [],
    };
    const out = await mergeExtends(child, { resolver: { '@a': a, '@b': b } });
    // b overrides a
    expect(out.sources?.features).toBe('https://b/features');
  });

  it('child overrides all parents at root level', async () => {
    const a: ProtvistaViewerConfig = {
      sources: { features: 'https://a' },
      categories: [],
    };
    const child: ProtvistaViewerConfig = {
      extends: '@a',
      sources: { features: 'https://child' },
      categories: [],
    };
    const out = await mergeExtends(child, { resolver: { '@a': a } });
    expect(out.sources?.features).toBe('https://child');
  });

  it('resolves recursive extends (child → A → B)', async () => {
    const b: ProtvistaViewerConfig = {
      sources: { a: 'https://b/a', b: 'https://b/b' },
      categories: [],
    };
    const a: ProtvistaViewerConfig = {
      extends: '@b',
      sources: { a: 'https://a/a' }, // override b's a
      categories: [],
    };
    const child: ProtvistaViewerConfig = {
      extends: '@a',
      sources: { c: 'https://child/c' },
      categories: [],
    };
    const out = await mergeExtends(child, {
      resolver: { '@a': a, '@b': b },
    });
    expect(out.sources).toEqual({
      a: 'https://a/a', // from A (A's override of B)
      b: 'https://b/b', // from B (inherited through A)
      c: 'https://child/c', // from child
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Cycle detection
// ─────────────────────────────────────────────────────────────

describe('mergeExtends — cycle detection', () => {
  it('detects a direct self-extends (A → A)', async () => {
    const a: ProtvistaViewerConfig = {
      extends: '@a',
      categories: [],
    };
    await expect(
      mergeExtends(a, { resolver: { '@a': a } })
    ).rejects.toThrow(ConfigValidationError);
  });

  it('detects a two-step cycle (A → B → A) with descriptive message', async () => {
    const a: ProtvistaViewerConfig = { extends: '@b', categories: [] };
    const b: ProtvistaViewerConfig = { extends: '@a', categories: [] };
    try {
      await mergeExtends(
        { extends: '@a', categories: [] } as ProtvistaViewerConfig,
        { resolver: { '@a': a, '@b': b } }
      );
      throw new Error('expected mergeExtends to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const cve = err as ConfigValidationError;
      expect(cve.issues[0].code).toBe('circular-extends');
      // Spec.md wording: names listed in walk order, arrows between.
      expect(cve.issues[0].message).toContain('@a');
      expect(cve.issues[0].message).toContain('@b');
      expect(cve.issues[0].message).toMatch(/Circular extends:/);
      expect(cve.issues[0].message).toContain('→');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Resolution failures
// ─────────────────────────────────────────────────────────────

describe('mergeExtends — resolution failures', () => {
  it('throws cannot-resolve-extends on an unknown preset name', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@acme/nope',
      categories: [],
    };
    try {
      await mergeExtends(child);
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const cve = err as ConfigValidationError;
      expect(cve.issues[0].code).toBe('cannot-resolve-extends');
      expect(cve.issues[0].message).toContain('@acme/nope');
    }
  });

  it('throws extends-parse-error naming the target when fetched text is malformed', async () => {
    // Guards against a long-standing UX wart: when an extends chain is
    // three-deep and one file has a stray comma, a bare "Unexpected
    // token" doesn't tell the author which file is broken. We catch
    // the parse failure at the extends boundary and re-throw with the
    // target name (preset or URL) woven into the message.
    const child: ProtvistaViewerConfig = {
      extends: './broken.json',
      categories: [],
    };
    try {
      await mergeExtends(child, {
        fetcher: async () => '{ not: valid JSON,,',
      });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const cve = err as ConfigValidationError;
      expect(cve.issues[0].code).toBe('extends-parse-error');
      expect(cve.issues[0].path).toBe('/extends');
      // Target name appears in the message so the author can grep for it.
      expect(cve.issues[0].message).toContain('./broken.json');
    }
  });

  it('falls back to fetcher when resolver declines and name looks like a URL', async () => {
    const child: ProtvistaViewerConfig = {
      extends: 'https://presets.example.org/base.json',
      categories: [],
    };
    const baseJson = JSON.stringify({
      sources: { features: 'https://fetched/features' },
      categories: [],
    });
    const out = await mergeExtends(child, {
      fetcher: async (url) => {
        expect(url).toBe('https://presets.example.org/base.json');
        return baseJson;
      },
    });
    expect(out.sources?.features).toBe('https://fetched/features');
  });

  it('fetcher result is parsed as YAML when it does not start with { or [', async () => {
    const child: ProtvistaViewerConfig = {
      extends: './base.yaml',
      categories: [],
    };
    const out = await mergeExtends(child, {
      fetcher: async () =>
        [
          'sources:',
          '  features: https://yaml/features',
          'categories: []',
        ].join('\n'),
    });
    expect(out.sources?.features).toBe('https://yaml/features');
  });
});

// ─────────────────────────────────────────────────────────────
// Resolver shapes
// ─────────────────────────────────────────────────────────────

describe('mergeExtends — resolver shapes', () => {
  it('accepts a function resolver (sync return)', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [],
    };
    const out = await mergeExtends(child, {
      resolver: (name) =>
        name === '@base'
          ? ({ sources: { a: 'https://a' }, categories: [] } as ProtvistaViewerConfig)
          : undefined,
    });
    expect(out.sources?.a).toBe('https://a');
  });

  it('accepts a function resolver (async return)', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [],
    };
    const out = await mergeExtends(child, {
      resolver: async (name) => {
        if (name !== '@base') return undefined;
        return { sources: { a: 'https://a' }, categories: [] };
      },
    });
    expect(out.sources?.a).toBe('https://a');
  });

  it('resolver can return a raw string (JSON) for re-parsing', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [],
    };
    const out = await mergeExtends(child, {
      resolver: (name) =>
        name === '@base'
          ? JSON.stringify({ sources: { a: 'https://a' }, categories: [] })
          : undefined,
    });
    expect(out.sources?.a).toBe('https://a');
  });

  it('resolver can return a raw string (YAML) for re-parsing', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      categories: [],
    };
    const out = await mergeExtends(child, {
      resolver: (name) =>
        name === '@base'
          ? 'sources:\n  a: https://a\ncategories: []\n'
          : undefined,
    });
    expect(out.sources?.a).toBe('https://a');
  });
});

// ─────────────────────────────────────────────────────────────
// loadConfig integration
// ─────────────────────────────────────────────────────────────

describe('loadConfig — extends integration', () => {
  it('resolves extends before schema validation (partial child is accepted)', async () => {
    // The child has NO `categories` key; pre-merge that would fail
    // schema validation. After merging the base, it should pass.
    const childYaml = `
extends: "@base"
sources:
  extra: https://extra
`;
    const normalized = await loadConfig(childYaml, {
      extendsResolver: {
        '@base': {
          categories: [
            {
              id: 'X',
              tracks: [{ id: 't', kind: 'features', data: 'sources' }],
            },
          ],
          sources: { sources: 'https://base/src' },
        } as ProtvistaViewerConfig,
      },
    });
    expect(normalized.categories).toHaveLength(1);
    expect(normalized.sources.extra).toBe('https://extra');
    expect(normalized.sources.sources).toBe('https://base/src');
  });

  it('propagates ConfigValidationError when merged result still fails semantic checks', async () => {
    await expect(
      loadConfig(
        {
          extends: '@base',
          categories: [
            {
              id: 'X',
              tracks: [
                { id: 't', kind: 'not-a-kind', data: 'missingSourceKey' },
              ],
            },
          ],
        } as ProtvistaViewerConfig,
        {
          extendsResolver: {
            '@base': { categories: [] } as ProtvistaViewerConfig,
          },
        }
      )
    ).rejects.toThrow(ConfigValidationError);
  });
});
