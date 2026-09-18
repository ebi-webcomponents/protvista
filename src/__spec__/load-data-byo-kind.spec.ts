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

const adapters: AdapterMap = { linegraph };
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
      range: [0, 7],
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

  it('reports hasData for a .json file path that names the adapter explicitly', async () => {
    // The documented escape hatch: a `.json` extension would otherwise infer
    // `features-json`, so the adapter has to be named. Different normalize
    // branch (explicit `adapter:` over inferred), same gate.
    const config = await loadConfig({
      rows: [
        {
          id: 'depth',
          label: 'Read depth',
          kind: 'linegraph',
          data: { url: './depth.json', adapter: 'linegraph' },
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
