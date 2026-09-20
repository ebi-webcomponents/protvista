/**
 * The bring-your-own-data path must work without a registered adapter.
 *
 * This spec used to pin four adapters (`features-csv`, `features-tsv`,
 * `features-json`, `bed`) into `BUILTIN_ADAPTERS`, because the loader
 * resolved every source through `registry.getAdapter`. None of those names
 * exist any more: a track's `kind` declares the records, the source declares
 * the format, and the pair is composed.
 *
 * So the wiring to pin is the opposite of what it was — that a file-backed
 * track loads end to end while the adapter registry is never consulted. The
 * resolver below throws if it is called, which is the whole assertion: a
 * regression that reintroduced a name lookup for these sources would fail
 * here rather than in a docs page nobody runs.
 */

import { describe, it, expect } from 'vitest';

import { loadProtvistaData } from '../load-data.js';
import { createRegistry } from '../schema/registry.js';
import { normalizeConfig } from '../schema/normalize.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';

const registry = createRegistry();

/** Fails the test if the loader tries to resolve an adapter by name. */
const noAdapters = (name: string) => {
  throw new Error(
    `the loader asked for adapter '${name}'; bring-your-own-data sources ` +
      `must resolve from (shape, format) instead`
  );
};

const BODIES: Record<string, string> = {
  './hits.csv': 'type,start,end,description\nDOMAIN,18,289,Extracellular\n',
  './hits.tsv': 'type\tstart\tend\tdescription\nDOMAIN\t18\t289\tExtracellular\n',
  './hits.json':
    '[{"type":"DOMAIN","start":18,"end":289,"description":"Extracellular"}]',
  './hits.bed': 'chr1\t17\t289\tDOMAIN\n',
};

const cfg = (data: string): ProtvistaViewerConfig => ({
  accession: 'P05067',
  rows: [{ id: 'G', tracks: [{ id: 't', kind: 'features', data }] }],
});

describe('a file-backed track loads without any registered adapter', () => {
  it.each(Object.keys(BODIES))('%s', async (path) => {
    const { data } = await loadProtvistaData(
      'P05067',
      normalizeConfig(cfg(path), { registry }),
      async (url, responseType) => {
        const body = BODIES[url];
        return responseType === 'json' ? JSON.parse(body) : body;
      },
      noAdapters,
      {}
    );
    const records = data['G-t'] as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    // Coordinates are the invariant across formats. BED carries no type
    // column, so its decoder synthesises one and puts the name in
    // `description` — part of reading that format, not of the shape.
    expect(records[0]).toMatchObject({ start: 18, end: 289 });
    expect(records[0].type).toBe(path.endsWith('.bed') ? 'BED' : 'DOMAIN');
  });

  it('still resolves a named adapter when the author pins one', () => {
    // The escape hatch is unaffected: `adapter:` names a transform, and that
    // path does go through the registry.
    const out = normalizeConfig(
      {
        accession: 'P05067',
        rows: [
          {
            id: 'G',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: { from: 'file', url: './hits.csv', adapter: 'my-parser' },
              },
            ],
          },
        ],
      },
      { registry }
    );
    const source = out.rows[0].tracks[0].data[0];
    expect(source.adapter).toBe('my-parser');
    expect(source.format).toBeUndefined();
  });
});
