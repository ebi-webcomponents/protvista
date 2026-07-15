/**
 * `loadProtvistaData` — bring-your-own-file (`from: file`) loading path.
 *
 * A `data: "./x.csv"` shorthand normalises to `{ from: 'file', url:
 * './x.csv', adapter: 'features-csv' }`. This pins the two things that
 * make it render end-to-end:
 *
 *   • the loader fetches the file's URL with `responseType: 'text'` (so
 *     the delimited body reaches the adapter as raw text, not parsed
 *     JSON), while ordinary API tracks still fetch as `'json'`;
 *   • the adapter's feature records land on the track's data slot.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../schema/load';
import { loadProtvistaData, type AdapterMap } from '../load-data';
import { featuresCsv } from '../schema/adapters/features-csv';

const CSV = 'type,start,end,description\nDOMAIN,10,25,Kinase domain';

const adapters: AdapterMap = { 'features-csv': featuresCsv };

describe('loadProtvistaData — from: file (features-csv)', () => {
  it('fetches the file as text and lands the adapter output on the track slot', async () => {
    const config = await loadConfig({
      groups: [
        {
          id: 'MY',
          tracks: [{ id: 'hits', kind: 'features', data: './features.csv' }],
        },
      ],
    });

    const fetchOne = vi.fn(async () => CSV);

    const result = await loadProtvistaData('P05067', config, fetchOne, adapters);

    // Fetched once, as text, at the declared path.
    expect(fetchOne).toHaveBeenCalledTimes(1);
    expect(fetchOne).toHaveBeenCalledWith('./features.csv', 'text');

    const track = result.data['MY-hits'] as Array<Record<string, unknown>>;
    expect(track).toHaveLength(1);
    expect(track[0]).toMatchObject({
      type: 'DOMAIN',
      start: 10,
      end: 25,
      description: 'Kinase domain',
    });
  });

  it('still fetches an ordinary API track as json', async () => {
    const config = await loadConfig({
      sources: { feats: 'https://example.org/feats' },
      groups: [
        {
          id: 'API',
          tracks: [{ id: 't', kind: 'features', data: 'feats' }],
        },
      ],
    });

    const fetchOne = vi.fn(async () => []);
    await loadProtvistaData('P05067', config, fetchOne, {
      'uniprot-features-json': () => [],
    });

    expect(fetchOne).toHaveBeenCalledWith('https://example.org/feats', 'json');
  });
});
