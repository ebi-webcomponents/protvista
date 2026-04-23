/**
 * Focused coverage for the tooltip-resolver wire-in inside
 * `loadProtvistaData`.
 *
 * The baseline snapshot test (`load-data-baseline.spec.ts`) exercises the
 * whole pipeline against the real config. This file narrows in on the
 * single post-adapter step added for the declarative tooltip system:
 *
 *   1. `track.dataTooltip` present → its spec wins over any per-kind
 *      default and over any `tooltipContent` the adapter set itself.
 *   2. `track.kind` present, no `dataTooltip` → `tooltipDefaults[kind]`
 *      is consulted.
 *   3. Neither present → the adapter's own `tooltipContent` (if any) is
 *      left intact.
 *   4. Variation-shaped adapter output (`{ sequence, variants }`) has the
 *      resolver applied to each item in `variants`, not to the wrapper.
 *   5. The `TooltipContext` passed to the resolver carries the accession,
 *      track id, and kind verbatim.
 *   6. `tooltipOverrides[kind]` (the programmatic escape hatch) wins over
 *      both `track.dataTooltip` and `tooltipDefaults[kind]`, and is the
 *      only surface that admits a `kind: 'custom'` JS render function.
 *
 * The config shape is hand-crafted against the `NormalizedConfig` API —
 * the renderer now consumes that directly, no legacy bridge in between.
 * Each fixture sets only the fields the loader reads:
 * `id`, `component`, `data[0].{ from, url, adapter }`, plus whichever
 * resolver inputs the test exercises.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadProtvistaData, type AdapterMap } from '../load-data';
import type { NormalizedConfig, NormalizedTrack } from '../schema/normalize';
import type { TooltipSpec } from '../tooltips/types';

const ACCESSION = 'P05067';

const fetchOne = vi.fn(async (url: string) => ({ url })); // payload is irrelevant — adapters below ignore it

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

describe('loadProtvistaData — tooltip resolver wire-in', () => {
  it('applies `dataTooltip` to every item in an array adapter output', async () => {
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Desc' }],
    };
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'DOMAIN', description: 'first' },
        { type: 'DOMAIN', description: 'second' },
      ],
    };
    const config = makeConfig({
      id: 'domain',
      label: 'domain',
      component: 'nightingale-track-canvas',
      rendering: {},
      dataTooltip: spec,
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, adapters);
    const items = data['CAT-domain'] as Array<{ tooltipContent: string }>;
    expect(items).toHaveLength(2);
    expect(items[0].tooltipContent).toBe('<h5>Desc</h5><p>first</p>');
    expect(items[1].tooltipContent).toBe('<h5>Desc</h5><p>second</p>');
  });

  it('`dataTooltip` wins over a per-kind default', async () => {
    // `kind: 'features'` has a built-in default in tooltipDefaults; the
    // override below must replace it.
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Override' }],
    };
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [{ type: 'DOMAIN', description: 'x' }],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features',
      dataTooltip: spec,
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, adapters);
    const [item] = data['CAT-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe('<h5>Override</h5><p>x</p>');
  });

  it('falls back to `tooltipDefaults[kind]` when no `dataTooltip` is set', async () => {
    // The `features` default is a delegate to the legacy
    // `featureTooltip` formatter, so exact HTML isn't asserted here —
    // what matters is that the wire-in fired and produced a non-empty
    // string.
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'DOMAIN', begin: 1, end: 10, description: 'x' },
      ],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features',
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, adapters);
    const [item] = data['CAT-t'] as Array<{ tooltipContent?: string }>;
    expect(item.tooltipContent).toBeTypeOf('string');
    expect(item.tooltipContent!.length).toBeGreaterThan(0);
  });

  it('leaves adapter-set `tooltipContent` alone when neither spec is configured', async () => {
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'X', tooltipContent: '<p>from adapter</p>' },
      ],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, adapters);
    const [item] = data['CAT-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe('<p>from adapter</p>');
  });

  it('auto-synthesizes a fields tooltip when no spec is configured and the adapter sets nothing', async () => {
    // No `kind`, no `dataTooltip`, no `tooltipOverrides` entry, and the
    // adapter emits plain feature-shaped data without `tooltipContent`.
    // The auto-fallback should kick in and produce a Type/Description/
    // Start/End block out of the box.
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'DOMAIN', description: 'Kinase', start: 10, end: 50 },
      ],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, adapters);
    const [item] = data['CAT-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe(
      '<h5>Type</h5><p>DOMAIN</p>' +
        '<h5>Description</h5><p>Kinase</p>' +
        '<h5>Start</h5><p>10</p>' +
        '<h5>End</h5><p>50</p>'
    );
  });

  it('applies the resolver to each entry under `.variants` for variation-shaped adapter output', async () => {
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'wildType', label: 'WT' }],
    };
    const adapters: AdapterMap = {
      'uniprot-variation-json': async () => ({
        sequence: 'ACDEFG',
        variants: [
          { wildType: 'A', alternativeSequence: 'G' },
          { wildType: 'C', alternativeSequence: 'T' },
        ],
      }),
    };
    const config = makeConfig({
      id: 'variation',
      label: 'variation',
      component: 'nightingale-variation',
      rendering: {},
      dataTooltip: spec,
      data: [
        {
          from: 'url',
          // variation-adapter has a documented early-return when the
          // raw payload is empty — stub fetchOne to return something
          // non-empty for this one URL.
          url: 'variation-url',
          adapter: 'uniprot-variation-json',
        },
      ],
    });
    const fetchNonEmpty = vi.fn(async () => [{ something: true }]);

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchNonEmpty,
      adapters
    );
    const bundle = data['CAT-variation'] as {
      variants: Array<{ tooltipContent: string; wildType: string }>;
    };
    expect(bundle.variants).toHaveLength(2);
    expect(bundle.variants[0].tooltipContent).toBe('<h5>WT</h5><p>A</p>');
    expect(bundle.variants[1].tooltipContent).toBe('<h5>WT</h5><p>C</p>');
  });

  it('`tooltipOverrides[kind]` wins over `dataTooltip` and the per-kind default', async () => {
    const overrideSpec: TooltipSpec = {
      kind: 'custom',
      render: (item) =>
        `<strong>OVR:${(item as { description: string }).description}</strong>`,
    };
    const inlineSpec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Inline' }],
    };
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'DOMAIN', description: 'hit' },
      ],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features',
      dataTooltip: inlineSpec,
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      adapters,
      { features: overrideSpec }
    );
    const [item] = data['CAT-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe('<strong>OVR:hit</strong>');
  });

  it('falls through to `dataTooltip` when `tooltipOverrides` has no entry for this kind', async () => {
    const inlineSpec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Inline' }],
    };
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'DOMAIN', description: 'hit' },
      ],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features',
      dataTooltip: inlineSpec,
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      adapters,
      // Override registry targets a different kind — shouldn't fire here.
      { variants: { kind: 'fields', fields: [] } }
    );
    const [item] = data['CAT-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe('<h5>Inline</h5><p>hit</p>');
  });

  it('threads (accession, trackId, kind) into the `TooltipContext`', async () => {
    // Plumbed through the `tooltipOverrides` registry — the only
    // surface that admits a `kind: 'custom'` render function. The
    // normalised `dataTooltip` slot is typed as `AuthoredTooltipSpec`
    // (fields / markdown only), by design.
    const seen: unknown[] = [];
    const spec: TooltipSpec = {
      kind: 'custom',
      render: (_item, ctx) => {
        seen.push(ctx);
        return '';
      },
    };
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [{ type: 'X' }],
    };
    const config = makeConfig({
      id: 'my-track',
      label: 'my-track',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features-domain',
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    await loadProtvistaData(ACCESSION, config, fetchOne, adapters, {
      'features-domain': spec,
    });
    expect(seen).toEqual([
      { accession: ACCESSION, trackId: 'my-track', kind: 'features-domain' },
    ]);
  });
});
