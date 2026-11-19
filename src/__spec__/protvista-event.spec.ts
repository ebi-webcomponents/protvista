/**
 * The public `protvista-event`, as the Events page
 * (`docs/src/content/docs/events.md`) documents it: it fires each time
 * `hasData` goes from `false` to `true`, from a full load or a targeted
 * retry, with `{ hasData: true }` as its detail, and not on every load that
 * has data.
 *
 * Drives `_loadData()` on a detached element with a stubbed fetch, as
 * `error-surface.spec.ts` does, so each load's data is under the test's
 * control.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Registers <protvista-uniprot>; nightingale packages are stubbed globally
// via `src/__spec__/nightingale-mocks.ts` (setupFiles).
import '../protvista-uniprot.js';
import type { NormalizedConfig } from '../schema/normalize.js';

type El = HTMLElement & {
  config?: NormalizedConfig;
  accession?: string;
  sequence?: string;
  data: Record<string, unknown>;
  customTrackData: Record<string, unknown>;
  loading: boolean;
  hasData: boolean;
  openGroups: string[];
  _loadData(only?: Set<string>): Promise<void>;
};

/** One row `g` with one URL feature track `a`: its retry key is `g-a`. */
const CONFIG: NormalizedConfig = {
  version: '1.0',
  sources: {},
  defaults: { rendering: {} },
  rows: [
    {
      id: 'g',
      label: 'G',
      component: 'nightingale-track-canvas',
      rendering: {},
      tracks: [
        {
          id: 'a',
          label: 'a',
          kind: 'features',
          component: 'nightingale-track-canvas',
          rendering: {},
          data: [
            {
              from: 'url',
              url: 'https://example.org/a.json',
              adapter: 'uniprot-features-json',
            },
          ],
        },
      ],
    },
  ],
};

/** What the next fetch of the track returns: features, or a 404. */
let serve: 'data' | 'missing';

beforeEach(() => {
  serve = 'data';
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        (serve === 'data'
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                features: [{ type: 'DOMAIN', begin: '1', end: '5' }],
              }),
            }
          : {
              ok: false,
              status: 404,
              json: async () => ({}),
            }) as unknown as Response
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A detached viewer with nothing loaded yet, and the events it fires. */
function viewer(): { el: El; events: CustomEvent[] } {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  Object.assign(el, {
    config: CONFIG,
    accession: 'P05067',
    sequence: 'MSEQENCE',
    data: {},
    customTrackData: {},
    loading: false,
    hasData: false,
    openGroups: [],
  });
  const events: CustomEvent[] = [];
  el.addEventListener('protvista-event', (e) => events.push(e as CustomEvent));
  return { el, events };
}

describe('protvista-event', () => {
  it('fires once, with { hasData: true }, when the first load has data', async () => {
    const { el, events } = viewer();

    await el._loadData();

    expect(el.hasData).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ hasData: true });
    expect(events[0].bubbles).toBe(true);
  });

  it('does not fire again for a second accession that also has data', async () => {
    const { el, events } = viewer();
    await el._loadData();

    el.accession = 'P12345';
    await el._loadData();

    expect(el.hasData).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('does not fire for a load with no data', async () => {
    const { el, events } = viewer();
    serve = 'missing';

    await el._loadData();

    expect(el.hasData).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('fires again when a new load brings data after one that had none', async () => {
    const { el, events } = viewer();
    await el._loadData();

    el.accession = 'P12345';
    serve = 'missing';
    await el._loadData();
    expect(el.hasData).toBe(false);
    expect(events).toHaveLength(1);

    el.accession = 'Q99999';
    serve = 'data';
    await el._loadData();

    expect(el.hasData).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[1].detail).toEqual({ hasData: true });
  });

  it('fires when a targeted retry brings data after a load that had none', async () => {
    const { el, events } = viewer();
    serve = 'missing';
    await el._loadData();
    expect(events).toHaveLength(0);

    serve = 'data';
    await el._loadData(new Set(['g-a']));

    expect(el.hasData).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ hasData: true });
  });

  it('does not fire for a targeted retry when there is data already', async () => {
    const { el, events } = viewer();
    await el._loadData();

    await el._loadData(new Set(['g-a']));

    expect(el.hasData).toBe(true);
    expect(events).toHaveLength(1);
  });
});
