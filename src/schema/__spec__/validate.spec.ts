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
import { validateConfig } from '../validate';
import { createRegistry } from '../registry';
import type { ProtvistaViewerConfig } from '../types';
import type { ValidationIssue } from '../errors';

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
  it('rejects a config carrying neither `rows` nor `groups`', () => {
    const result = validateConfig({}, freshRegistry());
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('schema');
    // The root `oneOf` requires exactly one of the two spellings, so a
    // config with neither fails both branches. `rows` is the canonical
    // one and the only one an author should be reaching for.
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
              kind: 'confidence-score',
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

  it('treats an empty `tracks:` stub as unset, not as a group', () => {
    // `tracks:` with nothing after it parses to null. Consistent with
    // `rows-alias.ts`, that is a leftover stub rather than a value — so
    // the entry reads as "neither", not as an empty group.
    const result = validateConfig(withEntry({ id: 'stub', tracks: null }), freshRegistry());

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('invalid-entry-shape');
    expect(result.issues[0].message).toContain('neither');
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
    // The suppression is scoped to the offending entry. A malformed
    // entry must not hide a problem the author would otherwise have to
    // discover on a second pass.
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
