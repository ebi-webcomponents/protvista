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
import { createRegistry } from '../schema/registry';
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

    // A CSV/TSV-only viewer must report hasData=true, or the element blanks
    // to its empty-state panel despite features having parsed. The legacy
    // heuristic only sees the UniProt `.features` raw shape; this pins the
    // additive text-body path.
    expect(result.hasData).toBe(true);
  });

  it('leaves hasData=false for a header-only (empty) CSV file', async () => {
    const config = await loadConfig({
      groups: [
        {
          id: 'MY',
          tracks: [{ id: 'hits', kind: 'features', data: './empty.csv' }],
        },
      ],
    });
    const fetchOne = vi.fn(async () => 'type,start,end,description');
    const result = await loadProtvistaData('P05067', config, fetchOne, adapters);
    expect(result.hasData).toBe(false);
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

  it('keys body type on the adapter, not the URL extension (explicit json adapter on a .csv URL → json)', async () => {
    const registry = createRegistry();
    registry.registerAdapter('my-json', () => []);
    const config = await loadConfig(
      {
        groups: [
          {
            id: 'API',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: { from: 'url', url: 'https://h/x.csv', adapter: 'my-json' },
              },
            ],
          },
        ],
      },
      { registry }
    );

    const fetchOne = vi.fn(async () => []);
    await loadProtvistaData('P05067', config, fetchOne, { 'my-json': () => [] });

    // URL ends in .csv, but the explicit adapter is not a text-body adapter,
    // so the body must still be fetched as JSON (regression-safety for
    // alphamissense-*-csv-style tracks that fetch JSON from .csv URLs).
    expect(fetchOne).toHaveBeenCalledWith('https://h/x.csv', 'json');
  });

  it.each([
    ['features-csv', 'my-json'],
    ['my-json', 'features-csv'],
  ])(
    'fetches a URL shared by a text-body and a json track once, as text (%s then %s)',
    async (firstAdapter, secondAdapter) => {
      const registry = createRegistry();
      registry.registerAdapter('my-json', () => []);
      const tracks = [firstAdapter, secondAdapter].map((adapter, i) => ({
        id: `t${i}`,
        kind: 'features',
        data: { from: 'url', url: './shared.csv', adapter },
      }));
      const config = await loadConfig(
        { groups: [{ id: 'G', tracks }] },
        { registry }
      );

      const fetchOne = vi.fn(async () => CSV);
      await loadProtvistaData('P05067', config, fetchOne, {
        'features-csv': featuresCsv,
        'my-json': () => [],
      });

      // Deduped to a single fetch; text wins regardless of declaration order
      // (a delimited body would fail a JSON parse, so text is the safe choice).
      expect(fetchOne).toHaveBeenCalledTimes(1);
      expect(fetchOne).toHaveBeenCalledWith('./shared.csv', 'text');
    }
  );
});
