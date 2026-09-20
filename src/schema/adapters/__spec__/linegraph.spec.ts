import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import { linegraph, LINE_COLOR } from '../linegraph.js';
import { createRegistry } from '../../registry.js';
import { normalizeConfig } from '../../normalize.js';
import { validateConfig } from '../../validate.js';
import '../../../protvista-uniprot.js';

describe('linegraph adapter', () => {
  it('wraps an array of { position, value } records into a single series fitted to the data', () => {
    expect(
      linegraph([
        { position: 1, value: 2 },
        { position: 2, value: 5 },
        { position: 3, value: 0 },
      ])
    ).toEqual([
      {
        name: 'value',
        color: LINE_COLOR,
        range: [0, 5],
        values: [
          { position: 1, value: 2 },
          { position: 2, value: 5 },
          { position: 3, value: 0 },
        ],
      },
    ]);
  });

  // A constant series has no extent of its own; the adapter pads it so d3's
  // zero-width domain does not pin the line to the track floor.
  it('drops extra keys from records, padding the single-value range', () => {
    expect(linegraph([{ position: 10, value: 1.5, label: 'x' }])).toEqual([
      {
        name: 'value',
        color: LINE_COLOR,
        range: [0, 3],
        values: [{ position: 10, value: 1.5 }],
      },
    ]);
  });

  it('handles negative values and preserves input order', () => {
    expect(
      linegraph([
        { position: 1, value: -2 },
        { position: 2, value: -1 },
      ])
    ).toEqual([
      {
        name: 'value',
        color: LINE_COLOR,
        range: [-2, -1],
        values: [
          { position: 1, value: -2 },
          { position: 2, value: -1 },
        ],
      },
    ]);
  });

  it('returns empty array when input is empty', () => {
    expect(linegraph([])).toEqual([]);
  });

  it('throws for non-array inputs', () => {
    expect(() => linegraph({ position: 1, value: 2 } as any)).toThrow(
      'linegraph: expected an array of { position, value } records; got object.'
    );
    expect(() => linegraph('1,2' as any)).toThrow(
      'linegraph: expected an array of { position, value } records; got string.'
    );
    expect(() => linegraph(null as any)).toThrow(
      'linegraph: expected an array of { position, value } records; got null.'
    );
    expect(() => linegraph(undefined as any)).toThrow(
      'linegraph: expected an array of { position, value } records; got undefined.'
    );
  });

  it('throws when a required field is missing', () => {
    expect(() =>
      linegraph([{ position: 1, value: 2 }, { position: 2 } as any])
    ).toThrow(
      "linegraph: row 1: expected 'position' and 'value' (both numbers); got { position: 2 } — 'value' is missing."
    );
  });

  it('throws when a field is the wrong type', () => {
    expect(() => linegraph([{ position: '47' as any, value: 0.9 }])).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got { position: '47', value: 0.9 } — 'position' is a string, not a number."
    );
  });

  it('throws when a field is null', () => {
    expect(() => linegraph([{ position: 3, value: null as any }])).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got { position: 3, value: null } — 'value' is null, not a number."
    );
  });

  it('throws when a field is non-finite', () => {
    expect(() => linegraph([{ position: 3, value: NaN }])).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got { position: 3, value: NaN } — 'value' is not a finite number."
    );
  });

  it('throws when a row is not an object', () => {
    expect(() => linegraph([{ position: 1, value: 1 }, 42 as any])).toThrow(
      "linegraph: row 1: expected 'position' and 'value' (both numbers); got 42 — row is a number, not an object."
    );
    expect(() => linegraph([null as any])).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got null — row is null, not an object."
    );
    expect(() => linegraph([[1, 2] as any])).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got [array] — row is an array, not an object."
    );
  });

  it('throws for a non-finite value other than NaN', () => {
    expect(() => linegraph([{ position: 1, value: Infinity }])).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got { position: 1, value: Infinity } — 'value' is not a finite number."
    );
  });

  it('ignores inherited fields — validation reads own properties only', () => {
    // Otherwise a prototype-borne `position`/`value` would pass validation
    // while the error rendering (built from `Object.keys`) printed `{}`.
    expect(() =>
      linegraph([Object.create({ position: 1, value: 2 }) as never])
    ).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got {} — 'position' is missing."
    );
  });

  it('preserves input order for out-of-order positions (it does not sort)', () => {
    expect(
      linegraph([
        { position: 2, value: 1 },
        { position: 1, value: 5 },
      ])
    ).toEqual([
      {
        name: 'value',
        color: LINE_COLOR,
        range: [1, 5],
        values: [
          { position: 2, value: 1 },
          { position: 1, value: 5 },
        ],
      },
    ]);
  });

  it('throws when a row is an empty object', () => {
    expect(() => linegraph([{} as any])).toThrow(
      "linegraph: row 0: expected 'position' and 'value' (both numbers); got {} — 'position' is missing."
    );
  });
});

describe('linegraph kind registration', () => {
  const r = createRegistry();

  it('resolves semantic kind linegraph to nightingale-linegraph-track and linegraph adapter', () => {
    expect(r.getSemanticKind('linegraph')).toEqual({
      component: 'nightingale-linegraph-track',
      // `shape` is what lets an author bring point records to this kind by
      // file, inline, or setTrackData; `adapter` is the transform for its
      // JSON form. See "Shape and format" in specs/config-approach.md.
      shape: 'point',
      adapter: 'linegraph',
    });
  });

  it('retrieves the linegraph adapter function from registry', () => {
    expect(r.getAdapter('linegraph')).toBe(linegraph);
  });

  it('lists linegraph in semantic kinds and preserves existing variant-counts registration', () => {
    expect(r.listSemanticKinds()).toContain('linegraph');
    expect(r.getSemanticKind('variant-counts')).toEqual({
      component: 'nightingale-linegraph-track',
      shape: 'point',
      adapter: 'uniprot-variation-counts-json',
    });
  });
});

describe('kind: linegraph end to end', () => {
  const config = {
    accession: 'P05067',
    rows: [
      {
        id: 'depth',
        label: 'Read depth',
        kind: 'linegraph',
        data: 'https://example.invalid/api/{accession}/depth',
      },
    ],
  };
  const registry = createRegistry();

  it('validates a config using kind: linegraph', () => {
    expect(validateConfig(config, registry).valid).toBe(true);
  });

  it('normalizes a config using kind: linegraph into nightingale-linegraph-track', () => {
    const n = normalizeConfig(config as any, { registry });
    expect(n.rows[0].tracks[0].component).toBe('nightingale-linegraph-track');
    expect(n.rows[0].tracks[0].data[0]).toEqual({
      from: 'url',
      url: 'https://example.invalid/api/{accession}/depth',
      // The URL declares no format, so the kind's own adapter reads it —
      // `linegraph` is bring-your-own-data by nature and has no provider
      // feed to fall back to. `shape` rides along so the loader knows these
      // records need wrapping for the component.
      shape: 'point',
      adapter: 'linegraph',
    });
  });

  // The kind fixes the records (`point`); the path's extension only says how
  // they are encoded. Extension inference alone would read `./depth.json` as
  // generic features, which throws on `{ position, value }` rows — and the
  // loader swallows that as a warning, so the track would silently empty.
  it.each([
    ['./depth.json', 'json'],
    ['https://example.invalid/api/depth.json', 'json'],
    // A hosted file resolves exactly as the local one does.
    ['/data/depth.csv', 'csv'],
    ['./depth.tsv', 'tsv'],
    ['https://example.invalid/api/depth.csv?v=2', 'csv'],
  ])('reads %s as point records encoded in %s', (url, format) => {
    const n = normalizeConfig(
      { ...config, rows: [{ ...config.rows[0], data: url }] } as any,
      { registry }
    );
    const source = n.rows[0].tracks[0].data[0];
    expect(source.shape).toBe('point');
    expect(source.format).toBe(format);
    expect(source.adapter).toBeUndefined();
  });

  it('rejects a BED file, which cannot carry point records', () => {
    // BED encodes feature semantics in the format itself, so it is the one
    // format that constrains what it can produce. Previously this resolved
    // to the `linegraph` adapter and fed BED text to a JSON reader.
    const cfg = {
      ...config,
      rows: [{ ...config.rows[0], data: './depth.bed' }],
    } as any;
    const issue = validateConfig(cfg, registry).issues.find(
      (i) => i.code === 'kind-format-mismatch'
    );
    expect(issue).toBeDefined();
  });

  it('still lets an explicit adapter: override the kind', () => {
    const n = normalizeConfig(
      {
        ...config,
        rows: [
          {
            ...config.rows[0],
            data: { url: './depth.json', adapter: 'features-json' },
          },
        ],
      } as any,
      { registry }
    );
    expect(n.rows[0].tracks[0].data[0].adapter).toBe('features-json');
  });

  it('mounts kind: linegraph data into nightingale-linegraph-track element in the DOM', () => {
    const n = normalizeConfig(config as any, { registry });
    const series = linegraph([
      { position: 1, value: 3 },
      { position: 2, value: 7 },
    ]);
    const el = document.createElement('protvista-uniprot') as any;
    el.sequence = 'M'.repeat(50);
    el.hasData = true;
    el.loading = false;
    el.suspend = false;
    el.openGroups = ['depth'];
    el.displayCoordinates = { start: 1, end: 50 };
    el.accession = 'P05067';
    el.rawData = {};
    el.config = n;
    el.data = { depth: series, 'depth-depth': series };
    const target = document.createElement('div');
    render(el.render(), target);
    expect(target.querySelector('nightingale-linegraph-track')).not.toBeNull();
    expect(target.querySelector('nightingale-track-canvas')).toBeNull();
  });
});
