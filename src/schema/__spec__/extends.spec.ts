/**
 * `extends` merger contract tests.
 *
 * Covers every documented rule for `extends`:
 *   - sources merged by key (child wins)
 *   - defaults merged field-wise; rendering + colorScale nested
 *   - groups merged by id (extend in place, append new at end)
 *   - tracks merged by id within a merged group
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
import type {
  GroupConfig,
  ProtvistaViewerConfig,
  TopLevelEntry,
} from '../types';
import { isGroupConfig } from '../discriminate';

// Narrow a merged top-level entry to a group for `.tracks` assertions,
// failing loudly if a test accidentally produced a standalone track.
const asGroup = (entry: TopLevelEntry | undefined): GroupConfig => {
  if (!entry || !isGroupConfig(entry)) {
    throw new Error(`expected a group entry, got ${entry?.id ?? 'undefined'}`);
  }
  return entry;
};

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
  groups: [
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
      groups: [],
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
      groups: [],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.defaults?.rendering?.color).toBe('#ff0');
    // base defaults.rendering.layout survives
    expect(out.defaults?.rendering?.layout).toBe('non-overlapping');
    // base defaults.labelUrl survives
    expect(out.defaults?.labelUrl).toBe('https://example.org/{accession}');
  });

  it('groups with known id are extended in place', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [
        {
          id: 'DOMAINS',
          label: 'Overridden label',
          tracks: [],
        },
      ],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.groups[0].id).toBe('DOMAINS');
    expect(out.groups[0].label).toBe('Overridden label');
    // Base tracks survive when child provides empty tracks
    expect(asGroup(out.groups[0]).tracks.map((t) => t.id)).toEqual([
      'domain',
      'region',
    ]);
  });

  it('groups with new id are appended at the end', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [
        {
          id: 'MY_LAB',
          label: 'My Lab',
          tracks: [{ id: 'hotspots', kind: 'features', data: 'features' }],
        },
      ],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.groups.map((c) => c.id)).toEqual([
      'DOMAINS',
      'VARIATION',
      'MY_LAB',
    ]);
  });

  it('tracks within a merged group are matched by id', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [
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
    const dom = asGroup(out.groups.find((c) => c.id === 'DOMAINS'));
    expect(dom.tracks.map((t) => t.id)).toEqual(['domain', 'region', 'motif']);
    expect(dom.tracks.find((t) => t.id === 'region')?.label).toBe(
      'Renamed region'
    );
  });

  it('rendering merges field-wise at group level', async () => {
    const withBaseRendering: ProtvistaViewerConfig = {
      ...base(),
      groups: [
        {
          id: 'X',
          rendering: { color: '#000', height: 20 },
          tracks: [{ id: 't', kind: 'features', data: 'features' }],
        },
      ],
    };
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [
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
    const group = out.groups.find((g) => g.id === 'X')!;
    expect(group.rendering?.color).toBe('#fff');
    expect(group.rendering?.height).toBe(20);
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
      groups: [],
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
      groups: [],
    };
    const b: ProtvistaViewerConfig = {
      sources: { features: 'https://b/features' },
      groups: [],
    };
    const child: ProtvistaViewerConfig = {
      extends: ['@a', '@b'],
      groups: [],
    };
    const out = await mergeExtends(child, { resolver: { '@a': a, '@b': b } });
    // b overrides a
    expect(out.sources?.features).toBe('https://b/features');
  });

  it('child overrides all parents at root level', async () => {
    const a: ProtvistaViewerConfig = {
      sources: { features: 'https://a' },
      groups: [],
    };
    const child: ProtvistaViewerConfig = {
      extends: '@a',
      sources: { features: 'https://child' },
      groups: [],
    };
    const out = await mergeExtends(child, { resolver: { '@a': a } });
    expect(out.sources?.features).toBe('https://child');
  });

  it('resolves recursive extends (child → A → B)', async () => {
    const b: ProtvistaViewerConfig = {
      sources: { a: 'https://b/a', b: 'https://b/b' },
      groups: [],
    };
    const a: ProtvistaViewerConfig = {
      extends: '@b',
      sources: { a: 'https://a/a' }, // override b's a
      groups: [],
    };
    const child: ProtvistaViewerConfig = {
      extends: '@a',
      sources: { c: 'https://child/c' },
      groups: [],
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
      groups: [],
    };
    await expect(
      mergeExtends(a, { resolver: { '@a': a } })
    ).rejects.toThrow(ConfigValidationError);
  });

  it('detects a two-step cycle (A → B → A) with descriptive message', async () => {
    const a: ProtvistaViewerConfig = { extends: '@b', groups: [] };
    const b: ProtvistaViewerConfig = { extends: '@a', groups: [] };
    try {
      await mergeExtends(
        { extends: '@a', groups: [] } as ProtvistaViewerConfig,
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
      groups: [],
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
      groups: [],
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
      groups: [],
    };
    const baseJson = JSON.stringify({
      sources: { features: 'https://fetched/features' },
      groups: [],
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
      groups: [],
    };
    const out = await mergeExtends(child, {
      fetcher: async () =>
        [
          'sources:',
          '  features: https://yaml/features',
          'groups: []',
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
      groups: [],
    };
    const out = await mergeExtends(child, {
      resolver: (name) =>
        name === '@base'
          ? ({ sources: { a: 'https://a' }, groups: [] } as ProtvistaViewerConfig)
          : undefined,
    });
    expect(out.sources?.a).toBe('https://a');
  });

  it('accepts a function resolver (async return)', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [],
    };
    const out = await mergeExtends(child, {
      resolver: async (name) => {
        if (name !== '@base') return undefined;
        return { sources: { a: 'https://a' }, groups: [] };
      },
    });
    expect(out.sources?.a).toBe('https://a');
  });

  it('resolver can return a raw string (JSON) for re-parsing', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [],
    };
    const out = await mergeExtends(child, {
      resolver: (name) =>
        name === '@base'
          ? JSON.stringify({ sources: { a: 'https://a' }, groups: [] })
          : undefined,
    });
    expect(out.sources?.a).toBe('https://a');
  });

  it('resolver can return a raw string (YAML) for re-parsing', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [],
    };
    const out = await mergeExtends(child, {
      resolver: (name) =>
        name === '@base'
          ? 'sources:\n  a: https://a\ngroups: []\n'
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
    // The child has NO `groups` key; pre-merge that would fail
    // schema validation. After merging the base, it should pass.
    const childYaml = `
extends: "@base"
sources:
  extra: https://extra
`;
    const normalized = await loadConfig(childYaml, {
      extendsResolver: {
        '@base': {
          groups: [
            {
              id: 'X',
              tracks: [{ id: 't', kind: 'features', data: 'sources' }],
            },
          ],
          sources: { sources: 'https://base/src' },
        } as ProtvistaViewerConfig,
      },
    });
    expect(normalized.groups).toHaveLength(1);
    expect(normalized.sources.extra).toBe('https://extra');
    expect(normalized.sources.sources).toBe('https://base/src');
  });

  it('propagates ConfigValidationError when merged result still fails semantic checks', async () => {
    await expect(
      loadConfig(
        {
          extends: '@base',
          groups: [
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
            '@base': { groups: [] } as ProtvistaViewerConfig,
          },
        }
      )
    ).rejects.toThrow(ConfigValidationError);
  });
});

// ─────────────────────────────────────────────────────────────
// Mixed-shape top-level entries (groups ↔ standalone tracks)
// ─────────────────────────────────────────────────────────────

describe('mergeExtends — mixed group / standalone-track entries', () => {
  it('a child standalone track replaces a base group of the same id wholesale', async () => {
    // base() ships DOMAINS as a group with two tracks. The child reuses
    // the id `DOMAINS` as a standalone track — a shape flip, so child
    // wins wholesale (no field merge that would smuggle the base
    // `tracks` array onto a track-shaped entry).
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [{ id: 'DOMAINS', kind: 'features', data: 'features' }],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    const domains = out.groups.find((c) => c.id === 'DOMAINS');
    expect(domains).toBeDefined();
    expect(isGroupConfig(domains!)).toBe(false);
    // The base group's `tracks` array is gone — it was replaced, not merged.
    expect('tracks' in domains!).toBe(false);
    expect((domains as { kind?: string }).kind).toBe('features');
    // Order preserved: DOMAINS still first, VARIATION still second.
    expect(out.groups.map((c) => c.id)).toEqual(['DOMAINS', 'VARIATION']);
  });

  it('two standalone tracks of the same id are field-merged (child wins)', async () => {
    const baseWithStandalone = (): ProtvistaViewerConfig => ({
      sources: { features: 'https://example.org/features' },
      groups: [
        { id: 'signal', kind: 'features', label: 'Base', data: 'features' },
      ],
    });
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [{ id: 'signal', label: 'Child', data: 'features' }],
    };
    const out = await mergeExtends(child, {
      resolver: { '@base': baseWithStandalone() },
    });
    const signal = out.groups.find((c) => c.id === 'signal')!;
    expect(isGroupConfig(signal)).toBe(false);
    expect(signal.label).toBe('Child');
    // `kind` from the base survives because the two track entries are
    // field-merged.
    expect((signal as { kind?: string }).kind).toBe('features');
  });

  it('a new standalone track is appended at the end', async () => {
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [{ id: 'confidence', kind: 'features', data: 'features' }],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    expect(out.groups.map((c) => c.id)).toEqual([
      'DOMAINS',
      'VARIATION',
      'confidence',
    ]);
    expect(isGroupConfig(out.groups[2])).toBe(false);
  });

  it('a child overriding a group scalar without restating `tracks:` keeps the base tracks', async () => {
    // Regression: a `tracks:`-less child entry is a shape-SILENT partial
    // override, not a standalone track. It must field-merge onto the
    // base group (label overridden, base tracks preserved) — NOT flip the
    // group to a track and drop `[domain, region]`.
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [{ id: 'DOMAINS', label: 'Renamed domains' } as TopLevelEntry],
    };
    const out = await mergeExtends(child, { resolver: { '@base': base() } });
    const domains = out.groups.find((c) => c.id === 'DOMAINS');
    expect(domains).toBeDefined();
    // Still a group — the shape was inherited from the base, not flipped.
    expect(isGroupConfig(domains!)).toBe(true);
    expect(domains!.label).toBe('Renamed domains');
    // The base group's tracks survive the scalar-only override.
    expect(asGroup(domains).tracks.map((t) => t.id)).toEqual([
      'domain',
      'region',
    ]);
    // Order preserved.
    expect(out.groups.map((c) => c.id)).toEqual(['DOMAINS', 'VARIATION']);
  });

  it('a child overriding a standalone-track scalar without `data:` keeps the base data', async () => {
    // Symmetric to the group case: a shape-silent child field-merges onto
    // a base standalone track, preserving its `data` / `kind`.
    const baseWithStandalone = (): ProtvistaViewerConfig => ({
      sources: { features: 'https://example.org/features' },
      groups: [
        { id: 'signal', kind: 'features', label: 'Base', data: 'features' },
      ],
    });
    const child: ProtvistaViewerConfig = {
      extends: '@base',
      groups: [{ id: 'signal', label: 'Renamed signal' } as TopLevelEntry],
    };
    const out = await mergeExtends(child, {
      resolver: { '@base': baseWithStandalone() },
    });
    const signal = out.groups.find((c) => c.id === 'signal')!;
    expect(isGroupConfig(signal)).toBe(false);
    expect(signal.label).toBe('Renamed signal');
    // Base `data` and `kind` survive the scalar-only override.
    expect((signal as { kind?: string }).kind).toBe('features');
    expect((signal as { data?: unknown }).data).toBe('features');
  });
});
