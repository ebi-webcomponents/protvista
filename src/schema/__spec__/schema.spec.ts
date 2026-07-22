/**
 * JSON Schema contract tests.
 *
 * Validates the draft-2020-12 schema in `src/schema/schema.json` against
 * a representative cross-section of authored configs and against the
 * rejection cases that the static schema is expected to catch at load
 * time (i.e. anything not requiring registry lookup).
 *
 * Closed-set validation for `kind` / `component` / `adapter` names is out
 * of scope here — those unions are open-string in the JSON Schema so the
 * runtime validator can overlay the registry-aware closed check.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';

// ─────────────────────────────────────────────────────────────
// Schema loader
// ─────────────────────────────────────────────────────────────

// Vitest runs with cwd = project root (where vite/vitest.config lives),
// so resolving relative to cwd is the simplest way to load the schema
// without tying the test to a specific module system (CJS __dirname vs
// ESM import.meta.url).
const schemaPath = resolve(process.cwd(), 'src/schema/schema.json');
const schema: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'));

let validate: ValidateFunction;

beforeAll(() => {
  // `strictRequired: false` is needed because several of our `anyOf` /
  // `if`/`then` branches declare `required: [...]` without restating a
  // `properties: { ... }` block next to it (the properties live on the
  // parent object being constrained). AJV's strict-required check flags
  // that pattern even when the parent clearly declares the properties;
  // we keep the rest of strict mode on.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  });
  validate = ajv.compile(schema);
});

// Small helper — asserts the config validates and surfaces AJV errors
// on failure so a regression doesn't require hand-decoding the output.
function expectValid(config: unknown): void {
  const ok = validate(config);
  if (!ok) {
    console.error(JSON.stringify(validate.errors, null, 2));
  }
  expect(ok).toBe(true);
  expect(validate.errors).toBeNull();
}

function expectInvalid(config: unknown, expectedPathFragment?: RegExp): void {
  const ok = validate(config);
  expect(ok).toBe(false);
  expect(validate.errors).not.toBeNull();
  if (expectedPathFragment) {
    const path = (validate.errors ?? [])
      .map((e) => `${e.instancePath} ${e.keyword} ${e.message ?? ''}`)
      .join(' | ');
    expect(path).toMatch(expectedPathFragment);
  }
}

// ─────────────────────────────────────────────────────────────
// Schema compiles
// ─────────────────────────────────────────────────────────────

describe('JSON Schema — compilation', () => {
  it('compiles cleanly under AJV 2020-12 with strict mode on', () => {
    // beforeAll already compiled it — if that threw, the test would fail
    // here. This explicit assertion documents the expectation.
    expect(validate).toBeTypeOf('function');
  });
});

// ─────────────────────────────────────────────────────────────
// Example acceptance
// ─────────────────────────────────────────────────────────────

describe('JSON Schema — accepts representative authored configs', () => {
  it('Example 1: minimal config with string shorthand + filter', () => {
    expectValid({
      accession: 'P05067',
      sources: {
        features:
          'https://www.ebi.ac.uk/proteins/api/features/{accession}',
      },
      rows: [
        {
          id: 'DOMAINS',
          tracks: [
            {
              id: 'domain',
              kind: 'features',
              filter: 'DOMAIN',
              data: 'features',
              description:
                'Specific combination of secondary structures organized into a characteristic 3D fold',
            },
          ],
        },
      ],
    });
  });

  it('Example 2: inline data, no server', () => {
    expectValid({
      rows: [
        {
          id: 'MY_ANNOTATIONS',
          label: 'My custom annotations',
          tracks: [
            {
              id: 'binding_sites',
              label: 'Predicted binding sites',
              kind: 'features',
              data: {
                from: 'inline',
                inlineData: [
                  {
                    type: 'BINDING',
                    start: 45,
                    end: 52,
                    description: 'ATP binding',
                  },
                  {
                    type: 'BINDING',
                    start: 120,
                    end: 128,
                    description: 'Mg2+ binding',
                  },
                ],
              },
              description: 'Binding sites predicted by my pipeline',
              rendering: { color: '#e74c3c', shape: 'diamond' },
            },
          ],
        },
      ],
    });
  });

  it('Example 3: inheritance, multi-URL adapter, filterUI', () => {
    expectValid({
      defaults: {
        rendering: { color: '#3f51b5' },
      },
      sources: {
        features:
          'https://www.ebi.ac.uk/proteins/api/features/{accession}',
        variation:
          'https://www.ebi.ac.uk/proteins/api/variation/{accession}',
        proteins:
          'https://www.ebi.ac.uk/proteins/api/proteins/{accession}',
        alphafoldPrediction:
          'https://alphafold.ebi.ac.uk/api/prediction/{accession}',
      },
      rows: [
        {
          id: 'ALPHAFOLD_CONFIDENCE',
          label:
            '{% help slug="structure_section#alphafold-structural-models" %}AlphaFold{% /help %}',
          tracks: [
            {
              id: 'alphafold_confidence',
              label:
                '[AlphaFold Confidence](https://alphafold.ebi.ac.uk/entry/{accession})',
              kind: 'confidence-score',
              data: { source: ['alphafoldPrediction', 'proteins'] },
              description: 'AlphaFold prediction confidence',
              dataTooltip:
                '### AlphaFold Confidence\n\n**pLDDT:** `{score}`',
            },
          ],
        },
        {
          id: 'VARIATION',
          label: '{% help slug="variant_viewer" %}Variants{% /help %}',
          tracks: [
            {
              id: 'variation_graph',
              label: 'Counts',
              kind: 'variant-counts',
              data: 'variation',
              description: 'Variant counts per position',
            },
            {
              id: 'variation',
              kind: 'variants',
              filterUI: 'nightingale-filter',
              data: 'variation',
              description:
                'Natural variants including polymorphisms and disease-associated mutations',
            },
          ],
        },
      ],
    });
  });

  it('Example 4: extends one base + one new track', () => {
    // NOTE: this is a schema-shape test — `expectValid` only checks
    // the JSON Schema, it does not resolve `extends:`. The fixture
    // uses a relative file path because that's one of the forms the
    // default loader supports without a custom resolver. The
    // canonical URL / preset name for the shipped default has not
    // been decided yet, so tests deliberately avoid naming one.
    expectValid({
      extends: './base-config.yaml',
      sources: { my_features: 'https://example.org/my-features/{accession}' },
      rows: [
        {
          id: 'MY_LAB',
          label: 'My lab',
          tracks: [
            { id: 'hotspots', kind: 'features', data: 'my_features' },
          ],
        },
      ],
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Targeted acceptance — invariants beyond the five examples
// ─────────────────────────────────────────────────────────────

describe('JSON Schema — fine-grained acceptance', () => {
  it('accepts the supported shapes of the `data` field', () => {
    // Generic-format adapters for bring-your-own-data files (file-path
    // shorthand against CSV / TSV / JSON / BED) is left as future
    // work. Today, the supported shapes are sources-key shorthand,
    // single descriptor (incl. `from: inline`), and array.
    const shapes = [
      { data: 'features' }, // sources-key shorthand
      { data: { from: 'inline', inlineData: [] } }, // single descriptor
      { data: [{ source: 'a' }, { source: 'b' }] }, // array
    ];
    for (const s of shapes) {
      expectValid({
        sources: {
          features: 'https://x/{accession}',
          a: 'https://a',
          b: 'https://b',
        },
        rows: [
          { id: 'C', tracks: [{ id: 't', kind: 'features', ...s }] },
        ],
      });
    }
  });

  it('accepts all three shapes of the `dataTooltip` field', () => {
    const shapes = [
      // 1. Bare string — shorthand for a Markdoc template.
      { dataTooltip: '### {% $name %}' },
      // 2. Fields form — declarative label/value rows.
      {
        dataTooltip: {
          kind: 'fields',
          fields: [
            { path: 'name', label: 'Name' },
            { path: 'description', label: 'Description' },
          ],
        },
      },
      // 3. Template form — explicit Markdoc spec with extra variables.
      {
        dataTooltip: {
          kind: 'markdown',
          template: '### {% $name %}\n\n{% if $score %}**Score:** {% $score %}{% /if %}',
          variables: { siteName: 'my-viewer' },
        },
      },
    ];
    for (const s of shapes) {
      expectValid({
        rows: [
          {
            id: 'C',
            tracks: [
              { id: 't', kind: 'features', data: 'x', ...s },
            ],
          },
        ],
        sources: { x: 'https://x' },
      });
    }
  });

  it('accepts `extends` as both a single string and an array', () => {
    // Schema-shape test: strings are accepted regardless of whether
    // they are URLs, file paths, or (resolver-supplied) preset names.
    // Fixtures use file paths to avoid naming a distribution URL
    // that hasn't been decided.
    expectValid({
      extends: './base-config.yaml',
      rows: [{ id: 'C', tracks: [] }],
    });
    expectValid({
      extends: ['./base-config.yaml', './overlay.yaml'],
      rows: [{ id: 'C', tracks: [] }],
    });
  });

  it('accepts a colorScale with explicit stops only (no theme)', () => {
    expectValid({
      rows: [
        {
          id: 'C',
          tracks: [
            {
              id: 't',
              kind: 'features',
              data: 'x',
              rendering: {
                colorScale: {
                  stops: [
                    { value: 0, color: '#000' },
                    { value: 100, color: '#fff' },
                  ],
                },
              },
            },
          ],
        },
      ],
      sources: { x: 'https://x' },
    });
  });

  it('accepts a Markdoc `label` carrying a help tag and an inline link', () => {
    // `label` is `type: string` in the schema — any Markdoc source
    // (the `{% help %}` tag, inline links, emphasis) is accepted at the
    // schema layer; rendering is exercised in the tooltip resolver tests.
    expectValid({
      rows: [
        {
          id: 'ALPHAFOLD',
          label: '{% help slug="alphafold#models" %}AlphaFold{% /help %}',
          tracks: [
            {
              id: 't',
              label: '[AlphaFold](https://alphafold.ebi.ac.uk/entry/{accession})',
              kind: 'features',
              data: 'x',
            },
          ],
        },
      ],
      sources: { x: 'https://x' },
    });
  });

});

// ─────────────────────────────────────────────────────────────
// Rejection cases — structural errors the static schema must catch
// ─────────────────────────────────────────────────────────────

describe('JSON Schema — rejection cases', () => {
  it('rejects inline data with no inlineData', () => {
    expectInvalid(
      {
        rows: [
          {
            id: 'C',
            tracks: [
              { id: 't', kind: 'features', data: { from: 'inline' } },
            ],
          },
        ],
      },
      /inlineData/
    );
  });

  it('rejects a dataTooltip fields spec with no `fields` array', () => {
    expectInvalid(
      {
        rows: [
          {
            id: 'C',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: 'x',
                dataTooltip: { kind: 'fields' },
              },
            ],
          },
        ],
        sources: { x: 'https://x' },
      },
      /fields|required/
    );
  });

  it('rejects a dataTooltip fields spec with a field missing `path`', () => {
    expectInvalid(
      {
        rows: [
          {
            id: 'C',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: 'x',
                dataTooltip: {
                  kind: 'fields',
                  fields: [{ label: 'Name' }],
                },
              },
            ],
          },
        ],
        sources: { x: 'https://x' },
      },
      /path|required/
    );
  });

  it('rejects a dataTooltip markdown spec with no `template`', () => {
    expectInvalid(
      {
        rows: [
          {
            id: 'C',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: 'x',
                dataTooltip: { kind: 'markdown' },
              },
            ],
          },
        ],
        sources: { x: 'https://x' },
      },
      /template|required/
    );
  });

  it('rejects a dataTooltip object with an unknown `kind`', () => {
    expectInvalid({
      rows: [
        {
          id: 'C',
          tracks: [
            {
              id: 't',
              kind: 'features',
              data: 'x',
              dataTooltip: { kind: 'custom', render: 'not-allowed' },
            },
          ],
        },
      ],
      sources: { x: 'https://x' },
    });
  });

  it('rejects an unsupported version string', () => {
    expectInvalid(
      {
        version: '0.9',
        rows: [{ id: 'C', tracks: [] }],
      },
      /version/
    );
  });

  it('rejects a colorScale with neither theme nor stops', () => {
    expectInvalid(
      {
        rows: [
          {
            id: 'C',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: 'x',
                rendering: { colorScale: {} },
              },
            ],
          },
        ],
        sources: { x: 'https://x' },
      },
      /anyOf|theme|stops/
    );
  });

  it('rejects a track with no `data` field', () => {
    expectInvalid(
      {
        rows: [
          { id: 'C', tracks: [{ id: 't', kind: 'features' }] },
        ],
      },
      /data/
    );
  });

  it('requires `rows`', () => {
    expectInvalid({}, /rows/);
  });

  // `groups:` was the old name for `rows:`; it is removed in v5 (no alias).
  // A leftover `groups:` is now just an unknown property (additionalProperties: false).
  it('rejects the removed `groups:` field', () => {
    expectInvalid({
      sources: { features: 'https://example.org/features' },
      rows: [{ id: 'a', kind: 'features', data: 'features' }],
      groups: [{ id: 'b', kind: 'features', data: 'features' }],
    });
  });

  it('accepts a top-level `theme` of colour strings', () => {
    expectValid({
      rows: [{ id: 't', kind: 'features', data: 'x' }],
      theme: { labelColor: '#e8f5e9', accentColor: 'green' },
    });
  });

  it('rejects an unknown `theme` property', () => {
    expectInvalid({
      rows: [{ id: 't', kind: 'features', data: 'x' }],
      theme: { bogus: 'x' },
    });
  });


  it('rejects typos via additionalProperties: false', () => {
    expectInvalid(
      {
        rows: [
          {
            id: 'C',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: 'x',
                rendering: { colour: 'red' }, // British spelling — not a known property
              },
            ],
          },
        ],
        sources: { x: 'https://x' },
      },
      /additionalProperties|colour/
    );
  });

  it('rejects a FilterUI value other than "nightingale-filter"', () => {
    expectInvalid({
      rows: [
        {
          id: 'C',
          tracks: [
            {
              id: 't',
              kind: 'variants',
              data: 'x',
              filterUI: 'nightingale-filter-widget',
            },
          ],
        },
      ],
      sources: { x: 'https://x' },
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Top-level standalone tracks (discriminated GroupConfig | TrackConfig)
// ─────────────────────────────────────────────────────────────

describe('JSON Schema — top-level standalone tracks', () => {
  it('accepts a single standalone track and zero groups', () => {
    expectValid({
      rows: [{ id: 'signal_peptide', kind: 'features', data: 'features' }],
      sources: { features: 'https://example.org/features' },
    });
  });

  it('accepts a config mixing standalone tracks and groups', () => {
    expectValid({
      rows: [
        { id: 'signal_peptide', kind: 'features', filter: 'SIGNAL', data: 'features' },
        {
          id: 'DOMAINS',
          tracks: [{ id: 'domain', kind: 'features', filter: 'DOMAIN', data: 'features' }],
        },
        { id: 'confidence', kind: 'confidence-score', data: 'features' },
      ],
      sources: { features: 'https://example.org/features' },
    });
  });

  it('rejects an entry that is neither a group nor a track (no `tracks`, no `data`)', () => {
    // Matches neither oneOf branch: GroupConfig requires `tracks`,
    // TrackConfig requires `data`.
    expectInvalid({
      rows: [{ id: 'orphan', kind: 'features' }],
      sources: { features: 'https://x' },
    });
  });

  it('rejects a track-shaped entry that also carries `tracks` (ambiguous)', () => {
    // `tracks` is forbidden on a track entry (TrackConfig has
    // additionalProperties:false), so an entry with both `data` and
    // `tracks` matches neither oneOf branch.
    expectInvalid({
      rows: [
        { id: 'mixed', kind: 'features', data: 'features', tracks: [] },
      ],
      sources: { features: 'https://x' },
    });
  });
});
