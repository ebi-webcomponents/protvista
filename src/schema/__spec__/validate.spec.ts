/**
 * Validator contract tests.
 *
 * Covers every edge case `validateConfig` is responsible for — the
 * non-runtime ones (URL 4xx/5xx, malformed adapter input, runtime
 * tooltip warnings, etc. are the loader's / adapter's concern).
 *
 * Each test also asserts on the emitted `code` so downstream tools
 * can rely on the stable machine-readable discriminator without
 * parsing English strings.
 */

import { describe, it, expect } from 'vitest';
import { validateConfig } from '../validate.js';
import { createRegistry } from '../registry.js';
import type { ProtvistaViewerConfig, TrackConfig } from '../types.js';
import type { ValidationIssue } from '../errors.js';

const freshRegistry = () => {
  const r = createRegistry();
  // Seed a minimal adapter set so tests exercising semantic checks
  // don't all double-fail on "Unknown adapter".
  r.registerAdapter('uniprot-features-json', () => []);
  r.registerAdapter('alphafold-prediction-json', () => []);
  return r;
};

const minimalValid = (): ProtvistaViewerConfig => ({
  rows: [
    {
      id: 'DOMAINS',
      tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
    },
  ],
  sources: { features: 'https://example.org/features' },
});

// ─────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────

describe('validateConfig — happy paths', () => {
  it('accepts a minimal valid config', () => {
    const result = validateConfig(minimalValid(), freshRegistry());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts a config with no accession when no placeholders are present', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [
        {
          id: 'DOMAINS',
          tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(result.valid).toBe(true);
  });

  it('accepts {accession} placeholders when accession is set', () => {
    const cfg: ProtvistaViewerConfig = {
      accession: 'P05067',
      sources: { features: 'https://example.org/{accession}/features' },
      rows: [
        {
          id: 'DOMAINS',
          tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Structural (Ajv) pass
// ─────────────────────────────────────────────────────────────

describe('validateConfig — structural errors', () => {
  it('rejects a config with no `rows`', () => {
    const result = validateConfig({}, freshRegistry());
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('schema');
    // `rows` is required at the root.
    expect(result.issues.some((i) => i.message.includes("'rows'"))).toBe(true);
  });

  it('rejects an unknown top-level field', () => {
    const result = validateConfig(
      { rows: [], foo: 'bar' },
      freshRegistry()
    );
    expect(result.valid).toBe(false);
    expect(result.issues.every((i) => i.code === 'schema')).toBe(true);
  });

  it('short-circuits the semantic pass when structural fails', () => {
    // A missing required field in a track should produce ONE issue,
    // not a cascade of semantic ones — the validator bails after
    // the structural pass.
    const bad = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y' /* data missing */ }],
        },
      ],
    };
    const result = validateConfig(bad, freshRegistry());
    expect(result.valid).toBe(false);
    expect(result.issues.every((i) => i.code === 'schema')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: unknown source key
// ─────────────────────────────────────────────────────────────

describe('validateConfig — unknown source key', () => {
  it('flags a string-shorthand value that is not a sources key or URL', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { knownKey: 'https://example.org/k' },
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'features', data: 'missingKey' }],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'unknown-source-key');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("Unknown source key: 'missingKey'");
    expect(issue!.message).toContain('X/y');
    expect(issue!.message).toContain("'knownKey'");
  });

  it('flags an explicit `source:` reference that does not resolve', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { k: 'https://example.org/k' },
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'features',
              data: { from: 'url', source: 'notInMap' },
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'unknown-source-key');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("Unknown source key: 'notInMap'");
  });

  it('accepts a ./x.csv file-path shorthand (built-in adapter, no unknown-source-key)', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'features', data: './features.csv' }],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'unknown-source-key')).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it('accepts a ./x.json file-path shorthand (built-in adapter, no unknown-source-key)', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'features', data: './features.json' }],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'unknown-source-key')).toBeUndefined();
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: unknown adapter / kind / component
// ─────────────────────────────────────────────────────────────

describe('validateConfig — unknown adapter / kind / component', () => {
  it('flags an unknown `adapter` name', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'features',
              data: { url: 'https://example.org/x', adapter: 'nope' },
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'unknown-adapter');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('Unknown adapter: nope');
    expect(issue!.message).toContain('registerAdapter()');
  });

  it('flags an unknown semantic `kind`', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'not-a-real-kind',
              data: { url: 'https://example.org/x' },
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'unknown-semantic-kind');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain(
      "Unknown semantic kind: 'not-a-real-kind'"
    );
    expect(issue!.message).toContain('registerSemanticKind()');
  });

  it.each([
    ['confidence-score', 'alphafold-confidence'],
    ['pathogenicity-score', 'alphamissense-pathogenicity'],
    ['pathogenicity-heatmap', 'alphamissense-heatmap'],
    ['features-interpro', 'interpro-features'],
  ])('points %s at its new name', (written, renamed) => {
    // Kinds are the author-facing vocabulary this rename touched, so a config
    // written against the old names deserves the same pointed hint a removed
    // adapter name gets — not just an alphabetical list to search.
    const cfg = {
      rows: [
        {
          id: 'X',
          tracks: [
            { id: 'y', kind: written, data: { url: 'https://example.org/x' } },
          ],
        },
      ],
    } as ProtvistaViewerConfig;
    const issue = issueByCode(
      validateConfig(cfg, freshRegistry()).issues,
      'unknown-semantic-kind'
    );
    expect(issue!.message).toContain(`Renamed to '${renamed}'`);
  });

  it('flags an unknown `component` on a track', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              component: 'nightingale-fake',
              data: { url: 'https://example.org/x', adapter: 'uniprot-features-json' },
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'unknown-component')).toBeDefined();
  });

  describe('a kind that resolves to an unregistered adapter', () => {
    const registryWithKind = () => {
      const r = freshRegistry();
      r.registerComponent(
        'my-track',
        function () {} as unknown as CustomElementConstructor
      );
      r.registerSemanticKind('my-kind', {
        component: 'my-track',
        adapter: 'never-registered',
      });
      return r;
    };

    it('flags the implicit adapter when no descriptor overrides it', () => {
      // A consumer kind whose adapter was never registered would otherwise
      // fail only at load time, degrading the track to empty.
      const cfg: ProtvistaViewerConfig = {
        rows: [
          { id: 'X', tracks: [{ id: 'y', kind: 'my-kind', data: 'https://x' }] },
        ],
      };
      const issues = validateConfig(cfg, registryWithKind()).issues.filter(
        (i) => i.code === 'unknown-adapter'
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toBe(
        "Semantic kind 'my-kind' in track X/y resolves to adapter " +
          "'never-registered', which is not registered. Register it with " +
          'registerAdapter().'
      );
    });

    it('does not flag it when a descriptor sets an explicit registered adapter', () => {
      // The explicit `adapter:` overrides the kind's, which is never used.
      const cfg: ProtvistaViewerConfig = {
        rows: [
          {
            id: 'X',
            tracks: [
              {
                id: 'y',
                kind: 'my-kind',
                data: { url: './x', adapter: 'uniprot-features-json' },
              },
            ],
          },
        ],
      };
      const issues = validateConfig(cfg, registryWithKind()).issues.filter(
        (i) => i.code === 'unknown-adapter'
      );
      expect(issues).toEqual([]);
    });
  });

  it('reports track-level issues in a fixed order', () => {
    // Issue order is user-visible, and `checkTrack` composes it from
    // separate rule calls: component, then kind, then descriptors.
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              component: 'not-a-component',
              kind: 'not-a-kind',
              data: { url: 'https://example.org/x', adapter: 'nope' },
            },
          ],
        },
      ],
    };
    const codes = validateConfig(cfg, freshRegistry())
      .issues.filter((i) => i.path?.startsWith('X/y'))
      .map((i) => i.code);
    expect(codes).toEqual([
      'unknown-component',
      'unknown-semantic-kind',
      'unknown-adapter',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: registry-driven component resolution
// ─────────────────────────────────────────────────────────────

describe('validateConfig — registry-driven components', () => {
  const stubCtor = () =>
    function () {} as unknown as CustomElementConstructor;

  it('accepts an explicit `component` a consumer has registered', () => {
    const r = freshRegistry();
    r.registerComponent('my-track', stubCtor());
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              component: 'my-track',
              data: { url: 'https://example.org/x', adapter: 'uniprot-features-json' },
            },
          ],
        },
      ],
    };
    expect(
      issueByCode(validateConfig(cfg, r).issues, 'unknown-component')
    ).toBeUndefined();
  });

  it('accepts a consumer kind whose component is registered', () => {
    const r = freshRegistry();
    r.registerComponent('my-track', stubCtor());
    r.registerSemanticKind('my-kind', {
      component: 'my-track',
      adapter: 'uniprot-features-json',
    });
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [{ id: 'X', tracks: [{ id: 'y', kind: 'my-kind', data: 'features' }] }],
    };
    const result = validateConfig(cfg, r);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a kind that resolves to an UNregistered component before mount', () => {
    // The consumer registered the kind but forgot registerComponent().
    const r = freshRegistry();
    r.registerSemanticKind('my-kind', {
      component: 'my-track',
      adapter: 'uniprot-features-json',
    });
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [{ id: 'X', tracks: [{ id: 'y', kind: 'my-kind', data: 'features' }] }],
    };
    const issue = issueByCode(
      validateConfig(cfg, r).issues,
      'unknown-component'
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("resolves to component 'my-track'");
    expect(issue!.message).toContain('registerComponent()');
  });

  it('does not flag the kind-resolved component when an explicit component overrides it', () => {
    // A known kind whose registered component is itself unregistered,
    // but the track sets an explicit *registered* `component` that
    // overrides the kind's component (normalize: `t.component ??
    // kindDef.component`). The kind's component is never used, so
    // validation must not reject — regression guard for the spurious
    // unknown-component the kind-resolved check would otherwise raise.
    const r = freshRegistry();
    r.registerComponent('override-track', stubCtor());
    r.registerSemanticKind('kind-with-unregistered-component', {
      component: 'never-registered',
      adapter: 'uniprot-features-json',
    });
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'kind-with-unregistered-component',
              component: 'override-track',
              data: 'features',
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, r);
    expect(issueByCode(result.issues, 'unknown-component')).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it('does not double-flag: an unknown kind reports only unknown-semantic-kind', () => {
    // When the kind itself is unknown, the kind-resolved component check
    // is skipped (nothing to resolve) so only one issue fires.
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [{ id: 'X', tracks: [{ id: 'y', kind: 'nope', data: 'features' }] }],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'unknown-semantic-kind')).toBeDefined();
    expect(issueByCode(result.issues, 'unknown-component')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: missing-track-renderer
// ─────────────────────────────────────────────────────────────

describe('validateConfig — missing track renderer', () => {
  it('flags a track with no kind, no component, and no group component', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            { id: 'y', data: { url: 'https://example.org/x', adapter: 'uniprot-features-json' } },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'missing-track-renderer');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('X/y');
    expect(issue!.message).toContain("'features'");
  });

  it('accepts a track with no kind/component when the group has component', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          component: 'nightingale-track-canvas',
          tracks: [
            { id: 'y', data: { url: 'https://example.org/x', adapter: 'uniprot-features-json' } },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(
      issueByCode(result.issues, 'missing-track-renderer')
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Top-level standalone tracks
// ─────────────────────────────────────────────────────────────

describe('validateConfig — standalone top-level tracks', () => {
  it('accepts a single standalone track with zero groups', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [{ id: 'signal_peptide', kind: 'features', data: 'features' }],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts a config mixing standalone tracks and groups', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [
        { id: 'signal_peptide', kind: 'features', filter: 'SIGNAL', data: 'features' },
        {
          id: 'DOMAINS',
          tracks: [{ id: 'domain', kind: 'features', filter: 'DOMAIN', data: 'features' }],
        },
        { id: 'confidence', kind: 'features', data: 'features' },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a standalone track with no kind and no component, same as a grouped track', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        { id: 'orphan', data: { url: 'https://example.org/x', adapter: 'uniprot-features-json' } },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'missing-track-renderer');
    expect(issue).toBeDefined();
    // Standalone track has no parent group, so the path is the bare id
    // (no `group/track` prefix).
    expect(issue!.path).toBe('orphan');
    expect(issue!.message).toContain("'features'");
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: from: inline without inlineData
// ─────────────────────────────────────────────────────────────

describe('validateConfig — from: inline without inlineData', () => {
  it('flags descriptor with `from: inline` and no inlineData', () => {
    // `schema.json`'s `if/then` requires `inlineData` whenever `from:
    // 'inline'`, so a structurally-missing `inlineData` fails at the
    // structural pass and short-circuits before the semantic pass
    // ever gets to its own `missing-inline-data` check. Assertion is
    // loose (any error message mentioning `inlineData`) so this test
    // doesn't have to pin which pass produced it.
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            { id: 'y', kind: 'features', data: { from: 'inline' } },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(result.valid).toBe(false);
    // Schema-level error is acceptable; message should still be clear.
    expect(result.issues.some((i) => i.message.includes('inlineData'))).toBe(
      true
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: kind vs file format
// ─────────────────────────────────────────────────────────────

/**
 * A `kind:` owns adapter selection, so a kind pointed at a file format its
 * family cannot read would fetch the body and hand it to an adapter expecting
 * a different one. That used to resolve to a generic feature adapter and draw
 * an empty track with nothing to point at; it is now a config-time error.
 */
describe('validateConfig — kind vs file format', () => {
  const withData = (
    kind: string,
    data: TrackConfig['data'],
    sources?: Record<string, string>
  ): ProtvistaViewerConfig => ({
    rows: [{ id: 'X', tracks: [{ id: 'y', kind, data }] }],
    ...(sources ? { sources } : {}),
  });

  it('flags a provider-only kind pointed at a delimited file', () => {
    // `alphamissense-pathogenicity` has no family: its adapter needs two
    // inputs and a secondary fetch, so no single file can feed it.
    const result = validateConfig(
      withData('alphamissense-pathogenicity', './am.csv'),
      freshRegistry()
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === 'kind-format-mismatch');
    expect(issue).toBeDefined();
    expect(issue?.path).toBe('X/y');
    // The message has to name the offending kind, the format, and a way
    // forward — it is the author's only signal that the pairing is wrong.
    expect(issue?.message).toContain("'alphamissense-pathogenicity'");
    expect(issue?.message).toContain("reads its provider's feed");
    expect(issue?.message).toContain("'features'");
    expect(issue?.message).toContain("adapter:");
  });

  it('flags the same mismatch behind a sources key', () => {
    const result = validateConfig(
      withData('alphamissense-pathogenicity', 'am', {
        am: 'https://lab.test/am.csv',
      }),
      freshRegistry()
    );
    expect(
      result.issues.some((i) => i.code === 'kind-format-mismatch')
    ).toBe(true);
  });

  it('accepts a format the kind’s family declares', () => {
    for (const data of ['./hits.csv', './hits.tsv', './hits.json', './x.bed']) {
      const result = validateConfig(withData('features', data), freshRegistry());
      expect(
        result.issues.filter((i) => i.code === 'kind-format-mismatch'),
        `unexpected mismatch for ${data}`
      ).toEqual([]);
    }
  });

  it('flags a provider-only kind pointed at a file of any format', () => {
    // Previously only a *text* file was flagged: a `.json` matched the
    // adapter's body type, so the check passed and the track failed at load
    // instead. That was never right — all three shapeless kinds read two API
    // responses plus a further fetch, which no single file can provide,
    // whatever its encoding. Declaring a shape is what makes a kind readable
    // from a file, so its absence is the whole answer.
    const result = validateConfig(
      withData('alphafold-confidence', './plddt.json'),
      freshRegistry()
    );
    const issue = result.issues.find((i) => i.code === 'kind-format-mismatch');
    expect(issue?.message).toContain("reads its provider's feed");
  });

  it('names both shapes when a format cannot carry the kind’s records', () => {
    // The diagnostic the redesign exists for: no adapter name, no body type,
    // just the file and the track.
    const result = validateConfig(
      withData('variants', './regions.bed'),
      freshRegistry()
    );
    const issue = result.issues.find((i) => i.code === 'kind-format-mismatch');
    expect(issue?.message).toBe(
      "BED files carry feature records (type, start, end); kind 'variants' in " +
        'track X/y draws variation records (position, variant). Use a kind that ' +
        'draws feature records (type, start, end) (\'features\', ' +
        "'interpro-features', 'peptides', 'peptides-ptm', 'structure-coverage'), " +
        'or convert the file.'
    );
  });

  it('warns, without failing, when an explicit format overrides the extension', () => {
    const result = validateConfig(
      withData('features', { from: 'file', url: './hits.txt', format: 'csv' }),
      freshRegistry()
    );
    const issue = result.issues.find(
      (i) => i.code === 'format-overrides-extension'
    );
    expect(issue).toBeUndefined(); // `.txt` is not a known format — nothing to override
    expect(result.valid).toBe(true);
  });

  it('warns when the declared format and a known extension disagree', () => {
    const result = validateConfig(
      withData('features', { from: 'file', url: './hits.csv', format: 'tsv' }),
      freshRegistry()
    );
    const issue = result.issues.find(
      (i) => i.code === 'format-overrides-extension'
    );
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('read as TSV');
    // A warning names something legal: the config still loads.
    expect(result.valid).toBe(true);
  });

  it('rejects inline text with no format to read it by', () => {
    const result = validateConfig(
      withData('linegraph', {
        from: 'inline',
        inlineData: 'position,value\n1,412\n',
      }),
      freshRegistry()
    );
    const issue = result.issues.find((i) => i.code === 'missing-format');
    expect(issue?.message).toContain("no 'format' says how to read it");
    expect(result.valid).toBe(false);
  });

  it('rejects inline text written in the shorthand form too', () => {
    // `from:` defaults to `inline` whenever `inlineData` is set, and that is
    // the form most authors write. Keying the check on the literal `from:`
    // let this config through validation and failed it at load time — the
    // one place the diagnostic exists to pre-empt.
    const result = validateConfig(
      withData('linegraph', { inlineData: 'position,value\n1,412\n' }),
      freshRegistry()
    );
    const issue = result.issues.find((i) => i.code === 'missing-format');
    expect(issue?.message).toContain("no 'format' says how to read it");
    expect(result.valid).toBe(false);
  });

  it('rejects inline text on a track with no kind at all', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'X',
            tracks: [
              {
                id: 'y',
                component: 'nightingale-track-canvas',
                data: { inlineData: 'type,start,end,description\nA,1,2,x\n' },
              },
            ],
          },
        ],
      } as ProtvistaViewerConfig,
      freshRegistry()
    );
    expect(
      result.issues.some((i) => i.code === 'missing-format')
    ).toBe(true);
  });

  it('accepts inline records written as a list', () => {
    // Only *text* needs a format; a list is already decoded.
    const result = validateConfig(
      withData('linegraph', { inlineData: [{ position: 1, value: 412 }] }),
      freshRegistry()
    );
    expect(result.issues.filter((i) => i.code === 'missing-format')).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects several sources read through a format', () => {
    // A format decodes one body: `runPipeline` takes one and the loader drops
    // the rest. This used to resolve to the kind's provider adapter and fetch
    // both files as JSON, with nothing said about it.
    const result = validateConfig(
      withData('features', { from: 'file', url: ['./a.csv', './b.csv'] }),
      freshRegistry()
    );
    const issue = result.issues.find((i) => i.code === 'multi-source-format');
    expect(issue?.message).toBe(
      'Track X/y lists 2 sources, but reads them as CSV records. A format ' +
        'reads one file at a time. Use one source per track, or set an ' +
        "explicit 'adapter:' that takes several responses."
    );
    expect(result.valid).toBe(false);
  });

  it("names a formatless source list on a shape-only kind as 'its own records'", () => {
    // `kind: linegraph` has a shape and no provider adapter to fall back on,
    // so a list with no format or extension is still read as records.
    const result = validateConfig(
      withData('linegraph', { source: ['a', 'b'] }, {
        a: 'https://ebi.test/a',
        b: 'https://ebi.test/b',
      }),
      freshRegistry()
    );
    const issue = result.issues.find((i) => i.code === 'multi-source-format');
    expect(issue?.message).toBe(
      'Track X/y lists 2 sources, but reads them as its own records. A format ' +
        'reads one file at a time. Use one source per track, or set an ' +
        "explicit 'adapter:' that takes several responses."
    );
  });

  it('rejects several sources read through a declared format on a kindless track', () => {
    // A declared `format:` asks for records whether or not there is a kind.
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              component: 'nightingale-track-canvas',
              data: { from: 'file', url: ['./a', './b'], format: 'csv' },
            },
          ],
        },
      ],
    };
    const issue = validateConfig(cfg, freshRegistry()).issues.find(
      (i) => i.code === 'multi-source-format'
    );
    expect(issue?.message).toContain('reads them as CSV records');
  });

  it('reports an override before the mismatch it leads to', () => {
    // Issue order is user-visible: the override explains the format that the
    // mismatch then names.
    const result = validateConfig(
      withData('variants', { from: 'file', url: './x.csv', format: 'bed' }),
      freshRegistry()
    );
    expect(result.issues.map((i) => i.code)).toEqual([
      'format-overrides-extension',
      'kind-format-mismatch',
    ]);
  });

  it('leaves a multi-input provider adapter alone', () => {
    // The three shipped AlphaFold/AlphaMissense tracks name two sources on
    // purpose — their adapters take two responses.
    const result = validateConfig(
      withData('alphafold-confidence', { source: ['af', 'proteins'] }, {
        af: 'https://af.test/{accession}',
        proteins: 'https://ebi.test/{accession}',
      }),
      freshRegistry()
    );
    expect(
      result.issues.filter((i) => i.code === 'multi-source-format')
    ).toEqual([]);
  });

  it('leaves a formatless source list on a kind with a provider adapter alone', () => {
    // `kind: variants` has a shape *and* a provider adapter. With no format
    // and no extension to read records by, the list goes to the adapter,
    // which takes every response, so the config loads.
    const result = validateConfig(
      withData('variants', { source: ['variation', 'proteins'] }, {
        variation: 'https://ebi.test/variation/{accession}',
        proteins: 'https://ebi.test/proteins/{accession}',
      }),
      freshRegistry()
    );
    expect(
      result.issues.filter((i) => i.code === 'multi-source-format')
    ).toEqual([]);
  });

  it('accepts several sources behind an explicit adapter', () => {
    const result = validateConfig(
      withData('features', {
        from: 'file',
        url: ['./a.csv', './b.csv'],
        adapter: 'uniprot-features-json',
      }),
      freshRegistry()
    );
    expect(
      result.issues.filter((i) => i.code === 'multi-source-format')
    ).toEqual([]);
  });

  it('accepts a mismatch the author resolved with an explicit adapter', () => {
    const result = validateConfig(
      withData('alphamissense-pathogenicity', {
        from: 'file',
        url: './am.csv',
        adapter: 'uniprot-features-json',
      }),
      freshRegistry()
    );
    expect(
      result.issues.filter((i) => i.code === 'kind-format-mismatch')
    ).toEqual([]);
  });

  it('reports only multi-source-format, not a kind/format mismatch too', () => {
    // A multi-source descriptor stops at the multi-source issue: BED on a
    // `variants` track would also be a kind/format mismatch, but one issue
    // per descriptor keeps the author's fix list short.
    const result = validateConfig(
      withData('variants', {
        from: 'file',
        url: ['./a.bed', './b.bed'],
        format: 'bed',
      }),
      freshRegistry()
    );
    expect(result.issues.map((i) => i.code)).toEqual(['multi-source-format']);
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: colorScale
// ─────────────────────────────────────────────────────────────

describe('validateConfig — colorScale', () => {
  it('flags an unknown theme', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'features',
              data: 'https://example.org/x',
              rendering: { colorScale: { theme: 'not-a-theme' } },
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'unknown-theme');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("Unknown colorScale theme: 'not-a-theme'");
    expect(issue!.message).toContain("'alphafold-ramp'");
  });

  it('accepts a built-in theme', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'alphafold-confidence',
              data: 'https://example.org/x',
              rendering: { colorScale: { theme: 'alphafold-ramp' } },
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'unknown-theme')).toBeUndefined();
  });
});

describe('validateConfig — rendering fields with no effect', () => {
  const stops = {
    stops: [
      { value: 0, color: '#fff' },
      { value: 1, color: '#000' },
    ],
  };
  const ignored = (issues: ValidationIssue[]) =>
    issues.filter((i) => i.code === 'rendering-field-ignored');

  it('warns that colorScale does nothing on a features track', () => {
    const result = validateConfig(
      {
        sources: { features: 'https://example.org/features' },
        rows: [
          {
            id: 'G',
            tracks: [
              {
                id: 'hits',
                kind: 'features',
                data: 'features',
                rendering: { colorScale: stops },
              },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([
      {
        path: 'G/hits',
        severity: 'warning',
        message:
          "Track G/hits: rendering.colorScale has no effect on nightingale-track-canvas; only nightingale-colored-sequence and nightingale-sequence-heatmap draw a colour scale. To colour single features, give them a 'color' column.",
        code: 'rendering-field-ignored',
      },
    ]);
    // A warning: the config still loads.
    expect(result.valid).toBe(true);
  });

  it('does not warn for colorScale on a coloured-sequence track', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'af',
            kind: 'alphafold-confidence',
            data: 'https://example.org/x',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([]);
  });

  it('does not warn for colorScale on a heatmap track', () => {
    // The heatmap colours each cell from its resolved colorScale.
    const result = validateConfig(
      {
        rows: [
          {
            id: 'am',
            kind: 'alphamissense-heatmap',
            data: 'https://example.org/x',
            rendering: { colorScale: { theme: 'alphamissense-ramp' } },
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([]);
  });

  it('warns on a group whose colorScale reaches only its heatmap aggregate', () => {
    // The heatmap track's kind presets its own ramp, so it does not inherit
    // the group's; the collapsed row is a heatmap too, and `_setHeatmapData`
    // draws per-track payloads only, so the group's colorScale shows nowhere.
    const result = validateConfig(
      {
        rows: [
          {
            id: 'G',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
            tracks: [
              {
                id: 'am',
                kind: 'alphamissense-heatmap',
                data: 'https://example.org/x',
              },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([
      {
        path: 'G',
        severity: 'warning',
        message:
          "Group G: rendering.colorScale has no effect on any of its tracks; only nightingale-colored-sequence and nightingale-sequence-heatmap draw a colour scale. A nightingale-sequence-heatmap reads it on its own track, not as a group's collapsed row.",
        code: 'rendering-field-ignored',
      },
    ]);
  });

  it('warns on a heatmap group whose only track sets its own colorScale', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'G',
            component: 'nightingale-sequence-heatmap',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
            tracks: [
              {
                id: 'hm',
                component: 'nightingale-sequence-heatmap',
                data: 'https://example.org/x',
                rendering: { colorScale: { theme: 'alphamissense-ramp' } },
              },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues).map((i) => i.path)).toEqual(['G']);
  });

  it('does not warn for a group colorScale a heatmap track inherits', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'G',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
            tracks: [
              {
                id: 'hm',
                component: 'nightingale-sequence-heatmap',
                data: 'https://example.org/x',
              },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([]);
  });

  it('warns once, on the group, when no track of a group can use its colorScale', () => {
    const result = validateConfig(
      {
        sources: { features: 'https://example.org/features' },
        rows: [
          {
            id: 'G',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
            tracks: [
              { id: 'a', kind: 'features', data: 'features' },
              { id: 'b', kind: 'features', data: 'features' },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([
      {
        path: 'G',
        severity: 'warning',
        message:
          "Group G: rendering.colorScale has no effect on any of its tracks; only nightingale-colored-sequence and nightingale-sequence-heatmap draw a colour scale. To colour single features, give them a 'color' column.",
        code: 'rendering-field-ignored',
      },
    ]);
  });

  it('does not warn for a group colorScale that its coloured-sequence aggregate draws', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'G',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
            tracks: [
              {
                id: 'af',
                kind: 'alphafold-confidence',
                data: 'https://example.org/x',
              },
              { id: 'f', kind: 'features', data: 'https://example.org/y' },
            ],
            component: 'nightingale-colored-sequence',
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([]);
  });

  it('warns on the group when its only coloured-sequence track sets its own colorScale', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'G',
            component: 'nightingale-track-canvas',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
            tracks: [
              {
                id: 'af',
                kind: 'features',
                component: 'nightingale-colored-sequence',
                data: 'https://example.org/x',
                rendering: { colorScale: { theme: 'alphamissense-ramp' } },
              },
              { id: 'f', kind: 'features', data: 'https://example.org/y' },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues).map((i) => i.path)).toEqual(['G']);
  });

  it('warns on the group when its only coloured-sequence track has a kind preset colorScale', () => {
    // The kind preset beats the group's colorScale in the cascade.
    const result = validateConfig(
      {
        rows: [
          {
            id: 'G',
            component: 'nightingale-track-canvas',
            rendering: { colorScale: { theme: 'alphamissense-ramp' } },
            tracks: [
              {
                id: 'af',
                kind: 'alphafold-confidence',
                data: 'https://example.org/x',
              },
              { id: 'f', kind: 'features', data: 'https://example.org/y' },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues).map((i) => i.path)).toEqual(['G']);
  });

  it('does not warn when the inferred aggregate is a coloured sequence', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'G',
            rendering: { colorScale: { theme: 'alphafold-ramp' } },
            tracks: [
              {
                id: 'a',
                kind: 'alphafold-confidence',
                data: 'https://example.org/a',
              },
              {
                id: 'b',
                kind: 'alphafold-confidence',
                data: 'https://example.org/b',
              },
            ],
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([]);
  });

  it('warns that layout does nothing on a line graph', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'depth',
            kind: 'features',
            component: 'nightingale-linegraph-track',
            data: 'https://example.org/x',
            rendering: { layout: 'default' },
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([
      {
        path: 'depth',
        severity: 'warning',
        message:
          'Track depth: rendering.layout has no effect on nightingale-linegraph-track; only nightingale-track-canvas lays features out in rows.',
        code: 'rendering-field-ignored',
      },
    ]);
  });

  it('warns that color and shape do nothing on a line graph', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'depth',
            kind: 'linegraph',
            data: 'https://example.org/x.csv',
            rendering: { color: 'red', shape: 'circle' },
          },
        ],
      },
      freshRegistry()
    );
    expect(ignored(result.issues).map((i) => i.message)).toEqual([
      'Track depth: rendering.color has no effect on nightingale-linegraph-track; only nightingale-track-canvas colours its features.',
      'Track depth: rendering.shape has no effect on nightingale-linegraph-track; only nightingale-track-canvas draws feature glyphs.',
    ]);
  });

  it('does not warn for layout or height on a features track', () => {
    const result = validateConfig(
      {
        rows: [
          {
            id: 'hits',
            kind: 'features',
            data: 'https://example.org/x',
            rendering: { layout: 'default', height: 120 },
          },
        ],
      },
      freshRegistry()
    );
    expect(result.issues).toEqual([]);
  });

  it('does not warn for defaults, which apply only where they can', () => {
    const result = validateConfig(
      {
        defaults: { rendering: { layout: 'default', colorScale: stops } },
        rows: [{ id: 'hits', kind: 'features', data: 'https://example.org/x' }],
      },
      freshRegistry()
    );
    expect(ignored(result.issues)).toEqual([]);
  });

  it('does not warn for a consumer component, which reads what it likes', () => {
    const registry = freshRegistry();
    registry.registerComponent('acme-track', class extends HTMLElement {});
    const result = validateConfig(
      {
        rows: [
          {
            id: 'mine',
            kind: 'features',
            component: 'acme-track',
            data: 'https://example.org/x',
            rendering: { colorScale: stops, layout: 'default' },
          },
        ],
      },
      registry
    );
    expect(ignored(result.issues)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: version
// ─────────────────────────────────────────────────────────────

describe('validateConfig — version', () => {
  it('accepts omitted version', () => {
    const result = validateConfig(minimalValid(), freshRegistry());
    expect(result.valid).toBe(true);
  });

  it('accepts version: "1.0"', () => {
    const cfg: ProtvistaViewerConfig = { ...minimalValid(), version: '1.0' };
    const result = validateConfig(cfg, freshRegistry());
    expect(result.valid).toBe(true);
  });

  it('rejects an unsupported version', () => {
    const cfg = { ...minimalValid(), version: '2.0' };
    const result = validateConfig(cfg, freshRegistry());
    // Schema's `const: "1.0"` catches this structurally; the
    // `unsupported-version` semantic code path is unreachable today
    // because the schema gate fires first.
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'schema')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic: accession placeholders
// ─────────────────────────────────────────────────────────────

describe('validateConfig — accession placeholders', () => {
  it('flags a config with {accession} placeholder but no accession', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/{accession}/features' },
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'features', data: 'features' }],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    const issue = issueByCode(result.issues, 'missing-accession');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('{accession}');
  });

  it('finds {accession} in a descriptor url', () => {
    const cfg: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'features',
              data: { url: 'https://example.org/{accession}/features' },
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'missing-accession')).toBeDefined();
  });

  // `label` is a Markdoc source string with `{accession}` interpolated
  // before render, so the placeholder scan must cover it — this replaces
  // the removed `labelUrl` accession check and guards validate.ts's
  // group/track label branches.
  it('finds {accession} in a track label', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'features',
              data: 'features',
              label: '[AlphaFold](https://example.org/{accession})',
            },
          ],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'missing-accession')).toBeDefined();
  });

  it('finds {accession} in a group label', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      rows: [
        {
          id: 'X',
          label: 'Entry {accession}',
          tracks: [{ id: 'y', kind: 'features', data: 'features' }],
        },
      ],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(issueByCode(result.issues, 'missing-accession')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Structural: malformed top-level entry shape
// ─────────────────────────────────────────────────────────────

describe('validateConfig — invalid top-level entry shape', () => {
  /** Build a config whose single entry is `entry`. */
  const withEntry = (entry: unknown) =>
    ({
      sources: { features: 'https://example.org/features' },
      rows: [entry],
    }) as unknown as ProtvistaViewerConfig;

  it('flags an entry with neither `tracks:` nor `data:`, naming both fields', () => {
    const result = validateConfig(
      withEntry({ id: 'orphan', kind: 'features' }),
      freshRegistry()
    );

    expect(result.valid).toBe(false);
    // Exactly one issue: the whole point is that the contradictory
    // "needs tracks" / "needs data" / `oneOf` trio no longer surfaces.
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue.code).toBe('invalid-entry-shape');
    expect(issue.path).toBe('/rows/0');
    expect(issue.message).toContain("'orphan'");
    expect(issue.message).toContain("'tracks:'");
    expect(issue.message).toContain("'data:'");
  });

  it('flags an entry with both `tracks:` and `data:`, naming both fields', () => {
    const result = validateConfig(
      withEntry({ id: 'mixed', tracks: [], data: 'features' }),
      freshRegistry()
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue.code).toBe('invalid-entry-shape');
    expect(issue.message).toContain("'mixed'");
    expect(issue.message).toContain("'tracks:'");
    expect(issue.message).toContain("'data:'");
    // The two cases must not read identically — this one is about
    // having both, not about missing one.
    expect(issue.message).toContain('both');
  });

  it('no longer surfaces the raw oneOf / contradictory required errors', () => {
    const result = validateConfig(
      withEntry({ id: 'orphan', kind: 'features' }),
      freshRegistry()
    );

    const text = result.issues.map((i) => i.message).join('\n');
    expect(text).not.toContain('oneOf');
    expect(text).not.toContain("required property 'tracks'");
    expect(text).not.toContain("required property 'data'");
    expect(issueByCode(result.issues, 'schema')).toBeUndefined();
  });

  it('falls back to the index when the entry has no usable id', () => {
    const result = validateConfig(withEntry({ kind: 'features' }), freshRegistry());

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('at index 0');
  });

  it('falls back to the index for a non-string or empty id', () => {
    // The guard is `typeof id === 'string' && id.length > 0`. A numeric
    // or blank id is not a usable label, so it must degrade to the
    // index rather than quote `'42'` / `''` into the message.
    for (const id of [42, ''] as const) {
      const result = validateConfig(withEntry({ id, kind: 'features' }), freshRegistry());
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain('at index 0');
      expect(result.issues[0].message).not.toContain(`'${id}'`);
    }
  });

  it('treats an empty `tracks:` stub as unset, not as a group', () => {
    // `tracks:` with nothing after it parses to null. Per `shape.ts`'s
    // `isSet`, that is a leftover stub rather than a value — so the entry
    // reads as "neither", not as an empty group.
    const result = validateConfig(withEntry({ id: 'stub', tracks: null }), freshRegistry());

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('invalid-entry-shape');
    expect(result.issues[0].message).toContain('neither');
  });

  it('reads a both-null stub as "neither", not "both"', () => {
    // Both keys present but both empty (`tracks:` / `data:` with nothing
    // after them) is the case that separates the `null == unset` rule
    // from a plain key-existence check: by presence it looks like "both",
    // but neither carries a value, so it must read as "neither".
    const result = validateConfig(
      withEntry({ id: 'blank', tracks: null, data: null }),
      freshRegistry()
    );

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('invalid-entry-shape');
    expect(result.issues[0].message).toContain('neither');
    expect(result.issues[0].message).not.toContain('both');
  });

  it('reports one issue per offending entry', () => {
    const result = validateConfig(
      {
        sources: { features: 'https://example.org/features' },
        rows: [
          { id: 'orphan' },
          { id: 'mixed', tracks: [], data: 'features' },
        ],
      } as unknown as ProtvistaViewerConfig,
      freshRegistry()
    );

    const shapeIssues = result.issues.filter(
      (i) => i.code === 'invalid-entry-shape'
    );
    expect(shapeIssues).toHaveLength(2);
    expect(shapeIssues.map((i) => i.path)).toEqual(['/rows/0', '/rows/1']);
  });

  it('leaves a non-object entry to the schema — it is not an ambiguous shape', () => {
    const result = validateConfig(withEntry('not-an-entry'), freshRegistry());

    expect(result.valid).toBe(false);
    expect(issueByCode(result.issues, 'invalid-entry-shape')).toBeUndefined();
    expect(issueByCode(result.issues, 'schema')).toBeDefined();
  });

  it('still reports unrelated structural errors elsewhere in the config', () => {
    // The suppression is scoped to the offending entry: only the Ajv
    // errors *under that entry* are dropped, so a structural problem
    // elsewhere still surfaces on the same pass. (The subsequent
    // semantic pass is skipped whenever any entry is flagged — that is
    // the validator's existing short-circuit contract, not this
    // suppression: a structural failure has always deferred semantic
    // checks to a second run.)
    const result = validateConfig(
      {
        version: 'bogus',
        sources: { features: 'https://example.org/features' },
        rows: [{ id: 'orphan', kind: 'features' }],
      } as unknown as ProtvistaViewerConfig,
      freshRegistry()
    );

    expect(issueByCode(result.issues, 'invalid-entry-shape')).toBeDefined();
    const schemaIssue = issueByCode(result.issues, 'schema');
    expect(schemaIssue).toBeDefined();
    expect(schemaIssue!.path).toBe('/version');
  });

  it('suppresses only the flagged entry, not a similarly-prefixed sibling', () => {
    // Guards the descendant test in `isUnderFlaggedEntry`: a flagged
    // `/rows/1` must not swallow errors under `/rows/10`.
    const rows: unknown[] = Array.from({ length: 11 }, (_, i) => ({
      id: `g${i}`,
      tracks: [{ id: 't', kind: 'features', data: 'features' }],
    }));
    rows[1] = { id: 'orphan' }; // flagged → /rows/1
    rows[10] = { id: 'g10', tracks: [{ id: 't' }] }; // nested error → /rows/10/tracks/0

    const result = validateConfig(
      {
        sources: { features: 'https://example.org/features' },
        rows,
      } as unknown as ProtvistaViewerConfig,
      freshRegistry()
    );

    expect(issueByCode(result.issues, 'invalid-entry-shape')?.path).toBe('/rows/1');
    expect(
      result.issues.some((i) => i.path.startsWith('/rows/10/'))
    ).toBe(true);
  });

  it('leaves valid groups and standalone tracks untouched', () => {
    const result = validateConfig(
      {
        sources: { features: 'https://example.org/features' },
        rows: [
          { id: 'GROUP', tracks: [{ id: 't', kind: 'features', data: 'features' }] },
          { id: 'standalone', kind: 'features', data: 'features' },
        ],
      } as unknown as ProtvistaViewerConfig,
      freshRegistry()
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function issueByCode(
  issues: ValidationIssue[],
  code: ValidationIssue['code']
): ValidationIssue | undefined {
  return issues.find((i) => i.code === code);
}

describe('validateConfig — adapters removed by the shape/format split', () => {
  it.each([
    ['features-csv', 'format: csv'],
    ['linegraph-tsv', 'kind: linegraph with format: tsv'],
    ['variation', 'kind: variants'],
  ])('tells an author what to write instead of %s', (name, replacement) => {
    // A config copied from documentation written before the change should
    // learn the replacement, not be sent to registerAdapter() to reimplement
    // something that is still built in.
    const result = validateConfig(
      {
        accession: 'P05067',
        rows: [
          {
            id: 'X',
            tracks: [
              { id: 'y', kind: 'features', data: { url: './x', adapter: name } },
            ],
          },
        ],
      },
      freshRegistry()
    );
    const issue = result.issues.find((i) => i.code === 'unknown-adapter');
    expect(issue?.message).toContain('Removed:');
    expect(issue?.message).toContain(replacement);
  });
});

// ─────────────────────────────────────────────────────────────
// detailOnly
// ─────────────────────────────────────────────────────────────

describe('validateConfig — detailOnly', () => {
  const allDetailOnlyMessage = (groupId: string) =>
    `Group ${groupId}: every track is marked detailOnly, so the collapsed aggregate has nothing to draw. Un-mark at least one track.`;

  const groupConfig = (
    tracks: TrackConfig[],
    component?: 'nightingale-linegraph-track'
  ): ProtvistaViewerConfig => ({
    sources: { features: 'https://example.org/features' },
    rows: [{ id: 'G', ...(component ? { component } : {}), tracks }],
  });

  const detail = (id: string): TrackConfig => ({
    id,
    kind: 'features',
    data: 'features',
    detailOnly: true,
  });

  it.each([
    ['a multi-track group', [detail('a'), detail('b')], undefined],
    [
      'a multi-track group with an explicit component',
      [detail('a'), detail('b')],
      'nightingale-linegraph-track' as const,
    ],
    ['a single-track group', [detail('a')], undefined],
    [
      'a single-track group with an explicit component',
      [detail('a')],
      'nightingale-linegraph-track' as const,
    ],
  ])('warns when every track of %s is detailOnly', (_, tracks, component) => {
    const result = validateConfig(
      groupConfig(tracks, component),
      freshRegistry()
    );
    const issue = issueByCode(result.issues, 'all-tracks-detail-only');
    expect(issue).toMatchObject({
      path: 'G',
      severity: 'warning',
      message: allDetailOnlyMessage('G'),
    });
    // A warning: the config still loads.
    expect(result.valid).toBe(true);
  });

  it('does not warn when at least one track feeds the aggregate', () => {
    const result = validateConfig(
      groupConfig([
        { id: 'a', kind: 'features', data: 'features' },
        detail('b'),
      ]),
      freshRegistry()
    );
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('warns that detailOnly does nothing on a standalone track', () => {
    const result = validateConfig(
      {
        sources: { features: 'https://example.org/features' },
        rows: [detail('solo')],
      },
      freshRegistry()
    );
    const issue = issueByCode(result.issues, 'detail-only-standalone');
    expect(issue).toMatchObject({
      path: 'solo',
      severity: 'warning',
      message:
        'Track solo: detailOnly has no effect on a standalone track (there is no group aggregate).',
    });
    expect(
      issueByCode(result.issues, 'all-tracks-detail-only')
    ).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it('rejects detailOnly on a group', () => {
    const result = validateConfig(
      {
        sources: { features: 'https://example.org/features' },
        rows: [
          {
            id: 'G',
            detailOnly: true,
            tracks: [{ id: 'a', kind: 'features', data: 'features' }],
          },
        ],
      } as unknown as ProtvistaViewerConfig,
      freshRegistry()
    );
    expect(result.valid).toBe(false);
    expect(issueByCode(result.issues, 'schema')).toBeDefined();
  });

  it('rejects detailOnly under defaults', () => {
    const result = validateConfig(
      {
        ...minimalValid(),
        defaults: { detailOnly: true },
      } as unknown as ProtvistaViewerConfig,
      freshRegistry()
    );
    expect(result.valid).toBe(false);
    expect(issueByCode(result.issues, 'schema')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Template variables — `missing-variable`
//
// Every `{token}` in a data URL must resolve against config
// `variables:`, a host `data-*` attribute, or the named `accession`.
// `data-*` values are runtime state the validator can't see in
// isolation, so the rule is a *warning* (the config still loads) and the
// element passes the names it knows about via `runtimeVariables`.
// ─────────────────────────────────────────────────────────────

describe('validateConfig — missing-variable', () => {
  const MULTI = 'https://api.example.org/{species}/{build}/features/{accession}';

  const withSource = (
    url: string,
    extra: Partial<ProtvistaViewerConfig> = {}
  ): ProtvistaViewerConfig => ({
    accession: 'P05067',
    sources: { features: url },
    rows: [
      {
        id: 'DOMAINS',
        tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
      },
    ],
    ...extra,
  });

  const missing = (issues: ValidationIssue[]) =>
    issues.filter((i) => i.code === 'missing-variable');

  it('warns on a sources URL token defined nowhere, naming source and token', () => {
    const result = validateConfig(
      withSource('https://api.example.org/{species}/features'),
      freshRegistry()
    );
    const [issue, ...rest] = missing(result.issues);
    expect(rest).toEqual([]);
    expect(issue).toEqual({
      path: '/sources/features',
      severity: 'warning',
      code: 'missing-variable',
      message:
        "Source 'features' references undefined variable '{species}'. Define it in top-level 'variables:' or pass it as a data-species attribute at runtime.",
    });
  });

  it('covers a source no track names, such as sequenceEntry', () => {
    const result = validateConfig(
      withSource('https://x.example.org/features/{accession}', {
        sources: {
          features: 'https://x.example.org/features/{accession}',
          sequenceEntry: 'https://x.example.org/{species}/{accession}',
        },
      }),
      freshRegistry()
    );
    expect(missing(result.issues).map((i) => i.path)).toEqual([
      '/sources/sequenceEntry',
    ]);
  });

  it('names the kebab-case attribute for a camelCase token', () => {
    // HTML lowercases attribute names, so `data-datasetId` would reach
    // `dataset` as `datasetid`; only `data-dataset-id` supplies `{datasetId}`.
    const result = validateConfig(
      withSource('https://api.example.org/{datasetId}/features'),
      freshRegistry()
    );
    const [issue] = missing(result.issues);
    expect(issue.message).toBe(
      "Source 'features' references undefined variable '{datasetId}'. Define it in top-level 'variables:' or pass it as a data-dataset-id attribute at runtime."
    );
  });

  it('is a warning: the config stays valid', () => {
    const result = validateConfig(withSource(MULTI), freshRegistry());
    expect(result.valid).toBe(true);
    expect(missing(result.issues).every((i) => i.severity === 'warning')).toBe(
      true
    );
  });

  it('emits one issue per undefined token, in URL order', () => {
    const result = validateConfig(withSource(MULTI), freshRegistry());
    expect(missing(result.issues).map((i) => i.message)).toEqual([
      expect.stringContaining("'{species}'"),
      expect.stringContaining("'{build}'"),
    ]);
  });

  it('reports a repeated token once per source', () => {
    const result = validateConfig(
      withSource('https://e.org/{species}/x/{species}'),
      freshRegistry()
    );
    expect(missing(result.issues)).toHaveLength(1);
  });

  it('accepts tokens defined in top-level variables:', () => {
    const result = validateConfig(
      withSource(MULTI, { variables: { species: 'human', build: 'v2024.12' } }),
      freshRegistry()
    );
    expect(missing(result.issues)).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('never flags {accession} (handled by missing-accession)', () => {
    const result = validateConfig(
      withSource('https://e.org/features/{accession}'),
      freshRegistry()
    );
    expect(missing(result.issues)).toEqual([]);
  });

  it('accepts tokens the caller declares as runtime variables (data-*)', () => {
    const result = validateConfig(withSource(MULTI), freshRegistry(), {
      runtimeVariables: ['species', 'build'],
    });
    expect(missing(result.issues)).toEqual([]);
  });

  it('a runtime variable covers only the names it declares', () => {
    const result = validateConfig(withSource(MULTI), freshRegistry(), {
      runtimeVariables: new Set(['species']),
    });
    expect(missing(result.issues).map((i) => i.message)).toEqual([
      expect.stringContaining("'{build}'"),
    ]);
  });

  it('ignores braces that are not valid tokens', () => {
    const result = validateConfig(
      withSource('https://e.org/{foo-bar}/{1x}/{}'),
      freshRegistry()
    );
    expect(missing(result.issues)).toEqual([]);
  });

  it('does not resolve a token through Object.prototype', () => {
    const result = validateConfig(
      withSource('https://e.org/{constructor}', { variables: {} }),
      freshRegistry()
    );
    expect(missing(result.issues)).toHaveLength(1);
  });

  it('checks an inline descriptor url:, with a track path', () => {
    const cfg: ProtvistaViewerConfig = {
      accession: 'P05067',
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'features',
              data: { url: 'https://e.org/{species}/features' },
            },
          ],
        },
      ],
    };
    const [issue] = missing(validateConfig(cfg, freshRegistry()).issues);
    expect(issue).toMatchObject({
      path: 'X/y',
      severity: 'warning',
      message:
        "Track 'X/y' references undefined variable '{species}'. Define it in top-level 'variables:' or pass it as a data-species attribute at runtime.",
    });
  });

  it('checks every URL of a multi-URL descriptor', () => {
    const cfg: ProtvistaViewerConfig = {
      accession: 'P05067',
      rows: [
        {
          id: 'X',
          tracks: [
            {
              id: 'y',
              kind: 'features',
              data: {
                url: ['https://e.org/{species}', 'https://e.org/{build}'],
                adapter: 'uniprot-features-json',
              },
            },
          ],
        },
      ],
    };
    expect(
      missing(validateConfig(cfg, freshRegistry()).issues).map((i) => i.message)
    ).toEqual([
      expect.stringContaining("'{species}'"),
      expect.stringContaining("'{build}'"),
    ]);
  });

  it('checks a standalone track url: string shorthand', () => {
    const cfg: ProtvistaViewerConfig = {
      accession: 'P05067',
      rows: [
        {
          id: 'solo',
          kind: 'features',
          data: 'https://e.org/{species}/features',
        },
      ],
    };
    const [issue] = missing(validateConfig(cfg, freshRegistry()).issues);
    // Standalone tracks are addressed by their bare id, like every other
    // per-track issue.
    expect(issue).toMatchObject({
      path: 'solo',
      message: expect.stringMatching(/^Track 'solo' references undefined variable '\{species\}'/),
    });
  });

  it('does not double-report a source reached through a track', () => {
    // The source is reported once at its own path; the track that
    // references it by key carries no URL of its own to check.
    const result = validateConfig(
      withSource('https://e.org/{species}'),
      freshRegistry()
    );
    expect(missing(result.issues).map((i) => i.path)).toEqual([
      '/sources/features',
    ]);
  });

  describe('schema', () => {
    it('accepts a variables: map of strings', () => {
      const result = validateConfig(
        { ...minimalValid(), variables: { species: 'human' } },
        freshRegistry()
      );
      expect(result.valid).toBe(true);
    });

    it('rejects a non-string variable value', () => {
      const result = validateConfig(
        {
          ...minimalValid(),
          variables: { build: 2024 },
        } as unknown as ProtvistaViewerConfig,
        freshRegistry()
      );
      expect(result.valid).toBe(false);
      expect(issueByCode(result.issues, 'schema')).toMatchObject({
        path: '/variables/build',
      });
    });

    it('rejects a non-object variables: block', () => {
      const result = validateConfig(
        {
          ...minimalValid(),
          variables: 'species=human',
        } as unknown as ProtvistaViewerConfig,
        freshRegistry()
      );
      expect(result.valid).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Sequence-only mode (`sequence:`)
// ─────────────────────────────────────────────────────────────

describe('validateConfig — sequence mode', () => {
  /** A `sequence:` config around the given rows. */
  const seqConfig = (
    rows: ProtvistaViewerConfig['rows'],
    extra: Partial<ProtvistaViewerConfig> = {}
  ): ProtvistaViewerConfig => ({ sequence: 'MKTAYIAKQR', rows, ...extra });
  const track = (t: Partial<TrackConfig> & { id: string }): TrackConfig =>
    ({ kind: 'features', data: './x.csv', ...t }) as TrackConfig;
  const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);
  const needs = (issues: ValidationIssue[]) =>
    issues.filter((i) => i.code === 'needs-accession');

  it('accepts a sequence config with file and inline tracks', () => {
    const result = validateConfig(
      seqConfig([
        { id: 'g', tracks: [track({ id: 'file' })] },
        track({
          id: 'inline',
          data: { from: 'inline', inlineData: [{ start: 1, end: 3 }] },
        }),
        track({ id: 'custom', data: { from: 'custom' } }),
      ]),
      freshRegistry()
    );
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects accession: beside sequence:', () => {
    const result = validateConfig(
      seqConfig([track({ id: 't' })], { accession: 'P05067' }),
      freshRegistry()
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        path: '/',
        code: 'accession-and-sequence',
        message:
          "This config sets both 'accession:' and 'sequence:'. Use 'accession:' to show a UniProt entry, or 'sequence:' to show your own protein — not both.",
      },
    ]);
  });

  it('parses an inline sequence and names a bad residue', () => {
    const result = validateConfig(
      seqConfig([track({ id: 't' })], { sequence: 'MKT1AY' }),
      freshRegistry()
    );
    expect(result.issues).toEqual([
      {
        path: '/sequence',
        code: 'invalid-sequence',
        message:
          "inline sequence: invalid character '1' at residue 4. A protein sequence uses the one-letter codes A–Z, optionally ending in '*'.",
      },
    ]);
  });

  it('rejects multi-record inline FASTA', () => {
    const result = validateConfig(
      seqConfig([track({ id: 't' })], { sequence: '>a\nMKT\n>b\nMKT\n' }),
      freshRegistry()
    );
    expect(codes(result.issues)).toEqual(['invalid-sequence']);
    expect(result.issues[0].message).toContain('contains 2 records');
  });

  describe('a headed inline FASTA construct', () => {
    /** A 240-residue construct under a header, as a YAML block reads. */
    const CONSTRUCT = [
      '>my construct v2',
      'MQNCSGGMDLWFHSEGPMAGTKSYGQGVWNLECKWRQTQPHEPVKFRFASWGIFVVQCQR',
      'IPTLDVRATYEPSAMMEGFMIPCSDQAIPTVDEVGVTQTNWPTRISDACCRNGNGTSPFC',
      'HPNTNSQAPEQLSSHESVFDLCFNEPAHLWAQGHKCPFWAQTIKTMLGSVTIMKDWEGES',
      'HGIRAGFYNIWFGFNDNKTYYWETSDQQCVKNYEFRRGEWHQCDAEDLAYRHVVCQRILG',
      '',
    ].join('\n');
    const issuesFor = (sequence: string) =>
      validateConfig(seqConfig([track({ id: 't' })], { sequence }), freshRegistry())
        .issues;

    it('names a bad residue in headed inline FASTA, in full', () => {
      expect(issuesFor(CONSTRUCT.replace('MQNCSGG', 'MQNC1SGG'))).toEqual([
        {
          path: '/sequence',
          code: 'invalid-sequence',
          message:
            "inline sequence (parsed as FASTA): invalid character '1' at residue 5. A protein sequence uses the one-letter codes A–Z, optionally ending in '*'.",
        },
      ]);
    });

    it('rejects a second record, in full', () => {
      expect(issuesFor(`${CONSTRUCT}>second\nMKTAYIAKQR\n`)).toEqual([
        {
          path: '/sequence',
          code: 'invalid-sequence',
          message:
            "inline sequence (parsed as FASTA): contains 2 records; the viewer shows one protein. Keep a single '>' record.",
        },
      ]);
    });

    it('reads a bare file name as a missing ./', () => {
      const issues = issuesFor('protein.txt');
      expect(codes(issues)).toEqual(['invalid-sequence']);
      expect(issues[0].message).toContain(
        "'protein.txt' looks like a file path; write it as './protein.txt'."
      );
    });
  });

  it('leaves a file reference to the loader', () => {
    const result = validateConfig(
      seqConfig([track({ id: 't' })], { sequence: './protein.fasta' }),
      freshRegistry()
    );
    expect(result.issues).toEqual([]);
  });

  it('rejects an empty sequence through the schema', () => {
    const result = validateConfig(
      seqConfig([track({ id: 't' })], { sequence: '' }),
      freshRegistry()
    );
    expect(result.valid).toBe(false);
    expect(codes(result.issues)).toEqual(['schema']);
  });

  it('flags a sources key whose URL uses {accession}', () => {
    const result = validateConfig(
      seqConfig([{ id: 'g', tracks: [track({ id: 't', data: 'features' })] }], {
        sources: {
          features: 'https://www.ebi.ac.uk/proteins/api/features/{accession}',
        },
      }),
      freshRegistry()
    );
    expect(result.issues).toEqual([
      {
        path: 'g/t',
        code: 'needs-accession',
        message:
          "Track g/t needs UniProt data: its data URL uses {accession}. With 'sequence:' only file, inline and custom sources work.",
      },
    ]);
  });

  it('flags {accession} in a url: list, a source: list and a shorthand URL', () => {
    const result = validateConfig(
      seqConfig(
        [
          track({
            id: 'urls',
            data: { url: ['https://a.test/x', 'https://a.test/{accession}'] },
          }),
          track({ id: 'sources', data: { source: ['plain', 'keyed'] } }),
          track({ id: 'short', data: 'https://a.test/f/{accession}' }),
        ],
        {
          sources: {
            plain: 'https://a.test/p',
            keyed: 'https://a.test/{accession}',
          },
        }
      ),
      freshRegistry()
    );
    expect(needs(result.issues).map((i) => i.path)).toEqual([
      'urls',
      'sources',
      'short',
    ]);
  });

  it('flags a label that links to an {accession} URL, but not plain label text', () => {
    const result = validateConfig(
      seqConfig([
        {
          id: 'g',
          label: '[Group](https://x.test/{accession})',
          tracks: [
            track({
              id: 'link',
              label: '[AF](https://alphafold.ebi.ac.uk/entry/{accession})',
            }),
            track({ id: 'text', label: 'Hotspots on {accession}' }),
          ],
        },
        track({
          id: 'tag',
          label: '{% help slug="{accession}" %}x{% /help %}',
        }),
      ]),
      freshRegistry()
    );
    expect(needs(result.issues).map((i) => i.path)).toEqual([
      'g',
      'g/link',
      'tag',
    ]);
    expect(needs(result.issues)[1].message).toBe(
      "Track g/link needs UniProt data: its label links to a UniProt-keyed URL ({accession}). With 'sequence:' only file, inline and custom sources work."
    );
  });

  it('flags an explicit UniProt-keyed adapter', () => {
    const result = validateConfig(
      seqConfig([
        track({
          id: 't',
          data: {
            url: 'https://my.test/plddt.json',
            adapter: 'alphafold-prediction-json',
          },
        }),
      ]),
      freshRegistry()
    );
    expect(needs(result.issues).map((i) => i.message)).toEqual([
      "Track t needs UniProt data: adapter 'alphafold-prediction-json' reads AlphaFold DB data for a UniProt entry. With 'sequence:' only file, inline and custom sources work.",
    ]);
  });

  it('reports one issue per track when several reasons apply', () => {
    const result = validateConfig(
      seqConfig(
        [
          track({
            id: 'af',
            kind: 'alphafold-confidence',
            label: '[AF](https://alphafold.ebi.ac.uk/entry/{accession})',
            data: { source: ['alphafoldPrediction', 'proteins'] },
          }),
        ],
        {
          sources: {
            alphafoldPrediction:
              'https://alphafold.ebi.ac.uk/api/prediction/{accession}',
            proteins: 'https://www.ebi.ac.uk/proteins/api/proteins/{accession}',
          },
        }
      ),
      freshRegistry()
    );
    // The first reason wins: the URL rule, ahead of the kind and the label.
    expect(needs(result.issues).map((i) => i.message)).toEqual([
      "Track af needs UniProt data: its data URL uses {accession}. With 'sequence:' only file, inline and custom sources work.",
    ]);
  });

  describe.each([
    ['alphafold-confidence', 'AlphaFold DB'],
    ['alphamissense-pathogenicity', 'AlphaMissense'],
    ['alphamissense-heatmap', 'AlphaMissense'],
  ])('built-in shapeless kind %s', (kind, provider) => {
    const expected = `Track t needs UniProt data: kind '${kind}' reads ${provider} data for a UniProt entry. With 'sequence:' only file, inline and custom sources work.`;

    it.each([
      ['a file', './scores.json'],
      [
        'inline data',
        { from: 'inline', inlineData: [{ position: 1, value: 1 }] },
      ],
      ['a custom source', { from: 'custom' }],
    ])('is flagged on %s', (_label, data) => {
      const result = validateConfig(
        seqConfig([track({ id: 't', kind, data } as TrackConfig)]),
        createRegistry()
      );
      expect(needs(result.issues).map((i) => i.message)).toEqual([expected]);
    });
  });

  it('reports needs-accession beside the existing file mismatch error', () => {
    const result = validateConfig(
      seqConfig([
        track({ id: 't', kind: 'alphafold-confidence', data: './plddt.csv' }),
      ]),
      createRegistry()
    );
    expect(codes(result.issues).sort()).toEqual([
      'kind-format-mismatch',
      'needs-accession',
    ]);
  });

  it('does not flag a consumer-registered shapeless kind', () => {
    const registry = createRegistry();
    registry.registerAdapter('my-feed', () => []);
    registry.registerSemanticKind('my-kind', {
      component: 'nightingale-track-canvas',
      adapter: 'my-feed',
    });
    const result = validateConfig(
      seqConfig([
        track({ id: 't', kind: 'my-kind', data: 'https://lab.test/feed' }),
      ]),
      registry
    );
    expect(needs(result.issues)).toEqual([]);
  });

  it("allows the author's own extensionless URL", () => {
    const result = validateConfig(
      seqConfig([track({ id: 't', data: 'https://lab.example/feed' })]),
      freshRegistry()
    );
    expect(result.issues).toEqual([]);
  });

  it('does not raise missing-accession in sequence mode', () => {
    const result = validateConfig(
      seqConfig([track({ id: 't', label: 'On {accession}' })], {
        sources: { f: 'https://a.test/{accession}' },
      }),
      freshRegistry()
    );
    expect(codes(result.issues)).not.toContain('missing-accession');
  });

  it('flags {accession} in an autolink and in a link target with parentheses', () => {
    const result = validateConfig(
      seqConfig([
        track({
          id: 'auto',
          label: 'AlphaFold <https://alphafold.ebi.ac.uk/entry/{accession}>',
        }),
        track({ id: 'parens', label: '[x](https://a.test/(v2)/{accession})' }),
        track({ id: 'text', label: 'Hotspots on {accession}' }),
      ]),
      freshRegistry()
    );
    expect(needs(result.issues).map((i) => i.path)).toEqual(['auto', 'parens']);
  });

  it('does not match an adapter name against Object.prototype', () => {
    const result = validateConfig(
      seqConfig([
        track({
          id: 't',
          data: {
            from: 'url',
            url: 'https://x.test/y.json',
            adapter: 'constructor',
          },
        } as Partial<TrackConfig> & { id: string }),
      ]),
      freshRegistry()
    );
    expect(needs(result.issues)).toEqual([]);
  });

  describe('UNIPROT_KEYED_ADAPTERS drift guard', () => {
    it('lists every built-in shapeless kind’s adapter', async () => {
      const { UNIPROT_KEYED_ADAPTERS } = await import('../sequence.js');
      const registry = createRegistry();
      const shapeless = registry
        .listSemanticKinds()
        .map((k) => registry.getSemanticKind(k))
        .filter((def) => def && def.shape === undefined && def.adapter);
      expect(shapeless.length).toBeGreaterThan(0);
      for (const def of shapeless) {
        expect(Object.keys(UNIPROT_KEYED_ADAPTERS)).toContain(def!.adapter);
      }
    });

    it('lists every built-in adapter whose module calls fetch', async () => {
      const { UNIPROT_KEYED_ADAPTERS } = await import('../sequence.js');
      const { readFileSync } = await import('node:fs');
      const { resolve, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const dir = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../adapters'
      );
      const index = readFileSync(resolve(dir, 'index.ts'), 'utf8');
      // `import { fooAdapter } from './foo.js'` and `['name', fooAdapter]`.
      const modules = new Map(
        [...index.matchAll(/import \{ (\w+) \} from '\.\/([\w-]+)\.js'/g)].map(
          ([, fn, file]) => [fn, file]
        )
      );
      const entries = [...index.matchAll(/\['([\w-]+)', (\w+)\]/g)];
      expect(entries.length).toBeGreaterThan(0);
      const fetching = entries
        .filter(([, , fn]) => {
          const file = modules.get(fn);
          expect(file, `module for ${fn}`).toBeDefined();
          const src = readFileSync(resolve(dir, `${file}.ts`), 'utf8');
          return /\bfetch\s*\(/.test(src);
        })
        .map(([, name]) => name);
      expect(fetching.length).toBeGreaterThan(0);
      for (const name of fetching) {
        expect(Object.keys(UNIPROT_KEYED_ADAPTERS)).toContain(name);
      }
    });
  });
});
