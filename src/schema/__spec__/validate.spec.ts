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
  groups: [
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
      groups: [
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
      groups: [
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
  it('rejects a missing `groups` root field', () => {
    const result = validateConfig({}, freshRegistry());
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('schema');
    expect(result.issues[0].message).toContain("'groups'");
  });

  it('rejects an unknown top-level field', () => {
    const result = validateConfig(
      { groups: [], foo: 'bar' },
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [{ id: 'X', tracks: [{ id: 'y', kind: 'my-kind', data: 'features' }] }],
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
      groups: [{ id: 'X', tracks: [{ id: 'y', kind: 'my-kind', data: 'features' }] }],
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
      groups: [
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
      groups: [{ id: 'X', tracks: [{ id: 'y', kind: 'nope', data: 'features' }] }],
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
      groups: [
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
      groups: [
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
      groups: [{ id: 'signal_peptide', kind: 'features', data: 'features' }],
    };
    const result = validateConfig(cfg, freshRegistry());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts a config mixing standalone tracks and groups', () => {
    const cfg: ProtvistaViewerConfig = {
      sources: { features: 'https://example.org/features' },
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
      groups: [
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
// Helpers
// ─────────────────────────────────────────────────────────────

function issueByCode(
  issues: ValidationIssue[],
  code: ValidationIssue['code']
): ValidationIssue | undefined {
  return issues.find((i) => i.code === code);
}
