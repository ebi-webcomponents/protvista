/**
 * normalize / expand pipeline contract tests.
 *
 * Covers:
 *   - the three `data:` shorthand shapes (string, single descriptor,
 *     array) resolving to `NormalizedDataSource[]`;
 *   - the string-shorthand resolution table on `TrackConfig.data`
 *     (sources key, http(s) URL);
 *   - kind-based adapter inference and explicit-adapter-wins
 *     precedence;
 *   - `from` defaulting (`inline` when `inlineData` is present,
 *     `url` otherwise);
 *   - source → URL resolution through the root `sources` map,
 *     including dedup parity with the runtime-layer behaviour;
 *   - rendering cascade (defaults → group → kind preset → track)
 *     with the kind preset layered between group and track so
 *     canonical ramps win over group colour but lose to explicit
 *     track overrides;
 *   - group `component` inference from child-track components
 *     (all-same / mixed / empty);
 *   - `titleCaseId` fallback for both group and track labels;
 *   - duplicate group / track id detection with spec-exact error
 *     messages;
 *   - kind resolution with and without a registry (no-registry case
 *     is defensive-best-effort; the validator surfaces the real
 *     error downstream).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeConfig,
  titleCaseId,
  type NormalizedConfig,
} from '../normalize';
import { createRegistry } from '../registry';
import type {
  ProtvistaViewerConfig,
  TopLevelEntry,
  TrackConfig,
} from '../types';

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────

/**
 * Minimal config constructor. Keeps each test's input focused on the
 * field under test and avoids the noise of always spelling out
 * `rows: [...]` with a throw-away track.
 */
function cfg(
  partial: Partial<ProtvistaViewerConfig> & { rows: TopLevelEntry[] }
): ProtvistaViewerConfig {
  return partial;
}

function track(partial: Partial<TrackConfig> & { id: string }): TrackConfig {
  return {
    data: 'features',
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────
// titleCaseId
// ─────────────────────────────────────────────────────────────

describe('titleCaseId', () => {
  it('title-cases an UPPER_SNAKE_CASE id (spec example)', () => {
    expect(titleCaseId('MOLECULE_PROCESSING')).toBe('Molecule processing');
  });

  it('title-cases a kebab-case id', () => {
    expect(titleCaseId('confidence-score')).toBe('Confidence score');
  });

  it('collapses runs of separators into a single space', () => {
    expect(titleCaseId('A__B--C')).toBe('A b c');
  });

  it('leaves simple lowercase ids as-is except for the first letter', () => {
    expect(titleCaseId('signal')).toBe('Signal');
  });

  it('returns the original id if it trims to empty', () => {
    expect(titleCaseId('_-_')).toBe('_-_');
  });
});

// ─────────────────────────────────────────────────────────────
// Label fallback
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — label fallbacks', () => {
  it('title-cases a group id when label is omitted (spec test)', () => {
    const out = normalizeConfig({
      rows: [{ id: 'MOLECULE_PROCESSING', tracks: [] }],
    });
    expect(out.rows[0].label).toBe('Molecule processing');
  });

  it('preserves an explicit group label', () => {
    const out = normalizeConfig({
      rows: [
        { id: 'MOLECULE_PROCESSING', label: 'Processing', tracks: [] },
      ],
    });
    expect(out.rows[0].label).toBe('Processing');
  });

  it('title-cases a track id when label is omitted', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x/{accession}' },
        rows: [
          { id: 'C', tracks: [track({ id: 'signal-peptide' })] },
        ],
      })
    );
    expect(out.rows[0].tracks[0].label).toBe('Signal peptide');
  });
});

describe('normalizeConfig — theme pass-through', () => {
  it('carries a top-level theme through unchanged', () => {
    const out = normalizeConfig({
      rows: [{ id: 'C', tracks: [] }],
      theme: { labelColor: '#e8f5e9', accentColor: 'green' },
    });
    expect(out.theme).toEqual({ labelColor: '#e8f5e9', accentColor: 'green' });
  });

  it('omits theme when the config declares none', () => {
    const out = normalizeConfig({ rows: [{ id: 'C', tracks: [] }] });
    expect(out.theme).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// data shorthand expansion
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — data shorthand expansion', () => {
  it('wraps a single descriptor in an array', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: { from: 'url', url: 'https://x' },
              }),
            ],
          },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data;
    expect(Array.isArray(d)).toBe(true);
    expect(d).toHaveLength(1);
    expect(d[0].url).toBe('https://x');
  });

  it('keeps a descriptor array intact (multi-input adapter)', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: [
                  { from: 'url', url: 'https://a' },
                  { from: 'url', url: 'https://b' },
                ],
              }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].data).toHaveLength(2);
    expect(out.rows[0].tracks[0].data.map((d) => d.url)).toEqual([
      'https://a',
      'https://b',
    ]);
  });

  it('resolves string shorthand matching a sources key', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://example.com/features/{accession}' },
        rows: [{ id: 'C', tracks: [track({ id: 't', data: 'features' })] }],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('url');
    expect(d.source).toBe('features');
    // Resolution populates `url` alongside `source` so the loader can
    // fetch without consulting the sources map again.
    expect(d.url).toBe('https://example.com/features/{accession}');
  });

  it('resolves string shorthand starting with http(s):// as a literal URL', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          { id: 'C', tracks: [track({ id: 't', data: 'https://x.test/f' })] },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('url');
    expect(d.url).toBe('https://x.test/f');
    expect(d.source).toBeUndefined();
  });

  it('falls back to {from: url, source} for an unresolvable bare string (validator surfaces the error)', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          { id: 'C', tracks: [track({ id: 't', data: 'nonexistent' })] },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('url');
    expect(d.source).toBe('nonexistent');
    expect(d.url).toBeUndefined();
  });

  it('resolves a ./x.csv file path to {from: file, url, adapter: features-csv}', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          { id: 'C', tracks: [track({ id: 't', data: './features.csv' })] },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('file');
    expect(d.url).toBe('./features.csv');
    expect(d.adapter).toBe('features-csv');
  });

  it('resolves a ./x.tsv file path to {from: file, url, adapter: features-tsv}', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          { id: 'C', tracks: [track({ id: 't', data: '../data/hits.tsv' })] },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('file');
    expect(d.url).toBe('../data/hits.tsv');
    expect(d.adapter).toBe('features-tsv');
  });

  it('resolves a ./x.json file path to {from: file, url, adapter: features-json}', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          { id: 'C', tracks: [track({ id: 't', data: './features.json' })] },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('file');
    expect(d.url).toBe('./features.json');
    expect(d.adapter).toBe('features-json');
  });

  it('resolves a ./x.bed file path to {from: file, url, adapter: bed}', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          { id: 'C', tracks: [track({ id: 't', data: './regions.bed' })] },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('file');
    expect(d.url).toBe('./regions.bed');
    expect(d.adapter).toBe('bed');
  });

  it('lets an explicit adapter win over file-extension inference', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: { from: 'file', url: './features.csv', adapter: 'my-csv' },
              }),
            ],
          },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.adapter).toBe('my-csv');
  });

  it('infers the extension adapter over the kind adapter (ext beats kind)', () => {
    // With a registry present, `kind: features` resolves to a canonical
    // adapter; a `.csv` url must still win, so the file is parsed as CSV
    // rather than fed to the kind's JSON adapter.
    const out = normalizeConfig(
      cfg({
        rows: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', kind: 'features', data: './features.csv' }),
            ],
          },
        ],
      }),
      { registry: createRegistry() }
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('file');
    expect(d.adapter).toBe('features-csv');
  });

  it('leaves an unrecognised extension (./x.gff) as a best-effort source key', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          { id: 'C', tracks: [track({ id: 't', data: './notes.gff' })] },
        ],
      })
    );
    const d = out.rows[0].tracks[0].data[0];
    expect(d.from).toBe('url');
    expect(d.source).toBe('./notes.gff');
    expect(d.adapter).toBeUndefined();
  });

});

// ─────────────────────────────────────────────────────────────
// dataTooltip shorthand expansion
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — dataTooltip shorthand expansion', () => {
  it('promotes a bare-string dataTooltip to a Markdoc template spec', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'features',
                dataTooltip: '### {% $name %}',
              }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].dataTooltip).toEqual({
      kind: 'markdown',
      template: '### {% $name %}',
    });
  });

  it('passes a fields-form dataTooltip through unchanged', () => {
    const fieldsSpec = {
      kind: 'fields' as const,
      fields: [{ path: 'name', label: 'Name' }],
    };
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'features',
                dataTooltip: fieldsSpec,
              }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].dataTooltip).toEqual(fieldsSpec);
  });

  it('passes a markdown-form dataTooltip (with variables) through unchanged', () => {
    const markdownSpec = {
      kind: 'markdown' as const,
      template: '{% $name %}',
      variables: { siteName: 'demo' },
    };
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'features',
                dataTooltip: markdownSpec,
              }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].dataTooltip).toEqual(markdownSpec);
  });

  it('omits dataTooltip from the normalized track when absent on input', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          { id: 'C', tracks: [track({ id: 't', kind: 'features' })] },
        ],
      })
    );
    expect(out.rows[0].tracks[0].dataTooltip).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// from defaulting
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — from defaulting', () => {
  it("defaults `from` to 'url' when the descriptor has neither `from` nor inlineData", () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', data: { source: 'features' } }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].data[0].from).toBe('url');
  });

  it("defaults `from` to 'inline' when inlineData is present and `from` is omitted", () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', data: { inlineData: [{ start: 1, end: 2 }] } }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].data[0].from).toBe('inline');
  });

  it('respects an explicit `from` even when inlineData is present', () => {
    const out = normalizeConfig(
      cfg({
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: { from: 'custom', inlineData: [] },
              }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].data[0].from).toBe('custom');
  });
});

// ─────────────────────────────────────────────────────────────
// Adapter inference
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — adapter inference precedence', () => {
  it('explicit adapter wins over kind inference', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'features',
                data: {
                  url: 'https://x.test/f',
                  adapter: 'my-custom-adapter',
                },
              }),
            ],
          },
        ],
      }),
      { registry }
    );
    expect(out.rows[0].tracks[0].data[0].adapter).toBe('my-custom-adapter');
  });

  it('prefers the kind canonical adapter for sources-key shorthand', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://api.example.com/{accession}.json' },
        rows: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      }),
      { registry }
    );
    // The author explicitly said `kind: features`, so they want the
    // UniProt JSON adapter that the kind resolves to.
    expect(out.rows[0].tracks[0].data[0].adapter).toBe(
      'uniprot-features-json'
    );
  });

  it('uses the kind canonical adapter when no explicit adapter is set', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://api.example.com/features/{accession}' },
        rows: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      }),
      { registry }
    );
    expect(out.rows[0].tracks[0].data[0].adapter).toBe(
      'uniprot-features-json'
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Source → URL resolution (incl. dedupe across tracks)
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — source → url resolution', () => {
  it('deduplicates URLs across tracks sharing the same source key', () => {
    // Two tracks pointing at the same `sources` key should resolve
    // to the same URL string instance — the runtime layer relies on
    // this for cache-key equality.
    const out = normalizeConfig({
      sources: { features: 'https://example.com/features/{accession}' },
      rows: [
        {
          id: 'SITES',
          tracks: [
            { id: 'metal', kind: 'features', filter: 'METAL', data: 'features' },
            { id: 'site', kind: 'features', filter: 'SITE', data: 'features' },
            {
              id: 'binding',
              kind: 'features',
              filter: 'BINDING',
              data: 'features',
            },
          ],
        },
      ],
    });
    const urls = out.rows
      .flatMap((c) => c.tracks)
      .flatMap((t) => t.data)
      .flatMap((d) => (Array.isArray(d.url) ? d.url : [d.url]))
      .filter((u): u is string => Boolean(u));
    expect(new Set(urls).size).toBe(1);
  });

  it('resolves a source array to a URL array', () => {
    const out = normalizeConfig(
      cfg({
        sources: { a: 'https://a', b: 'https://b' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', data: { source: ['a', 'b'] } }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].data[0].url).toEqual([
      'https://a',
      'https://b',
    ]);
  });

  it('leaves `url` untouched when it is already set alongside `source`', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://example.com/features' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: { source: 'features', url: 'https://overridden' },
              }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].data[0].url).toBe('https://overridden');
  });
});

// ─────────────────────────────────────────────────────────────
// Rendering cascade
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — rendering cascade', () => {
  it('merges defaults → group → track, with track winning', () => {
    const out = normalizeConfig(
      cfg({
        defaults: {
          rendering: { color: 'red', height: 10, layout: 'non-overlapping' },
        },
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            rendering: { color: 'blue' }, // overrides defaults.color
            tracks: [
              track({
                id: 't',
                rendering: { height: 20 }, // overrides defaults.height
              }),
            ],
          },
        ],
      })
    );
    const r = out.rows[0].tracks[0].rendering;
    expect(r.color).toBe('blue'); // from group
    expect(r.height).toBe(20); // from track
    expect(r.layout).toBe('non-overlapping'); // from defaults
  });

  it('layers a kind preset between group and track', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            rendering: { color: 'red' }, // would cascade to tracks
            tracks: [
              track({ id: 't', kind: 'confidence-score', data: 'features' }),
            ],
          },
        ],
      }),
      { registry }
    );
    // confidence-score kind carries `colorScale.theme: alphafold-ramp`;
    // the group's `color: red` is NOT overridden because the kind
    // preset doesn't touch that field. This proves the merge is
    // field-wise, not whole-object.
    const r = out.rows[0].tracks[0].rendering;
    expect(r.color).toBe('red');
    expect(r.colorScale?.theme).toBe('alphafold-ramp');
  });

  it('track rendering overrides the kind preset', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'confidence-score',
                data: 'features',
                rendering: { colorScale: { theme: 'my-custom' } },
              }),
            ],
          },
        ],
      }),
      { registry }
    );
    expect(
      out.rows[0].tracks[0].rendering.colorScale?.theme
    ).toBe('my-custom');
  });

  it('always produces a defined rendering object on each track (even when nothing is set)', () => {
    const out = normalizeConfig(
      cfg({
        rows: [{ id: 'C', tracks: [track({ id: 't' })] }],
      })
    );
    expect(out.rows[0].tracks[0].rendering).toEqual({});
    expect(out.defaults.rendering).toEqual({});
    expect(out.rows[0].rendering).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────
// Component resolution
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — component resolution', () => {
  it('resolves track component from kind via the registry', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', kind: 'confidence-score', data: 'features' }),
            ],
          },
        ],
      }),
      { registry }
    );
    expect(out.rows[0].tracks[0].component).toBe(
      'nightingale-colored-sequence'
    );
  });

  it('explicit component on track wins over kind resolution', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'confidence-score',
                component: 'nightingale-track-canvas',
                data: 'features',
              }),
            ],
          },
        ],
      }),
      { registry }
    );
    expect(out.rows[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });

  it('falls back to group component when neither kind nor track.component is set', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            component: 'nightingale-linegraph-track',
            tracks: [track({ id: 't' })],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].component).toBe(
      'nightingale-linegraph-track'
    );
  });

  it('defaults to nightingale-track-canvas when nothing else resolves', () => {
    const out = normalizeConfig(
      cfg({
        rows: [{ id: 'C', tracks: [track({ id: 't' })] }],
      })
    );
    expect(out.rows[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });

  it("preserves the track's kind string verbatim for downstream introspection", () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      }),
      { registry }
    );
    expect(out.rows[0].tracks[0].kind).toBe('features');
  });
});

// ─────────────────────────────────────────────────────────────
// Group component inference from children
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — group component inference', () => {
  it('uses the shared child component when all tracks agree', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({ id: 't1', kind: 'features' }),
              track({ id: 't2', kind: 'peptides' }),
            ],
          },
        ],
      }),
      { registry }
    );
    // features → nightingale-track-canvas
    // peptides → nightingale-track-canvas
    expect(out.rows[0].component).toBe('nightingale-track-canvas');
  });

  it('falls back to nightingale-track-canvas for a mixed-component group', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [
              track({ id: 't1', kind: 'features' }), // canvas
              track({ id: 't2', kind: 'variants' }), // variation
            ],
          },
        ],
      }),
      { registry }
    );
    expect(out.rows[0].component).toBe('nightingale-track-canvas');
  });

  it('preserves an explicit group component even when children disagree', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            component: 'nightingale-linegraph-track',
            tracks: [
              track({ id: 't1', kind: 'features' }),
              track({ id: 't2', kind: 'variants' }),
            ],
          },
        ],
      }),
      { registry }
    );
    expect(out.rows[0].component).toBe('nightingale-linegraph-track');
  });

  it('picks a default component for a zero-track group', () => {
    // Spec: zero-track groups are skipped at render time with a
    // warning; we still need *some* component so downstream code
    // doesn't crash if it iterates empty groups.
    const out = normalizeConfig(
      cfg({
        rows: [{ id: 'EMPTY', tracks: [] }],
      })
    );
    expect(out.rows[0].component).toBe('nightingale-track-canvas');
  });
});

// ─────────────────────────────────────────────────────────────
// Duplicate id detection
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — duplicate id detection', () => {
  it('rejects duplicate top-level ids (spec test)', () => {
    expect(() =>
      normalizeConfig({
        rows: [
          { id: 'DUPED', tracks: [] },
          { id: 'DUPED', tracks: [] },
        ],
      })
    ).toThrow(/Duplicate top-level id 'DUPED'/);
  });

  it('rejects a standalone-track id colliding with a group id', () => {
    expect(() =>
      normalizeConfig({
        sources: { features: 'https://x' },
        rows: [
          { id: 'shared', tracks: [] },
          { id: 'shared', kind: 'features', data: 'features' },
        ],
      })
    ).toThrow(/Duplicate top-level id 'shared'/);
  });

  it('rejects duplicate track ids within a group', () => {
    expect(() =>
      normalizeConfig(
        cfg({
          sources: { features: 'https://x' },
          rows: [
            {
              id: 'C',
              tracks: [track({ id: 't' }), track({ id: 't' })],
            },
          ],
        })
      )
    ).toThrow(/Duplicate track id 't' in group 'C'/);
  });

  it('allows identical track ids across different groups', () => {
    expect(() =>
      normalizeConfig(
        cfg({
          sources: { features: 'https://x' },
          rows: [
            { id: 'A', tracks: [track({ id: 'signal' })] },
            { id: 'B', tracks: [track({ id: 'signal' })] },
          ],
        })
      )
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// Top-level fields
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — top-level fields', () => {
  it("defaults `version` to '1.0' when omitted", () => {
    const out = normalizeConfig({
      rows: [{ id: 'C', tracks: [] }],
    });
    expect(out.version).toBe('1.0');
  });

  it('preserves accession when set', () => {
    const out = normalizeConfig({
      accession: 'P05067',
      rows: [{ id: 'C', tracks: [] }],
    });
    expect(out.accession).toBe('P05067');
  });

  it('always produces a sources object (empty when omitted)', () => {
    const out = normalizeConfig({
      rows: [{ id: 'C', tracks: [] }],
    });
    expect(out.sources).toEqual({});
  });

  it('always produces a defaults object with a rendering sub-object', () => {
    const out = normalizeConfig({
      rows: [{ id: 'C', tracks: [] }],
    });
    expect(out.defaults.rendering).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────
// No-registry behaviour
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — without a registry', () => {
  it("keeps unresolved kinds on tracks rather than throwing", () => {
    // Tests can exercise expansion/inheritance without setting up a
    // registry at all. The validator raises "Unknown semantic
    // kind" later.
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].kind).toBe('features');
    // Adapter stays undefined because there's no registry to look up
    // the kind's canonical adapter.
    expect(out.rows[0].tracks[0].data[0].adapter).toBeUndefined();
    // Component falls through to the default.
    expect(out.rows[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });
});

// ─────────────────────────────────────────────────────────────
// End-to-end shape guarantees
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — output shape guarantees', () => {
  it('produces a fully-populated NormalizedConfig for a canonical input', () => {
    const registry = createRegistry();
    const out: NormalizedConfig = normalizeConfig(
      {
        accession: 'P05067',
        defaults: { rendering: { layout: 'non-overlapping' } },
        sources: { features: 'https://x/{accession}' },
        rows: [
          {
            id: 'DOMAINS',
            tracks: [
              {
                id: 'domain',
                kind: 'features',
                filter: 'DOMAIN',
                data: 'features',
              },
            ],
          },
        ],
      },
      { registry }
    );

    expect(out.version).toBe('1.0');
    expect(out.accession).toBe('P05067');
    expect(out.sources.features).toBe('https://x/{accession}');
    expect(out.defaults.rendering.layout).toBe('non-overlapping');

    const c = out.rows[0];
    expect(c.id).toBe('DOMAINS');
    expect(c.label).toBe('Domains');
    expect(c.component).toBe('nightingale-track-canvas');
    expect(c.rendering.layout).toBe('non-overlapping');

    const t = c.tracks[0];
    expect(t.id).toBe('domain');
    expect(t.label).toBe('Domain');
    expect(t.kind).toBe('features');
    expect(t.component).toBe('nightingale-track-canvas');
    expect(t.filter).toBe('DOMAIN');
    expect(t.rendering.layout).toBe('non-overlapping');

    expect(t.data).toHaveLength(1);
    expect(t.data[0].from).toBe('url');
    expect(t.data[0].source).toBe('features');
    expect(t.data[0].url).toBe('https://x/{accession}');
    expect(t.data[0].adapter).toBe('uniprot-features-json');
  });
});

// ─────────────────────────────────────────────────────────────
// Standalone top-level tracks (wrapped in a synthetic group)
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — standalone top-level tracks', () => {
  it('wraps a standalone track in a synthetic single-track group flagged standalone', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'signal_peptide',
            label: 'Signal peptide',
            kind: 'features',
            filter: 'SIGNAL',
            data: 'features',
          },
        ],
      }),
      { registry }
    );
    expect(out.rows).toHaveLength(1);
    const g = out.rows[0];
    expect(g.standalone).toBe(true);
    // Wrapper mirrors the wrapped track: same id, label === track.label,
    // same resolved component.
    expect(g.id).toBe('signal_peptide');
    expect(g.label).toBe('Signal peptide');
    expect(g.tracks).toHaveLength(1);
    expect(g.label).toBe(g.tracks[0].label);
    expect(g.component).toBe(g.tracks[0].component);
    expect(g.tracks[0].filter).toBe('SIGNAL');
  });

  it('genuine one-track groups are NOT flagged standalone (collapse preserved)', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'DOMAINS',
            tracks: [track({ id: 'domain', kind: 'features', data: 'features' })],
          },
        ],
      })
    );
    expect(out.rows[0].standalone).toBeUndefined();
  });

  it('preserves declaration order across mixed standalone tracks and groups', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          { id: 'signal_peptide', kind: 'features', filter: 'SIGNAL', data: 'features' },
          {
            id: 'DOMAINS',
            tracks: [track({ id: 'domain', kind: 'features', data: 'features' })],
          },
          { id: 'confidence', kind: 'features', data: 'features' },
        ],
      })
    );
    expect(out.rows.map((g) => g.id)).toEqual([
      'signal_peptide',
      'DOMAINS',
      'confidence',
    ]);
    expect(out.rows.map((g) => g.standalone)).toEqual([
      true,
      undefined,
      true,
    ]);
  });

  it('standalone cascade skips the group-rendering layer (defaults → kind → track)', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        defaults: { rendering: { layout: 'non-overlapping', color: 'red' } },
        rows: [
          { id: 'confidence', kind: 'confidence-score', data: 'features' },
        ],
      }),
      { registry }
    );
    const r = out.rows[0].tracks[0].rendering;
    // Inherited straight from defaults (no group layer to intercept),
    // with the confidence-score kind preset layered on top.
    expect(r.layout).toBe('non-overlapping');
    expect(r.color).toBe('red');
    expect(r.colorScale?.theme).toBe('alphafold-ramp');
    // The synthetic wrapper's own rendering is the defaults layer only.
    expect(out.rows[0].rendering.color).toBe('red');
    expect(out.rows[0].rendering.colorScale).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// hidden — authored initial-mount default
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — hidden default', () => {
  it('carries a group-level hidden through to the NormalizedRow', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'DOMAINS',
            hidden: true,
            tracks: [track({ id: 'domain', kind: 'features', data: 'features' })],
          },
        ],
      })
    );
    expect(out.rows[0].hidden).toBe(true);
  });

  it('carries a track-level hidden through to the NormalizedTrack', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'DOMAINS',
            tracks: [
              track({ id: 'domain', kind: 'features', data: 'features' }),
              track({ id: 'region', kind: 'features', data: 'features', hidden: true }),
            ],
          },
        ],
      })
    );
    expect(out.rows[0].tracks[0].hidden).toBeUndefined();
    expect(out.rows[0].tracks[1].hidden).toBe(true);
  });

  it('mirrors a standalone track hidden onto its synthetic wrapper row and track', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          { id: 'signal_peptide', kind: 'features', data: 'features', hidden: true },
        ],
      })
    );
    expect(out.rows[0].hidden).toBe(true);
    expect(out.rows[0].tracks[0].hidden).toBe(true);
  });

  it('leaves hidden undefined when not authored (visible by default)', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        rows: [
          {
            id: 'DOMAINS',
            tracks: [track({ id: 'domain', kind: 'features', data: 'features' })],
          },
        ],
      })
    );
    expect(out.rows[0].hidden).toBeUndefined();
    expect(out.rows[0].tracks[0].hidden).toBeUndefined();
  });
});
