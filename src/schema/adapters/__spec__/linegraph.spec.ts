import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import { linegraph } from '../linegraph.js';
import { createRegistry } from '../../registry.js';
import { normalizeConfig } from '../../normalize.js';
import { validateConfig } from '../../validate.js';
import '../../../protvista-uniprot.js';

describe('linegraph adapter', () => {
  it('wraps an array of { position, value } records into a single series with range spanning zero', () => {
    expect(
      linegraph([
        { position: 1, value: 2 },
        { position: 2, value: 5 },
        { position: 3, value: 0 },
      ])
    ).toEqual([
      {
        name: 'value',
        range: [0, 5],
        values: [
          { position: 1, value: 2 },
          { position: 2, value: 5 },
          { position: 3, value: 0 },
        ],
      },
    ]);
  });

  it('drops extra keys from records', () => {
    expect(linegraph([{ position: 10, value: 1.5, label: 'x' }])).toEqual([
      {
        name: 'value',
        range: [0, 1.5],
        values: [{ position: 10, value: 1.5 }],
      },
    ]);
  });

  it('handles negative values with range spanning zero and preserves input order', () => {
    expect(
      linegraph([
        { position: 1, value: -2 },
        { position: 2, value: -1 },
      ])
    ).toEqual([
      {
        name: 'value',
        range: [-2, 0],
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
      '[linegraph] expected an array of { position, value } records; got object.'
    );
    expect(() => linegraph('1,2' as any)).toThrow(
      '[linegraph] expected an array of { position, value } records; got string.'
    );
    expect(() => linegraph(null as any)).toThrow(
      '[linegraph] expected an array of { position, value } records; got null.'
    );
    expect(() => linegraph(undefined as any)).toThrow(
      '[linegraph] expected an array of { position, value } records; got undefined.'
    );
  });

  it('throws when a required field is missing', () => {
    expect(() =>
      linegraph([{ position: 1, value: 2 }, { position: 2 } as any])
    ).toThrow(
      "[linegraph] row 1: expected 'position' and 'value' (both numbers); got { position: 2 } — 'value' is missing."
    );
  });

  it('throws when a field is the wrong type', () => {
    expect(() => linegraph([{ position: '47' as any, value: 0.9 }])).toThrow(
      "[linegraph] row 0: expected 'position' and 'value' (both numbers); got { position: '47', value: 0.9 } — 'position' is a string, not a number."
    );
  });

  it('throws when a field is null', () => {
    expect(() => linegraph([{ position: 3, value: null as any }])).toThrow(
      "[linegraph] row 0: expected 'position' and 'value' (both numbers); got { position: 3, value: null } — 'value' is null, not a number."
    );
  });

  it('throws when a field is non-finite', () => {
    expect(() => linegraph([{ position: 3, value: NaN }])).toThrow(
      "[linegraph] row 0: expected 'position' and 'value' (both numbers); got { position: 3, value: NaN } — 'value' is not a finite number."
    );
  });

  it('throws when a row is not an object', () => {
    expect(() => linegraph([{ position: 1, value: 1 }, 42 as any])).toThrow(
      "[linegraph] row 1: expected 'position' and 'value' (both numbers); got 42 — row is a number, not an object."
    );
    expect(() => linegraph([null as any])).toThrow(
      "[linegraph] row 0: expected 'position' and 'value' (both numbers); got null — row is null, not an object."
    );
    expect(() => linegraph([[1, 2] as any])).toThrow(
      "[linegraph] row 0: expected 'position' and 'value' (both numbers); got [array] — row is an array, not an object."
    );
  });

  it('throws when a row is an empty object', () => {
    expect(() => linegraph([{} as any])).toThrow(
      "[linegraph] row 0: expected 'position' and 'value' (both numbers); got {} — 'position' is missing."
    );
  });
});

describe('linegraph kind registration', () => {
  const r = createRegistry();

  it('resolves semantic kind linegraph to nightingale-linegraph-track and linegraph adapter', () => {
    expect(r.getSemanticKind('linegraph')).toEqual({
      component: 'nightingale-linegraph-track',
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

  it('normalizes a config using kind: linegraph into nightingale-linegraph-track with adapter linegraph', () => {
    const n = normalizeConfig(config as any, { registry });
    expect(n.rows[0].tracks[0].component).toBe('nightingale-linegraph-track');
    expect(n.rows[0].tracks[0].data[0]).toEqual({
      from: 'url',
      url: 'https://example.invalid/api/{accession}/depth',
      adapter: 'linegraph',
    });
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
