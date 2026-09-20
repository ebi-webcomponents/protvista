/**
 * The shape/format vocabulary, before anything resolves through it.
 *
 * Phase 1 of the refactor is additive: kinds now declare a `shape`, sources
 * accept a `format`, and issues carry a `severity`, but resolution still runs
 * through the adapter grid. These tests pin the new declarations against the
 * behaviour they will shortly replace, so the switch-over in phase 2 is a
 * change of mechanism rather than of meaning.
 *
 * The important assertions are the cross-checks: every kind's declared shape
 * must agree with the family table's opinion about what that kind reads, and
 * every shape's `wraps` flag must agree with what its adapter actually does.
 * A phase-2 that starts from a shape table which disagrees with the grid
 * would silently rewire tracks to the wrong records.
 */

import { describe, it, expect } from 'vitest';

import {
  SHAPES,
  SHAPE_NAMES,
  isShapeName,
  shapeLabel,
} from '../shapes.js';
import {
  DATA_FORMATS,
  DATA_FORMAT_NAMES,
  isDataFormat,
  formatForPath,
  DATA_FILE_FORMATS,
  KIND_ADAPTER_VARIANTS,
  WRAPPING_RECORD_ADAPTERS,
  recordAdapterForKind,
} from '../file-formats.js';
import { createRegistry, InvalidSemanticKindError } from '../registry.js';
import { validateConfig } from '../validate.js';
import { isError, type ValidationIssue } from '../errors.js';
import { REQUIRED_COLUMNS, POINT_COLUMNS, VARIATION_COLUMNS } from '../adapters/dsv.js';

const registry = createRegistry();

describe('shapes', () => {
  it('describes each shape in the words its errors will use', () => {
    // `label` is load-bearing: the mismatch diagnostics are built from it, and
    // without it they degrade to naming adapters and body types.
    expect(shapeLabel('feature')).toBe('feature records (type, start, end)');
    expect(shapeLabel('point')).toBe('point records (position, value)');
    expect(shapeLabel('variation')).toBe(
      'variation records (position, variant)'
    );
  });

  it('required fields match the parsers that enforce them', () => {
    // Derived from the shipped code rather than restated: `REQUIRED_COLUMNS`
    // includes `description`, which the record treats as optional, so compare
    // on the required set the shape actually declares.
    expect(SHAPES.feature.requiredFields).toEqual(['type', 'start', 'end']);
    expect([...REQUIRED_COLUMNS]).toEqual([
      ...SHAPES.feature.requiredFields,
      'description',
    ]);
    expect(SHAPES.point.requiredFields).toEqual([...POINT_COLUMNS]);
    expect(SHAPES.variation.requiredFields).toEqual([...VARIATION_COLUMNS]);
  });

  it('`wraps` agrees with what the record adapters actually do', () => {
    // The same fact `WRAPPING_RECORD_ADAPTERS` encodes today, asserted from
    // the other direction so phase 2 can delete that set and keep the rule.
    const wrappingShapes = SHAPE_NAMES.filter((n) => SHAPES[n].wraps).sort();
    expect(wrappingShapes).toEqual(['point', 'variation']);
    expect([...WRAPPING_RECORD_ADAPTERS].sort()).toEqual([
      'linegraph',
      'variation',
    ]);
  });

  it('only the variation shape needs the viewer to supply a sequence', () => {
    const needing = SHAPE_NAMES.filter((n) => SHAPES[n].needsSequence);
    expect(needing).toEqual(['variation']);
  });

  it('recognises its own names and nothing else', () => {
    expect(isShapeName('feature')).toBe(true);
    expect(isShapeName('featuers')).toBe(false);
  });
});

describe('formats', () => {
  it('covers exactly the extensions the resolver recognises', () => {
    const fromFormats = DATA_FORMAT_NAMES.map((n) => DATA_FORMATS[n].ext).sort();
    expect(fromFormats).toEqual(Object.keys(DATA_FILE_FORMATS).sort());
  });

  it('body type agrees with the extension table', () => {
    for (const name of DATA_FORMAT_NAMES) {
      const fmt = DATA_FORMATS[name];
      expect(DATA_FILE_FORMATS[fmt.ext].body, `${name} body`).toBe(fmt.body);
    }
  });

  it('only BED declares the records it can produce', () => {
    // A format normally says nothing about meaning. BED does, because it
    // carries feature semantics (0-based half-open, converted on read) — and
    // it declares that rather than being special-cased, so GFF/VCF slot in
    // the same way later.
    const declaring = DATA_FORMAT_NAMES.filter(
      (n) => DATA_FORMATS[n].emitsShape !== undefined
    );
    expect(declaring).toEqual(['bed']);
    expect(DATA_FORMATS.bed.emitsShape).toBe('feature');
  });

  it('reads a format off a path the way the resolver does', () => {
    expect(formatForPath('./x.csv')?.name).toBe('csv');
    expect(formatForPath('https://h/x.BED?v=2')?.name).toBe('bed');
    expect(formatForPath('https://h/api/x')).toBeUndefined();
  });

  it('recognises its own names and nothing else', () => {
    expect(isDataFormat('tsv')).toBe(true);
    expect(isDataFormat('xlsx')).toBe(false);
  });
});

describe('kinds declare a shape that agrees with the family table', () => {
  it.each(registry.listSemanticKinds())('%s', (kind) => {
    const def = registry.getSemanticKind(kind)!;
    // Every kind must be renderable: a shape, an adapter, or both.
    expect(
      def.shape !== undefined || def.adapter !== undefined,
      `${kind} declares neither`
    ).toBe(true);

    const family = def.adapter ? KIND_ADAPTER_VARIANTS[def.adapter] : undefined;
    if (def.shape === undefined) {
      // No shape means no bring-your-own-data path, which is exactly what
      // having no family means today.
      expect(family, `${kind} has no shape but has a family`).toBeUndefined();
      return;
    }
    if (def.adapter === undefined) return; // shape-only kind: nothing to cross-check

    // The family's members must be the adapters for this shape. Checked via
    // the `.csv` member, which every family declares.
    const csv = family?.['.csv'];
    const expected = {
      feature: 'features-csv',
      point: 'linegraph-csv',
      variation: 'variation-csv',
    }[def.shape];
    expect(csv, `${kind} (shape ${def.shape}) reads the wrong CSV parser`).toBe(
      expected
    );
  });

  it('every kind with a record adapter declares a wrapping shape', () => {
    for (const kind of registry.listSemanticKinds()) {
      const def = registry.getSemanticKind(kind)!;
      const hasRecordAdapter =
        recordAdapterForKind(def.adapter) !== undefined ||
        (def.adapter === undefined && def.shape !== undefined);
      if (!hasRecordAdapter) continue;
      expect(
        def.shape && SHAPES[def.shape].wraps,
        `${kind} has a record adapter but a non-wrapping shape`
      ).toBe(true);
    }
  });
});

describe('registerSemanticKind rejects a kind that can never produce data', () => {
  it('throws when neither shape nor adapter is declared', () => {
    const r = createRegistry();
    expect(() =>
      r.registerSemanticKind('nothing-at-all', {
        component: 'nightingale-track-canvas',
      })
    ).toThrow(InvalidSemanticKindError);
    // The message has to say what to do, since the mistake is in code the
    // author of a config can neither see nor fix.
    expect(() =>
      r.registerSemanticKind('nothing-at-all', {
        component: 'nightingale-track-canvas',
      })
    ).toThrow(/declares neither 'shape' nor 'adapter'/);
  });

  it.each([
    ['shape only', { shape: 'feature' as const }],
    ['adapter only', { adapter: 'uniprot-features-json' }],
    ['both', { shape: 'feature' as const, adapter: 'uniprot-features-json' }],
  ])('accepts a kind declaring %s', (_label, extra) => {
    const r = createRegistry();
    expect(() =>
      r.registerSemanticKind('custom-kind', {
        component: 'nightingale-track-canvas',
        ...extra,
      })
    ).not.toThrow();
  });
});

describe('validation severity', () => {
  const warning: ValidationIssue = {
    path: 'X/y',
    message: 'legal but worth saying',
    code: 'format-overrides-extension',
    severity: 'warning',
  };

  it('treats an issue with no severity as an error, as every existing one is', () => {
    expect(isError({ path: '/', message: 'm', code: 'schema' })).toBe(true);
  });

  it('does not treat a warning as an error', () => {
    expect(isError(warning)).toBe(false);
  });

  it('a config with only warnings is still valid', () => {
    // No warning-emitting check exists yet — phase 2 adds the first. What is
    // pinned here is the contract that makes it possible: `valid` tracks
    // error-severity issues, so a future warning cannot make a good config
    // unloadable.
    const result = validateConfig(
      {
        accession: 'P05067',
        rows: [{ id: 'X', tracks: [{ id: 'y', kind: 'features', data: './a.csv' }] }],
      },
      registry
    );
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect([...result.issues, warning].some(isError)).toBe(false);
  });
});

describe('the format field is accepted by the published schema', () => {
  it.each(['csv', 'tsv', 'json', 'bed'])('accepts format: %s', (format) => {
    const result = validateConfig(
      {
        accession: 'P05067',
        rows: [
          {
            id: 'X',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { url: 'https://lab.test/api/hits', format },
              },
            ],
          },
        ],
      },
      registry
    );
    expect(result.issues.filter((i) => i.code === 'schema')).toEqual([]);
  });

  it('rejects a format outside the enum', () => {
    const result = validateConfig(
      {
        accession: 'P05067',
        rows: [
          {
            id: 'X',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { url: 'https://lab.test/api/hits', format: 'xlsx' },
              },
            ],
          },
        ],
      },
      registry
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'schema')).toBe(true);
  });
});
