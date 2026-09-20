/**
 * Contract tests for the `variation` bring-your-own-data family —
 * `variation` (JSON/inline) and its `variation-csv` / `variation-tsv`
 * siblings.
 *
 * Covers the payload shape the `nightingale-variation-canvas` requires, the
 * validation errors an author sees when their file is malformed, and the
 * family wiring that lets `kind: variants` read a file at all.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'lit';

import { variation } from '../variation.js';
import { variationCsv } from '../variation-csv.js';
import { variationTsv } from '../variation-tsv.js';
import { createRegistry } from '../../registry.js';
import { normalizeConfig } from '../../normalize.js';
import { validateConfig } from '../../validate.js';
import { KIND_ADAPTER_VARIANTS } from '../../file-formats.js';
import type { ProtvistaViewerConfig } from '../../types.js';
import '../../../protvista-uniprot.js';

type Payload = { variants: Array<Record<string, unknown>> };

describe('variation adapter', () => {
  it('emits the fields the variation canvas reads, including the ones a file cannot carry', () => {
    const out = variation([
      { position: 42, variant: 'K', wildType: 'E' },
    ]) as Payload;

    expect(out.variants).toHaveLength(1);
    expect(out.variants[0]).toEqual({
      // Synthesised identity: stable across reloads, readable when debugging.
      accession: 'E42K',
      variant: 'K',
      start: 42,
      end: 42,
      wildType: 'E',
      // The canvas reads both without guarding, so a file that has neither
      // still gets them.
      xrefNames: [],
      hasPredictions: false,
      consequenceType: '',
    });
  });

  it('carries the optional descriptive fields through', () => {
    const out = variation([
      {
        position: 7,
        variant: '*',
        description: 'Premature stop in our cohort',
        consequence: 'stop_gained',
      },
    ]) as Payload;

    expect(out.variants[0].description).toBe('Premature stop in our cohort');
    expect(out.variants[0].consequenceType).toBe('stop_gained');
    // No wildType supplied — the identity degrades gracefully rather than
    // printing "undefined".
    expect(out.variants[0].accession).toBe('7*');
  });

  it('omits the protein sequence — the viewer supplies it', () => {
    // The canvas needs `sequence` to render, but an author's file has none.
    // The adapter must not invent one; `_fillVariationSequence` fills it in.
    const out = variation([{ position: 1, variant: 'A' }]) as Record<
      string,
      unknown
    >;
    expect('sequence' in out).toBe(false);
  });

  it('preserves input order and does not sort', () => {
    const out = variation([
      { position: 90, variant: 'A' },
      { position: 12, variant: 'C' },
    ]) as Payload;
    expect(out.variants.map((v) => v.start)).toEqual([90, 12]);
  });

  it('returns an empty payload for an empty array', () => {
    expect(variation([])).toEqual({ variants: [] });
  });

  it('throws for non-array input, naming what it got', () => {
    expect(() => variation({ variants: [] })).toThrow(
      /variation: expected an array of \{ position, variant \} records; got object\./
    );
    expect(() => variation(null)).toThrow(/got null\./);
  });

  it('names the row and the field when one is missing', () => {
    expect(() => variation([{ position: 1, variant: 'A' }, { position: 2 }]))
      .toThrow(/row 1: .*'variant' is missing\./);
    expect(() => variation([{ variant: 'A' }])).toThrow(
      /row 0: .*'position' is missing\./
    );
  });

  it('names the row and the offending type when one is wrong', () => {
    expect(() => variation([{ position: '47', variant: 'K' }])).toThrow(
      /row 0: .*position: '47'.*'position' is a string, not a number\./
    );
    expect(() => variation([{ position: 47, variant: 5 }])).toThrow(
      /row 0: .*'variant' is a number, not a string\./
    );
  });

  it('rejects an empty variant rather than drawing "no change"', () => {
    expect(() => variation([{ position: 47, variant: '' }])).toThrow(
      /'variant' is an empty string\./
    );
  });

  it('rejects a non-finite position', () => {
    expect(() => variation([{ position: NaN, variant: 'K' }])).toThrow(
      /'position' is not a finite number\./
    );
  });

  it('rejects a non-string optional field', () => {
    expect(() =>
      variation([{ position: 1, variant: 'A', description: 3 }])
    ).toThrow(/'description' is a number\./);
  });

  it('reads own properties only, so an inherited field cannot pass validation', () => {
    const row = Object.create({ variant: 'K' }) as Record<string, unknown>;
    row.position = 10;
    expect(() => variation([row])).toThrow(/'variant' is missing\./);
  });
});

describe('variation-csv / variation-tsv', () => {
  const csv = 'position,variant,wildType\n42,K,E\n7,*,Q\n';

  it('produces exactly what the JSON form produces', () => {
    const fromCsv = variationCsv(csv);
    const fromJson = variation([
      { position: 42, variant: 'K', wildType: 'E' },
      { position: 7, variant: '*', wildType: 'Q' },
    ]);
    expect(fromCsv).toEqual(fromJson);
  });

  it('reads the tab-separated form identically', () => {
    expect(variationTsv(csv.replace(/,/g, '\t'))).toEqual(variationCsv(csv));
  });

  it('accepts the optional columns in any order and ignores extras', () => {
    const out = variationCsv(
      'consequence,variant,notes,position\nmissense,K,ignored,42\n'
    ) as Payload;
    expect(out.variants[0]).toMatchObject({
      start: 42,
      variant: 'K',
      consequenceType: 'missense',
    });
    expect(out.variants[0].notes).toBeUndefined();
  });

  it('names the missing column when the header is wrong', () => {
    expect(() => variationCsv('position,value\n1,2\n')).toThrow(
      /variation-csv: missing required header column "variant"\. Header must contain position, variant\./
    );
  });

  it('names the row and column when a cell is wrong', () => {
    expect(() => variationCsv('position,variant\nabc,K\n')).toThrow(
      /variation-csv: row 2, column "position": expected a number, got "abc"\./
    );
    expect(() => variationCsv('position,variant\n42,\n')).toThrow(
      /variation-csv: row 2, column "variant": expected the residue/
    );
  });

  it('treats a non-text body as empty rather than throwing', () => {
    expect(variationCsv({ not: 'text' })).toEqual({ variants: [] });
  });
});

describe('the variation family on the kinds that use it', () => {
  const registry = () => createRegistry();

  const cfg = (data: string): ProtvistaViewerConfig => ({
    accession: 'P05067',
    rows: [
      { id: 'MINE', tracks: [{ id: 'v', kind: 'variants', data }] },
    ],
  });

  it('is wired to both kinds that draw residue changes', () => {
    const r = registry();
    for (const kind of ['variants', 'rna-editing']) {
      const base = r.getSemanticKind(kind)?.adapter as string;
      expect(KIND_ADAPTER_VARIANTS[base], `${kind} has no family`).toEqual({
        '.csv': 'variation-csv',
        '.tsv': 'variation-tsv',
        '.json': 'variation',
      });
    }
  });

  it.each([
    ['./my-variants.csv', 'variation-csv'],
    ['./my-variants.tsv', 'variation-tsv'],
    ['./my-variants.json', 'variation'],
  ])('resolves kind: variants + %s to %s', (data, expected) => {
    const out = normalizeConfig(cfg(data), { registry: registry() });
    expect(out.rows[0].tracks[0].data[0].adapter).toBe(expected);
    // The kind still owns the component — only the parser changed.
    expect(out.rows[0].tracks[0].component).toBe(
      'nightingale-variation-canvas'
    );
  });

  it('validates such a config with no issues', () => {
    const result = validateConfig(cfg('./my-variants.csv'), registry());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('gets the protein sequence from the viewer and mounts on the variation canvas', async () => {
    // The adapter cannot supply `sequence` — it is not in the author's file —
    // and `processVariants` renders nothing without it. The viewer fills it
    // in from the entry it already fetched.
    const n = normalizeConfig(cfg('./my-variants.csv'), { registry: registry() });
    const payload = variationCsv('position,variant\n3,K\n') as Payload;
    const el = document.createElement('protvista-uniprot') as never as Record<
      string,
      unknown
    > & { render: () => unknown; _fillVariationSequence: () => void };
    Object.assign(el, {
      sequence: 'M'.repeat(50),
      hasData: true,
      loading: false,
      suspend: false,
      openGroups: ['MINE'],
      displayCoordinates: { start: 1, end: 50 },
      accession: 'P05067',
      rawData: {},
      config: n,
      data: { MINE: payload, 'MINE-v': payload },
    });

    expect((payload as Record<string, unknown>).sequence).toBeUndefined();
    el._fillVariationSequence();
    expect((payload as Record<string, unknown>).sequence).toBe('M'.repeat(50));

    const target = document.createElement('div');
    render(el.render() as never, target);
    expect(target.querySelector('nightingale-variation-canvas')).not.toBeNull();
  });

  it('leaves a payload that already carries a sequence alone', () => {
    // The UniProt adapters emit their own `{ sequence, variants }`; the
    // viewer must not overwrite it with the entry sequence.
    const el = document.createElement('protvista-uniprot') as never as {
      sequence: string;
      data: Record<string, unknown>;
      _fillVariationSequence: () => void;
    };
    const payload = { sequence: 'ACDEF', variants: [{ start: 1 }] };
    el.sequence = 'M'.repeat(50);
    el.data = { 'V-v': payload };
    el._fillVariationSequence();
    expect(payload.sequence).toBe('ACDEF');
  });

  it('still reads the UniProt API when the track points at one', () => {
    const out = normalizeConfig(
      {
        accession: 'P05067',
        sources: { variation: 'https://www.ebi.ac.uk/proteins/api/variation/{accession}' },
        rows: [
          { id: 'V', tracks: [{ id: 'v', kind: 'variants', data: 'variation' }] },
        ],
      },
      { registry: registry() }
    );
    expect(out.rows[0].tracks[0].data[0].adapter).toBe('uniprot-variation-json');
  });
});
