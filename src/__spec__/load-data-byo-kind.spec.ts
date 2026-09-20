/**
 * `loadProtvistaData` — bring-your-own-data tracks reached through a
 * semantic `kind` rather than a file extension (`kind: linegraph`).
 *
 * The extension-inferred generic adapters are covered by
 * `load-data-file-source.spec.ts`. This pins the other half of the same
 * invariant, which the adapter's own unit tests cannot see: a viewer whose
 * only track is author-supplied must report `hasData: true`, or
 * `<protvista-uniprot>` blanks to its empty-state panel despite the payload
 * having parsed. The legacy heuristic only recognises the UniProt
 * `{ features: [...] }` raw shape, and a line-graph series carries no such
 * wrapper — so nothing but this gate stands between a correct config and a
 * blank viewer.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../schema/load.js';
import { loadProtvistaData, type AdapterMap } from '../load-data.js';
import { linegraph } from '../schema/adapters/linegraph.js';

import { runPipeline } from '../schema/adapters/pipeline.js';

/**
 * The grid adapters these tests were written against are gone: a source now
 * resolves to a (shape, format) pair and `runPipeline` composes it. The
 * assertions below are unchanged — same parsers, same messages — so they are
 * re-pointed rather than rewritten, with the source name the loader would
 * pass so the error text is what an author actually sees.
 */
const linegraphCsv = (body: unknown) =>
  runPipeline('point', 'csv', body, { source: './depth.csv' });
const linegraphTsv = (body: unknown) =>
  runPipeline('point', 'tsv', body, { source: './depth.tsv' });

const adapters: AdapterMap = {
  linegraph,
  'linegraph-csv': linegraphCsv,
  'linegraph-tsv': linegraphTsv,
};
const resolveAdapter = (name: string) => adapters[name];

const urlTrack = () =>
  loadConfig({
    accession: 'P05067',
    rows: [
      {
        id: 'depth',
        label: 'Read depth',
        kind: 'linegraph',
        data: 'https://example.invalid/api/{accession}/depth',
      },
    ],
  });

describe('loadProtvistaData — kind: linegraph', () => {
  it('lands the adapted series on the track slot and reports hasData', async () => {
    const config = await urlTrack();
    const fetchOne = vi.fn(async () => [
      { position: 1, value: 3 },
      { position: 2, value: 7 },
    ]);

    const result = await loadProtvistaData(
      'P05067',
      config,
      fetchOne,
      resolveAdapter
    );

    // A JSON body, fetched already-parsed: `linegraph` is not a text-body
    // adapter, so the accession-substituted URL is fetched as json.
    expect(fetchOne).toHaveBeenCalledWith(
      'https://example.invalid/api/P05067/depth',
      'json'
    );

    const track = result.data['depth-depth'] as Array<Record<string, unknown>>;
    expect(track).toHaveLength(1);
    expect(track[0]).toMatchObject({
      name: 'value',
      range: [3, 7],
      values: [
        { position: 1, value: 3 },
        { position: 2, value: 7 },
      ],
    });

    expect(result.hasData).toBe(true);
  });

  it('leaves hasData=false for an empty series', async () => {
    const config = await urlTrack();
    const fetchOne = vi.fn(async () => []);
    const result = await loadProtvistaData(
      'P05067',
      config,
      fetchOne,
      resolveAdapter
    );
    expect(result.hasData).toBe(false);
  });

  it.each([
    ['./depth.csv', 'linegraph-csv', 'position,value\n1,412\n2,688\n'],
    ['./depth.tsv', 'linegraph-tsv', 'position\tvalue\n1\t412\n2\t688\n'],
  ])(
    'fetches %s as text and lands the %s series',
    async (url, _adapter, body) => {
      // The delimited variants are only reachable if the loader also asks for
      // a *text* body — a CSV fetched as JSON never reaches the parser.
      const config = await loadConfig({
        accession: 'P05067',
        rows: [{ id: 'depth', label: 'Read depth', kind: 'linegraph', data: url }],
      });
      const fetchOne = vi.fn(async () => body);

      const result = await loadProtvistaData(
        'P05067',
        config,
        fetchOne,
        resolveAdapter
      );

      expect(fetchOne).toHaveBeenCalledWith(url, 'text');
      const track = result.data['depth-depth'] as Array<
        Record<string, unknown>
      >;
      expect(track[0]).toMatchObject({
        name: 'value',
        range: [412, 688],
        values: [
          { position: 1, value: 412 },
          { position: 2, value: 688 },
        ],
      });
      expect(result.hasData).toBe(true);
    }
  );

  it('runs the adapter on from: inline data, not just fetched data', async () => {
    // Inline data normally skips the adapter because it is already written in
    // the component's representation. A kind-selected bring-your-own-data
    // adapter is the exception: `{ position, value }` records are the
    // published contract for `kind: linegraph` whatever the transport, and
    // handing them to the track unadapted draws an empty graph — the track
    // reads `.range`/`.values` off each series and these records have neither.
    const config = await loadConfig({
      accession: 'P05067',
      rows: [
        {
          id: 'depth',
          label: 'Read depth',
          kind: 'linegraph',
          data: {
            from: 'inline',
            inlineData: [
              { position: 1, value: 412 },
              { position: 2, value: 688 },
            ],
          },
        },
      ],
    });
    const fetchOne = vi.fn(async () => {
      throw new Error('inline data must not trigger a fetch');
    });

    const result = await loadProtvistaData(
      'P05067',
      config,
      fetchOne,
      resolveAdapter
    );

    expect(fetchOne).not.toHaveBeenCalled();
    const track = result.data['depth-depth'] as Array<Record<string, unknown>>;
    expect(track).toHaveLength(1);
    expect(track[0]).toMatchObject({
      name: 'value',
      range: [412, 688],
      values: [
        { position: 1, value: 412 },
        { position: 2, value: 688 },
      ],
    });
    expect(result.hasData).toBe(true);
  });

  it('leaves other inline tracks unadapted', async () => {
    // The narrowness matters: `kind: features` inline data is already in the
    // renderer's shape, and running its adapter over it would break it.
    const config = await loadConfig({
      accession: 'P05067',
      rows: [
        {
          id: 'ann',
          label: 'Annotations',
          tracks: [
            {
              id: 'sites',
              label: 'Sites',
              kind: 'features',
              data: {
                from: 'inline',
                inlineData: [{ type: 'BINDING', start: 45, end: 52 }],
              },
            },
          ],
        },
      ],
    });

    const result = await loadProtvistaData(
      'P05067',
      config,
      vi.fn(async () => []),
      resolveAdapter
    );

    expect(result.data['ann-sites']).toMatchObject([
      { type: 'BINDING', start: 45, end: 52 },
    ]);
  });

  it('reports hasData for a .json file path whose format is stated outright', async () => {
    // `format:` is the replacement for what used to need an adapter name
    // here: the extension already implies JSON, so this pins the explicit
    // branch of normalize rather than the inferred one. Same gate.
    const config = await loadConfig({
      rows: [
        {
          id: 'depth',
          label: 'Read depth',
          kind: 'linegraph',
          data: { url: './depth.json', format: 'json' },
        },
      ],
    });
    const fetchOne = vi.fn(async () => [{ position: 1, value: 12 }]);

    const result = await loadProtvistaData(
      'P05067',
      config,
      fetchOne,
      resolveAdapter
    );

    expect(fetchOne).toHaveBeenCalledWith('./depth.json', 'json');
    expect(result.hasData).toBe(true);
  });
});
