/**
 * Focused coverage for the `from: custom` / `setTrackData()` escape hatch
 *
 * The loader-level contract, exercised here:
 *
 *   1. When a track's first data descriptor is `from: custom` and the
 *      consumer has supplied data via the `customTrackData` map, that
 *      data is written verbatim into `data[`${group}-${track}`]`
 *      — no adapter step, and the value is also returned so it
 *      participates in the group-level aggregate the renderer reads.
 *
 *   2. The track-level `filter:` sugar still applies to injected data
 *      so behaviour is symmetric with URL- and inline-sourced tracks.
 *
 *   3. The tooltip resolver still runs: an authored `dataTooltip` spec
 *      decorates injected items with `tooltipContent`.
 *
 *   4. When a track declares `from: custom` but no data has been
 *      injected, the loader emits the a console.info message and leaves
 *      the slot unset — nothing under `data[trackKey]`. For a multi-track
 *      (canvas) group the missing track's `undefined` is filtered out of
 *      the flattened aggregate (a clean `[]`); for a graph group
 *      (linegraph / colored-sequence) the `groupData[0]` aggregate stays
 *      `undefined`. Either way the renderer reads it as "no data".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadProtvistaData,
  type AdapterMap,
  type CustomTrackData,
} from '../load-data.js';
import type { TooltipSpec } from '../tooltips/types.js';
import { ACCESSION, makeConfig } from './fixtures.js';

// The `from: custom` branch short-circuits before URL fetch, so fetchOne
// should never be consulted. A spying stub lets tests assert that.
const fetchOne = vi.fn(async (url: string) => ({ url }));

const noopAdapters: AdapterMap = {};
const resolveNoopAdapter = (name: string) => noopAdapters[name];

describe('loadProtvistaData — from: custom / setTrackData()', () => {
  beforeEach(() => {
    fetchOne.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes injected data verbatim to data[`${group}-${track}`] and skips fetch', async () => {
    const injected = [
      { type: 'DOMAIN', description: 'A', start: 1, end: 10 },
      { type: 'DOMAIN', description: 'B', start: 20, end: 30 },
    ];
    const customTrackData: CustomTrackData = { 'GROUP-mine': injected };
    const config = makeConfig({
      id: 'mine',
      label: 'mine',
      component: 'nightingale-track-canvas',
      rendering: {},
      data: [{ from: 'custom' }],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      resolveNoopAdapter,
      customTrackData
    );

    // Track-level slot holds the injected content (by value, not by
    // reference — the resolver returns an annotated copy, so `data[...]`
    // is a new array whose items carry the synthesised `tooltipContent`).
    const track = data['GROUP-mine'] as Array<{
      type: string;
      description: string;
      start: number;
      end: number;
      tooltipContent?: string;
    }>;
    expect(track).toHaveLength(2);
    expect(track[0]).toMatchObject({
      type: 'DOMAIN',
      description: 'A',
      start: 1,
      end: 10,
    });
    expect(track[1]).toMatchObject({
      type: 'DOMAIN',
      description: 'B',
      start: 20,
      end: 30,
    });

    // Purity guarantee: the injected array is not mutated — items stay
    // free of `tooltipContent`, which only appears on the annotated copy.
    expect(injected[0]).not.toHaveProperty('tooltipContent');
    expect(injected[1]).not.toHaveProperty('tooltipContent');

    // Group-level aggregate picks up the track (most components do
    // `.flat()` on the per-track array).
    const aggregate = data.GROUP as Array<{ type: string }>;
    expect(aggregate).toHaveLength(2);
    expect(aggregate.map((a) => a.type)).toEqual(['DOMAIN', 'DOMAIN']);

    // No URL was queued for this track, so no fetch should have fired.
    expect(fetchOne).not.toHaveBeenCalled();
  });

  it('still applies track-level `filter:` sugar to injected data', async () => {
    const injected = [
      { type: 'DOMAIN', description: 'keep' },
      { type: 'REGION', description: 'drop' },
      { type: 'DOMAIN', description: 'keep2' },
    ];
    const customTrackData: CustomTrackData = { 'GROUP-mine': injected };
    const config = makeConfig({
      id: 'mine',
      label: 'mine',
      component: 'nightingale-track-canvas',
      rendering: {},
      filter: 'DOMAIN',
      data: [{ from: 'custom' }],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      resolveNoopAdapter,
      customTrackData
    );

    const track = data['GROUP-mine'] as Array<{ type: string }>;
    expect(track).toHaveLength(2);
    expect(track.map((t) => t.type)).toEqual(['DOMAIN', 'DOMAIN']);
  });

  it('still runs the tooltip resolver on injected data', async () => {
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Desc' }],
    };
    const injected = [{ type: 'DOMAIN', description: 'hello' }];
    const customTrackData: CustomTrackData = { 'GROUP-mine': injected };
    const config = makeConfig({
      id: 'mine',
      label: 'mine',
      component: 'nightingale-track-canvas',
      rendering: {},
      dataTooltip: spec,
      data: [{ from: 'custom' }],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      resolveNoopAdapter,
      customTrackData
    );

    const [item] = data['GROUP-mine'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe('<h5>Desc</h5><p>hello</p>');
  });

  it('emits the spec-mandated console.info when from: custom has no injected data, and leaves the slot unset', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const config = makeConfig({
      id: 'mine',
      label: 'mine',
      component: 'nightingale-track-canvas',
      rendering: {},
      data: [{ from: 'custom' }],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      resolveNoopAdapter,
      {} // no customTrackData
    );

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      `Track GROUP/mine is 'from: custom' but no data was provided via setTrackData().`
    );
    expect('GROUP-mine' in data).toBe(false);
    // Group aggregate is `.flat()` of the per-track return values, with the
    // `undefined` slots a missing/failed track leaves behind filtered out.
    // So a group whose only track produced no data is a clean empty array,
    // not `[undefined]` — no hole reaches the renderer or Nightingale.
    expect(data.GROUP).toEqual([]);
    expect(fetchOne).not.toHaveBeenCalled();
  });

  it('a graph group (linegraph) keeps its aggregate undefined when its only track has no data', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});

    // Graph groups (linegraph / colored-sequence) take `groupData[0]` as the
    // aggregate rather than `.flat().filter()`, so a track that produces no
    // data must leave `data[groupId]` as `undefined` (the renderer reads
    // that as "no data" and shows the error row) — NOT coerced to `[]`.
    const config = makeConfig({
      id: 'mine',
      label: 'mine',
      component: 'nightingale-linegraph-track',
      rendering: {},
      data: [{ from: 'custom' }],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      resolveNoopAdapter,
      {} // no customTrackData → track early-returns undefined
    );

    expect('GROUP-mine' in data).toBe(false);
    expect(data.GROUP).toBeUndefined();
  });

  it('picks up pre-populated customTrackData on the very first load (pre-mount write semantics)', async () => {
    // `setTrackData()` called before `_loadData()` has run simply
    // accretes into the map; the first load sees it. This test models
    // that via direct map population and verifies the loader reads it.
    const injected = [{ type: 'X', description: 'pre' }];
    const customTrackData: CustomTrackData = { 'GROUP-mine': injected };
    const config = makeConfig({
      id: 'mine',
      label: 'mine',
      component: 'nightingale-track-canvas',
      rendering: {},
      data: [{ from: 'custom' }],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      resolveNoopAdapter,
      customTrackData
    );
    const track = data['GROUP-mine'] as Array<{
      type: string;
      description: string;
    }>;
    expect(track).toHaveLength(1);
    expect(track[0]).toMatchObject({ type: 'X', description: 'pre' });
    // Purity: injected input is untouched by the loader.
    expect(injected[0]).not.toHaveProperty('tooltipContent');
  });
});
