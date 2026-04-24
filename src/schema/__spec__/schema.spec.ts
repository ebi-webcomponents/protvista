/**
 * JSON Schema contract tests.
 *
 * Validates the draft-2020-12 schema in `src/schema/schema.json` against
 * the canonical examples from `specs/config-approach.md` and against the rejection cases
 * that the static schema is expected to catch at load time (i.e. anything
 * not requiring registry lookup).
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
    // Our FieldPredicate comparators accept `number | string` (Vega-Lite
    // parity — strings are used for temporal predicates, numbers for
    // ordinary comparisons). AJV's strict-types check wants this spelled
    // as a `oneOf` but the JSON Schema spec permits a union type array.
    allowUnionTypes: true,
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
// Spec.md Example acceptance
// ─────────────────────────────────────────────────────────────

describe('JSON Schema — accepts specs/config-approach.md examples', () => {
  it('Example 1: minimal config with string shorthand + filter', () => {
    expectValid({
      accession: 'P05067',
      sources: {
        features:
          'https://www.ebi.ac.uk/proteins/api/features/{accession}',
      },
      groups: [
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
      groups: [
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
        labelUrl: 'https://www.uniprot.org/uniprot/{accession}',
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
      groups: [
        {
          id: 'ALPHAFOLD_CONFIDENCE',
          label: 'AlphaFold',
          helpPage: 'structure_section#alphafold-structural-models',
          tracks: [
            {
              id: 'alphafold_confidence',
              label: 'AlphaFold Confidence',
              labelUrl: 'https://alphafold.ebi.ac.uk/entry/{accession}',
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
          label: 'Variants',
          helpPage: 'variant_viewer',
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

  it('Example 4: Vega-Lite transform pipeline on CSV', () => {
    expectValid({
      groups: [
        {
          id: 'MY_LAB',
          label: 'Lab predictions',
          tracks: [
            {
              id: 'hotspots',
              label: 'High-confidence hotspots',
              kind: 'features',
              data: {
                url: './my-hotspots.csv',
                transform: [
                  { filter: { field: 'score', gte: 0.8 } },
                  {
                    filter: {
                      field: 'hotspot_type',
                      oneOf: ['binding', 'catalytic'],
                    },
                  },
                  {
                    rename: {
                      desc: 'description',
                      pos_start: 'start',
                      pos_end: 'end',
                    },
                  },
                  { calculate: 'datum.end - datum.start', as: 'length' },
                  { limit: 500 },
                ],
              },
              dataTooltip:
                '### {description}\n**Score:** `{score}` — length {length}',
            },
            {
              id: 'custom_score',
              label: 'My score',
              component: 'nightingale-colored-sequence',
              data: {
                from: 'inline',
                inlineData: [0.1, 0.3, 0.4, 0.8, 0.95],
                adapter: 'features-json',
              },
              rendering: { colorScale: { theme: 'alphafold-ramp' } },
            },
          ],
        },
      ],
    });
  });

  it('Example 5: extends one base + one new track', () => {
    expectValid({
      extends: '@ebi/uniprot-default',
      groups: [
        {
          id: 'MY_LAB',
          label: 'My lab',
          tracks: [
            { id: 'hotspots', kind: 'features', data: './hotspots.csv' },
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
  it('accepts all four shapes of the `data` field', () => {
    const shapes = [
      { data: 'features' }, // sources-key shorthand
      { data: './hits.csv' }, // file-path shorthand
      { data: './hits.tsv' }, // TSV sibling (Q1 resolution)
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
        groups: [
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
            { path: 'xrefs', label: 'References', render: 'xrefs' },
          ],
        },
      },
      // 3. Template form — explicit Markdoc spec with extra variables.
      {
        dataTooltip: {
          kind: 'markdown',
          template: '### {% $name %}\n\n{% xrefs xrefs=$xrefs /%}',
          variables: { siteName: 'my-viewer' },
        },
      },
    ];
    for (const s of shapes) {
      expectValid({
        groups: [
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
    expectValid({
      extends: '@ebi/uniprot-default',
      groups: [{ id: 'C', tracks: [] }],
    });
    expectValid({
      extends: ['@ebi/uniprot-default', './overlay.yaml'],
      groups: [{ id: 'C', tracks: [] }],
    });
  });

  it('accepts a colorScale with explicit stops only (no theme)', () => {
    expectValid({
      groups: [
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

  it('accepts every FieldPredicate comparison operator', () => {
    const predicates = [
      { field: 'x', equal: 1 },
      { field: 'x', lt: 1 },
      { field: 'x', lte: 1 },
      { field: 'x', gt: 1 },
      { field: 'x', gte: 1 },
      { field: 'x', oneOf: ['a', 'b'] },
      { field: 'x', range: [0, 1] },
      { field: 'x', valid: true },
    ];
    for (const p of predicates) {
      expectValid({
        groups: [
          {
            id: 'C',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: { url: './x.csv', transform: [{ filter: p }] },
              },
            ],
          },
        ],
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Rejection cases from specs/config-approach.md's Error Handling table
// ─────────────────────────────────────────────────────────────

describe('JSON Schema — rejection cases', () => {
  it('rejects inline data with no inlineData', () => {
    expectInvalid(
      {
        groups: [
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

  it('rejects a FieldPredicate with no comparison operator', () => {
    expectInvalid(
      {
        groups: [
          {
            id: 'C',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: {
                  url: './x.csv',
                  transform: [{ filter: { field: 'score' } }],
                },
              },
            ],
          },
        ],
      },
      /anyOf|required/
    );
  });

  it('rejects a dataTooltip fields spec with no `fields` array', () => {
    expectInvalid(
      {
        groups: [
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
        groups: [
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
        groups: [
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
      groups: [
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
        groups: [{ id: 'C', tracks: [] }],
      },
      /version/
    );
  });

  it('rejects a Transform step with two operation keys', () => {
    expectInvalid({
      groups: [
        {
          id: 'C',
          tracks: [
            {
              id: 't',
              kind: 'features',
              data: {
                url: './x.csv',
                transform: [
                  { filter: 'datum.x > 0', calculate: 'datum.x', as: 'y' },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects a colorScale with neither theme nor stops', () => {
    expectInvalid(
      {
        groups: [
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
        groups: [
          { id: 'C', tracks: [{ id: 't', kind: 'features' }] },
        ],
      },
      /data/
    );
  });

  it('rejects a config with no `groups`', () => {
    expectInvalid({}, /groups/);
  });

  it('rejects typos via additionalProperties: false', () => {
    expectInvalid(
      {
        groups: [
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

  it('rejects a Transform step with an unknown operation key', () => {
    expectInvalid({
      groups: [
        {
          id: 'C',
          tracks: [
            {
              id: 't',
              kind: 'features',
              data: {
                url: './x.csv',
                transform: [{ aggregateBy: { field: 'type' } }],
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects a FilterUI value other than "nightingale-filter"', () => {
    expectInvalid({
      groups: [
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
