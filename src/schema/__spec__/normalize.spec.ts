/**
 * normalize / expand pipeline contract tests (#21).
 *
 * Covers:
 *   - the four `data:` shorthand shapes (string, string w/ extension,
 *     single descriptor, array) resolving to `NormalizedDataSource[]`;
 *   - the string-shorthand resolution table on `TrackConfig.data`
 *     (sources key, http(s) URL, ./path, .csv/.tsv/.json/.bed);
 *   - extension-based and kind-based adapter inference, including
 *     explicit-adapter-wins precedence and multi-URL agreement;
 *   - `from` defaulting (`inline` when `inlineData` is present,
 *     `url` otherwise);
 *   - source → URL resolution through the root `sources` map,
 *     including dedup parity for the specs/config-approach.md runtime-layer test;
 *   - rendering cascade (defaults → category → kind preset → track)
 *     with the kind preset layered between category and track so
 *     canonical ramps win over category colour but lose to explicit
 *     track overrides;
 *   - labelUrl / helpPage inheritance per the spec's precedence table;
 *   - category `component` inference from child-track components
 *     (all-same / mixed / empty);
 *   - `titleCaseId` fallback for both category and track labels;
 *   - duplicate category / track id detection with spec-exact error
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
  CategoryConfig,
  TrackConfig,
} from '../types';

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────

/**
 * Minimal config constructor. Keeps each test's input focused on the
 * field under test and avoids the noise of always spelling out
 * `categories: [...]` with a throw-away track.
 */
function cfg(
  partial: Partial<ProtvistaViewerConfig> & { categories: CategoryConfig[] }
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
  it('title-cases a category id when label is omitted (spec test)', () => {
    const out = normalizeConfig({
      categories: [{ id: 'MOLECULE_PROCESSING', tracks: [] }],
    });
    expect(out.categories[0].label).toBe('Molecule processing');
  });

  it('preserves an explicit category label', () => {
    const out = normalizeConfig({
      categories: [
        { id: 'MOLECULE_PROCESSING', label: 'Processing', tracks: [] },
      ],
    });
    expect(out.categories[0].label).toBe('Processing');
  });

  it('title-cases a track id when label is omitted', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x/{accession}' },
        categories: [
          { id: 'C', tracks: [track({ id: 'signal-peptide' })] },
        ],
      })
    );
    expect(out.categories[0].tracks[0].label).toBe('Signal peptide');
  });
});

// ─────────────────────────────────────────────────────────────
// data shorthand expansion
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — data shorthand expansion', () => {
  it('wraps a single descriptor in an array', () => {
    const out = normalizeConfig(
      cfg({
        categories: [
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
    const d = out.categories[0].tracks[0].data;
    expect(Array.isArray(d)).toBe(true);
    expect(d).toHaveLength(1);
    expect(d[0].url).toBe('https://x');
  });

  it('keeps a descriptor array intact (multi-input adapter)', () => {
    const out = normalizeConfig(
      cfg({
        categories: [
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
    expect(out.categories[0].tracks[0].data).toHaveLength(2);
    expect(out.categories[0].tracks[0].data.map((d) => d.url)).toEqual([
      'https://a',
      'https://b',
    ]);
  });

  it('resolves string shorthand matching a sources key', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://example.com/features/{accession}' },
        categories: [{ id: 'C', tracks: [track({ id: 't', data: 'features' })] }],
      })
    );
    const d = out.categories[0].tracks[0].data[0];
    expect(d.from).toBe('url');
    expect(d.source).toBe('features');
    // Resolution populates `url` alongside `source` so the loader can
    // fetch without consulting the sources map again.
    expect(d.url).toBe('https://example.com/features/{accession}');
  });

  it('resolves string shorthand starting with http(s):// as a literal URL', () => {
    const out = normalizeConfig(
      cfg({
        categories: [
          { id: 'C', tracks: [track({ id: 't', data: 'https://x.test/f' })] },
        ],
      })
    );
    const d = out.categories[0].tracks[0].data[0];
    expect(d.from).toBe('url');
    expect(d.url).toBe('https://x.test/f');
    expect(d.source).toBeUndefined();
  });

  it('resolves a ./path shorthand with a known extension to {from: file, adapter}', () => {
    const out = normalizeConfig(
      cfg({
        categories: [
          { id: 'C', tracks: [track({ id: 't', data: './hits.csv' })] },
        ],
      })
    );
    const d = out.categories[0].tracks[0].data[0];
    expect(d.from).toBe('file');
    expect(d.url).toBe('./hits.csv');
    expect(d.adapter).toBe('features-csv');
  });

  it('resolves a /abs/path shorthand with an unknown extension to {from: file}, no adapter', () => {
    const out = normalizeConfig(
      cfg({
        categories: [
          { id: 'C', tracks: [track({ id: 't', data: '/data/x.gff' })] },
        ],
      })
    );
    const d = out.categories[0].tracks[0].data[0];
    expect(d.from).toBe('file');
    expect(d.url).toBe('/data/x.gff');
    expect(d.adapter).toBeUndefined();
  });

  it('resolves a bare .tsv / .json / .bed filename to {from: file, adapter}', () => {
    const cases = [
      { data: 'hits.tsv', adapter: 'features-tsv' },
      { data: 'hits.json', adapter: 'features-json' },
      { data: 'hits.bed', adapter: 'bed' },
    ];
    for (const { data, adapter } of cases) {
      const out = normalizeConfig(
        cfg({
          categories: [{ id: 'C', tracks: [track({ id: 't', data })] }],
        })
      );
      const d = out.categories[0].tracks[0].data[0];
      expect(d.from).toBe('file');
      expect(d.adapter).toBe(adapter);
    }
  });

  it('falls back to {from: url, source} for an unresolvable bare string (validator surfaces the error)', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
          { id: 'C', tracks: [track({ id: 't', data: 'nonexistent' })] },
        ],
      })
    );
    const d = out.categories[0].tracks[0].data[0];
    expect(d.from).toBe('url');
    expect(d.source).toBe('nonexistent');
    expect(d.url).toBeUndefined();
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
        categories: [
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
    expect(out.categories[0].tracks[0].dataTooltip).toEqual({
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
        categories: [
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
    expect(out.categories[0].tracks[0].dataTooltip).toEqual(fieldsSpec);
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
        categories: [
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
    expect(out.categories[0].tracks[0].dataTooltip).toEqual(markdownSpec);
  });

  it('omits dataTooltip from the normalized track when absent on input', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
          { id: 'C', tracks: [track({ id: 't', kind: 'features' })] },
        ],
      })
    );
    expect(out.categories[0].tracks[0].dataTooltip).toBeUndefined();
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
        categories: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', data: { source: 'features' } }),
            ],
          },
        ],
      })
    );
    expect(out.categories[0].tracks[0].data[0].from).toBe('url');
  });

  it("defaults `from` to 'inline' when inlineData is present and `from` is omitted", () => {
    const out = normalizeConfig(
      cfg({
        categories: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', data: { inlineData: [{ start: 1, end: 2 }] } }),
            ],
          },
        ],
      })
    );
    expect(out.categories[0].tracks[0].data[0].from).toBe('inline');
  });

  it('respects an explicit `from` even when inlineData is present', () => {
    const out = normalizeConfig(
      cfg({
        categories: [
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
    expect(out.categories[0].tracks[0].data[0].from).toBe('custom');
  });
});

// ─────────────────────────────────────────────────────────────
// Adapter inference
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — adapter inference precedence', () => {
  it('explicit adapter wins over extension and kind inference', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        categories: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'features',
                data: { url: './hits.csv', adapter: 'features-json' },
              }),
            ],
          },
        ],
      }),
      { registry }
    );
    expect(out.categories[0].tracks[0].data[0].adapter).toBe('features-json');
  });

  it('extension-based inference runs before kind inference', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        categories: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                kind: 'features',
                data: { url: './custom.csv' },
              }),
            ],
          },
        ],
      }),
      { registry }
    );
    // features-csv from .csv extension beats the kind's canonical
    // uniprot-features-json, which makes sense: if the file is a CSV
    // the kind adapter (which parses UniProt JSON) would fail.
    expect(out.categories[0].tracks[0].data[0].adapter).toBe('features-csv');
  });

  it('prefers the kind canonical adapter for sources-key shorthand, even when the resolved URL has a known extension', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://api.example.com/{accession}.json' },
        categories: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      }),
      { registry }
    );
    // Important: adapter inference runs BEFORE source→URL resolution,
    // which means a sources-key shorthand never sees the resolved
    // URL's extension. The kind's canonical adapter wins instead.
    // This is the right semantic: the author explicitly said
    // `kind: features`, so they want the UniProt JSON adapter even if
    // the URL happens to end in `.json`. Pinned so future refactors
    // don't accidentally swap the order.
    expect(out.categories[0].tracks[0].data[0].adapter).toBe(
      'uniprot-features-json'
    );
  });

  it('uses the kind canonical adapter when the URL has no recognisable extension', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://api.example.com/features/{accession}' },
        categories: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      }),
      { registry }
    );
    expect(out.categories[0].tracks[0].data[0].adapter).toBe(
      'uniprot-features-json'
    );
  });

  it('infers adapter from a multi-URL descriptor only when every URL agrees', () => {
    const matching = normalizeConfig(
      cfg({
        categories: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: { from: 'url', url: ['a.csv', 'b.csv'] },
              }),
            ],
          },
        ],
      })
    );
    expect(matching.categories[0].tracks[0].data[0].adapter).toBe(
      'features-csv'
    );

    const mixed = normalizeConfig(
      cfg({
        categories: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: { from: 'url', url: ['a.csv', 'b.json'] },
              }),
            ],
          },
        ],
      })
    );
    expect(mixed.categories[0].tracks[0].data[0].adapter).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Source → URL resolution (incl. spec dedupe test)
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — source → url resolution', () => {
  it('deduplicates URLs across tracks sharing the same source key (spec test)', () => {
    // Ported verbatim from specs/config-approach.md's runtime-layer test block.
    const out = normalizeConfig({
      sources: { features: 'https://example.com/features/{accession}' },
      categories: [
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
    const urls = out.categories
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
        categories: [
          {
            id: 'C',
            tracks: [
              track({ id: 't', data: { source: ['a', 'b'] } }),
            ],
          },
        ],
      })
    );
    expect(out.categories[0].tracks[0].data[0].url).toEqual([
      'https://a',
      'https://b',
    ]);
  });

  it('leaves `url` untouched when it is already set alongside `source`', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://example.com/features' },
        categories: [
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
    expect(out.categories[0].tracks[0].data[0].url).toBe('https://overridden');
  });
});

// ─────────────────────────────────────────────────────────────
// Rendering cascade
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — rendering cascade', () => {
  it('merges defaults → category → track, with track winning', () => {
    const out = normalizeConfig(
      cfg({
        defaults: {
          rendering: { color: 'red', height: 10, layout: 'non-overlapping' },
        },
        sources: { features: 'https://x' },
        categories: [
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
    const r = out.categories[0].tracks[0].rendering;
    expect(r.color).toBe('blue'); // from category
    expect(r.height).toBe(20); // from track
    expect(r.layout).toBe('non-overlapping'); // from defaults
  });

  it('layers a kind preset between category and track', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
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
    // the category's `color: red` is NOT overridden because the kind
    // preset doesn't touch that field. This proves the merge is
    // field-wise, not whole-object.
    const r = out.categories[0].tracks[0].rendering;
    expect(r.color).toBe('red');
    expect(r.colorScale?.theme).toBe('alphafold-ramp');
  });

  it('track rendering overrides the kind preset', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
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
      out.categories[0].tracks[0].rendering.colorScale?.theme
    ).toBe('my-custom');
  });

  it('always produces a defined rendering object on each track (even when nothing is set)', () => {
    const out = normalizeConfig(
      cfg({
        categories: [{ id: 'C', tracks: [track({ id: 't' })] }],
      })
    );
    expect(out.categories[0].tracks[0].rendering).toEqual({});
    expect(out.defaults.rendering).toEqual({});
    expect(out.categories[0].rendering).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────
// labelUrl / helpPage inheritance
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — labelUrl / helpPage inheritance', () => {
  it('inherits labelUrl from defaults to every track without its own', () => {
    const out = normalizeConfig(
      cfg({
        defaults: { labelUrl: 'https://uniprot.org/{accession}' },
        sources: { features: 'https://x' },
        categories: [
          {
            id: 'C',
            tracks: [
              track({ id: 't1' }),
              track({ id: 't2', labelUrl: 'https://custom/{id}' }),
            ],
          },
        ],
      })
    );
    expect(out.categories[0].tracks[0].labelUrl).toBe(
      'https://uniprot.org/{accession}'
    );
    expect(out.categories[0].tracks[1].labelUrl).toBe('https://custom/{id}');
  });

  it('inherits helpPage: track > category > defaults', () => {
    const out = normalizeConfig(
      cfg({
        defaults: { helpPage: 'default-help' },
        sources: { features: 'https://x' },
        categories: [
          {
            id: 'CAT1',
            helpPage: 'cat1-help',
            tracks: [
              track({ id: 't1' }),
              track({ id: 't2', helpPage: 'track-help' }),
            ],
          },
          {
            id: 'CAT2',
            tracks: [track({ id: 't3' })],
          },
        ],
      })
    );
    expect(out.categories[0].tracks[0].helpPage).toBe('cat1-help');
    expect(out.categories[0].tracks[1].helpPage).toBe('track-help');
    expect(out.categories[1].tracks[0].helpPage).toBe('default-help');
    // Category helpPage resolution: CAT1 uses its own; CAT2 inherits
    // from defaults.
    expect(out.categories[0].helpPage).toBe('cat1-help');
    expect(out.categories[1].helpPage).toBe('default-help');
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
        categories: [
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
    expect(out.categories[0].tracks[0].component).toBe(
      'nightingale-colored-sequence'
    );
  });

  it('explicit component on track wins over kind resolution', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
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
    expect(out.categories[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });

  it('falls back to category component when neither kind nor track.component is set', () => {
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
          {
            id: 'C',
            component: 'nightingale-interpro-track',
            tracks: [track({ id: 't' })],
          },
        ],
      })
    );
    expect(out.categories[0].tracks[0].component).toBe(
      'nightingale-interpro-track'
    );
  });

  it('defaults to nightingale-track-canvas when nothing else resolves', () => {
    const out = normalizeConfig(
      cfg({
        categories: [{ id: 'C', tracks: [track({ id: 't' })] }],
      })
    );
    expect(out.categories[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });

  it("preserves the track's kind string verbatim for downstream introspection", () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      }),
      { registry }
    );
    expect(out.categories[0].tracks[0].kind).toBe('features');
  });
});

// ─────────────────────────────────────────────────────────────
// Category component inference from children
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — category component inference', () => {
  it('uses the shared child component when all tracks agree', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
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
    expect(out.categories[0].component).toBe('nightingale-track-canvas');
  });

  it('falls back to nightingale-track-canvas for a mixed-component category', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
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
    expect(out.categories[0].component).toBe('nightingale-track-canvas');
  });

  it('preserves an explicit category component even when children disagree', () => {
    const registry = createRegistry();
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
          {
            id: 'C',
            component: 'nightingale-interpro-track',
            tracks: [
              track({ id: 't1', kind: 'features' }),
              track({ id: 't2', kind: 'variants' }),
            ],
          },
        ],
      }),
      { registry }
    );
    expect(out.categories[0].component).toBe('nightingale-interpro-track');
  });

  it('picks a default component for a zero-track category', () => {
    // Spec: zero-track categories are skipped at render time with a
    // warning; we still need *some* component so downstream code
    // doesn't crash if it iterates empty categories.
    const out = normalizeConfig(
      cfg({
        categories: [{ id: 'EMPTY', tracks: [] }],
      })
    );
    expect(out.categories[0].component).toBe('nightingale-track-canvas');
  });
});

// ─────────────────────────────────────────────────────────────
// Duplicate id detection
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — duplicate id detection', () => {
  it('rejects duplicate category ids (spec test)', () => {
    expect(() =>
      normalizeConfig({
        categories: [
          { id: 'DUPED', tracks: [] },
          { id: 'DUPED', tracks: [] },
        ],
      })
    ).toThrow(/Duplicate category id 'DUPED'/);
  });

  it('rejects duplicate track ids within a category', () => {
    expect(() =>
      normalizeConfig(
        cfg({
          sources: { features: 'https://x' },
          categories: [
            {
              id: 'C',
              tracks: [track({ id: 't' }), track({ id: 't' })],
            },
          ],
        })
      )
    ).toThrow(/Duplicate track id 't' in category 'C'/);
  });

  it('allows identical track ids across different categories', () => {
    expect(() =>
      normalizeConfig(
        cfg({
          sources: { features: 'https://x' },
          categories: [
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
      categories: [{ id: 'C', tracks: [] }],
    });
    expect(out.version).toBe('1.0');
  });

  it('preserves accession when set', () => {
    const out = normalizeConfig({
      accession: 'P05067',
      categories: [{ id: 'C', tracks: [] }],
    });
    expect(out.accession).toBe('P05067');
  });

  it('always produces a sources object (empty when omitted)', () => {
    const out = normalizeConfig({
      categories: [{ id: 'C', tracks: [] }],
    });
    expect(out.sources).toEqual({});
  });

  it('always produces a defaults object with a rendering sub-object', () => {
    const out = normalizeConfig({
      categories: [{ id: 'C', tracks: [] }],
    });
    expect(out.defaults.rendering).toEqual({});
    expect(out.defaults.labelUrl).toBeUndefined();
    expect(out.defaults.helpPage).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// No-registry behaviour
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — without a registry', () => {
  it("keeps unresolved kinds on tracks rather than throwing", () => {
    // Tests can exercise expansion/inheritance without setting up a
    // registry at all. The validator (#22) raises "Unknown semantic
    // kind" later.
    const out = normalizeConfig(
      cfg({
        sources: { features: 'https://x' },
        categories: [
          {
            id: 'C',
            tracks: [track({ id: 't', kind: 'features', data: 'features' })],
          },
        ],
      })
    );
    expect(out.categories[0].tracks[0].kind).toBe('features');
    // Adapter stays undefined because there's no registry to look up
    // the kind's canonical adapter.
    expect(out.categories[0].tracks[0].data[0].adapter).toBeUndefined();
    // Component falls through to the default.
    expect(out.categories[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Transform passthrough
// ─────────────────────────────────────────────────────────────

describe('normalizeConfig — transform pipeline passthrough', () => {
  it('preserves the transform array on descriptors verbatim', () => {
    const out = normalizeConfig(
      cfg({
        categories: [
          {
            id: 'C',
            tracks: [
              track({
                id: 't',
                data: {
                  url: './x.csv',
                  transform: [
                    { filter: { field: 'score', gte: 0.8 } },
                    { limit: 100 },
                  ],
                },
              }),
            ],
          },
        ],
      })
    );
    const d = out.categories[0].tracks[0].data[0];
    expect(d.transform).toEqual([
      { filter: { field: 'score', gte: 0.8 } },
      { limit: 100 },
    ]);
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
        categories: [
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

    const c = out.categories[0];
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
