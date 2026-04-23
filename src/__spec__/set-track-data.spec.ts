/**
 * Focused coverage for the `from: custom` / `setTrackData()` escape hatch
 * (spec AC #1143).
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
 *      injected, the loader emits the exact console.info message the
 *      spec mandates (spec §Edge Cases) and leaves the slot unset —
 *      nothing under `data[trackKey]`, and the track contributes an
 *      `undefined` to the group aggregate (matching how the URL
 *      branch handles missing data).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadProtvistaData,
  type AdapterMap,
  type CustomTrackData,
} from '../load-data';
import type { NormalizedConfig, NormalizedTrack } from '../schema/normalize';
import type { TooltipSpec } from '../tooltips/types';

const ACCESSION = 'P05067';

// The `from: custom` branch short-circuits before URL fetch, so fetchOne
// should never be consulted. A spying stub lets tests assert that.
const fetchOne = vi.fn(async (url: string) => ({ url }));

function makeConfig(track: NormalizedTrack): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    groups: [
      {
        id: 'CAT',
        label: 'cat',
        component: track.component,
        rendering: {},
        tracks: [track],
      },
    ],
  };
}

const noopAdapters: AdapterMap = {};

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
    const customTrackData: CustomTrackData = { 'CAT-mine': injected };
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
      noopAdapters,
      {},
      customTrackData
    );

    // Track-level slot holds the injected array; identity is preserved
    // at the element level (resolver may add `tooltipContent`, but the
    // array itself isn't re-allocated).
    const track = data['CAT-mine'] as unknown[];
    expect(track).toBe(injected);
    expect(track).toHaveLength(2);

    // Group-level aggregate picks up the track (most components do
    // `.flat()` on the per-track array).
    expect(data.CAT).toEqual(injected);

    // No URL was queued for this track, so no fetch should have fired.
    expect(fetchOne).not.toHaveBeenCalled();
  });

  it('still applies track-level `filter:` sugar to injected data', async () => {
    const injected = [
      { type: 'DOMAIN', description: 'keep' },
      { type: 'REGION', description: 'drop' },
      { type: 'DOMAIN', description: 'keep2' },
    ];
    const customTrackData: CustomTrackData = { 'CAT-mine': injected };
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
      noopAdapters,
      {},
      customTrackData
    );

    const track = data['CAT-mine'] as Array<{ type: string }>;
    expect(track).toHaveLength(2);
    expect(track.map((t) => t.type)).toEqual(['DOMAIN', 'DOMAIN']);
  });

  it('still runs the tooltip resolver on injected data', async () => {
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Desc' }],
    };
    const injected = [{ type: 'DOMAIN', description: 'hello' }];
    const customTrackData: CustomTrackData = { 'CAT-mine': injected };
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
      noopAdapters,
      {},
      customTrackData
    );

    const [item] = data['CAT-mine'] as Array<{ tooltipContent: string }>;
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
      noopAdapters,
      {},
      {} // no customTrackData
    );

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      `Track CAT/mine is 'from: custom' but no data was provided via setTrackData().`
    );
    expect('CAT-mine' in data).toBe(false);
    // Group aggregate is `.flat()` of the per-track return values.
    // The missing-data branch `return`s with no value, so the track
    // contributes `undefined` to the aggregate — matching how the URL
    // branch handles a missing payload (parity with legacy behaviour).
    expect(data.CAT).toEqual([undefined]);
    expect(fetchOne).not.toHaveBeenCalled();
  });

  it('picks up pre-populated customTrackData on the very first load (pre-mount write semantics)', async () => {
    // `setTrackData()` called before `_loadData()` has run simply
    // accretes into the map; the first load sees it. This test models
    // that via direct map population and verifies the loader reads it.
    const injected = [{ type: 'X', description: 'pre' }];
    const customTrackData: CustomTrackData = { 'CAT-mine': injected };
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
      noopAdapters,
      {},
      customTrackData
    );
    expect(data['CAT-mine']).toBe(injected);
  });
});
