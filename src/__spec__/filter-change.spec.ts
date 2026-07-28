/**
 * Component-level coverage for the variant filter's change handler.
 *
 * Guards the de-hardcoding of the filter baseline: `handleFilterClick`
 * used to read a private `transformedVariants` field and write back to
 * the literal key `'VARIATION-variation'`. It now reads a pristine
 * baseline from `${trackKey}${UNFILTERED_SUFFIX}` (written by the loader
 * for any `filterUI: 'nightingale-filter'` track) and writes the
 * filtered result to `trackKey` — with `trackKey` threaded in from the
 * `@change` binding rather than hardcoded.
 *
 * The test deliberately drives a track whose id is NOT `variation`
 * (`RNA_EDITING-user_defined_variants`) to prove no id string is baked
 * into the handler. It also asserts the `__unfiltered` baseline is left
 * untouched, so repeated filtering can never compound.
 *
 * As with the other component-level specs, nightingale packages are
 * stubbed (via `src/__spec__/nightingale-mocks.ts`, wired through
 * `setupFiles`) and the element is never mounted — we set state directly
 * and call the handler.
 */

import { describe, it, expect, vi } from 'vitest';

import '../protvista-uniprot.js';
import { UNFILTERED_SUFFIX } from '../load-data.js';

type FilterDef = {
  name: string;
  type: { name: string };
  filterPredicate: (variant: Record<string, unknown>) => boolean;
};

type ProtvistaUniprotLike = HTMLElement & {
  data: Record<string, any>;
  handleFilterClick(e: CustomEvent, trackKey: string): void;
  _loadDataInComponents(): Promise<void>;
};

const TRACK_KEY = 'RNA_EDITING-user_defined_variants';
const BASELINE_KEY = `${TRACK_KEY}${UNFILTERED_SUFFIX}`;
const SEQUENCE = 'MKTAYIAK';

/** Three variants spanning two consequence types × two provenances. */
function baselineVariants() {
  return [
    { protvistaFeatureId: 'v1', consequenceType: 'missense', sourceType: 'large_scale_study' },
    { protvistaFeatureId: 'v2', consequenceType: 'stop_gained', sourceType: 'uniprot' },
    { protvistaFeatureId: 'v3', consequenceType: 'missense', sourceType: 'uniprot' },
  ];
}

/** Facet defs shaped like the entries `groupByGroup`/`getFilter` expect. */
const FILTERS: FilterDef[] = [
  {
    name: 'consequence:missense',
    type: { name: 'consequence' },
    filterPredicate: (v) => v.consequenceType === 'missense',
  },
  {
    name: 'consequence:stop_gained',
    type: { name: 'consequence' },
    filterPredicate: (v) => v.consequenceType === 'stop_gained',
  },
  {
    name: 'provenance:uniprot',
    type: { name: 'provenance' },
    filterPredicate: (v) => v.sourceType === 'uniprot',
  },
  {
    name: 'provenance:large_scale_study',
    type: { name: 'provenance' },
    filterPredicate: (v) => v.sourceType === 'large_scale_study',
  },
];

function buildElement(): ProtvistaUniprotLike {
  const el = document.createElement(
    'protvista-uniprot'
  ) as unknown as ProtvistaUniprotLike;
  // Mirror the loader exactly: it writes the SAME object reference to the
  // live slot and the `__unfiltered` baseline. Sharing the reference here
  // (rather than two independent copies) means a regression that mutated
  // the baseline in place would corrupt the live slot's array too, and
  // the "baseline stays pristine" assertions below would catch it.
  const payload = { sequence: SEQUENCE, variants: baselineVariants() };
  el.data = {
    [TRACK_KEY]: payload,
    [BASELINE_KEY]: payload,
  };
  // `_loadDataInComponents` awaits `frame()` and pokes the DOM; the
  // element is never mounted, so stub it out to isolate the data write.
  el._loadDataInComponents = vi.fn(async () => undefined);
  return el;
}

/** A `nightingale-filter` `change` event with the given selection. */
function filterEvent(selected: string[]): CustomEvent {
  return {
    target: { filters: FILTERS },
    detail: { value: selected },
  } as unknown as CustomEvent;
}

describe('<protvista-uniprot>.handleFilterClick() — de-hardcoded filter baseline', () => {
  it('filters a non-"variation" track against its pristine baseline', () => {
    const el = buildElement();

    // missense ∧ uniprot → only v3 survives.
    el.handleFilterClick(
      filterEvent(['consequence:missense', 'provenance:uniprot']),
      TRACK_KEY
    );

    const live = el.data[TRACK_KEY] as {
      sequence: string;
      variants: Array<{ protvistaFeatureId: string }>;
    };
    expect(live.variants.map((v) => v.protvistaFeatureId)).toEqual(['v3']);
    // Non-`variants` fields are carried through from the baseline spread.
    expect(live.sequence).toBe(SEQUENCE);

    // No `variation`/`VARIATION-variation` key was ever touched — the id
    // hardcode is gone.
    expect(el.data['VARIATION-variation']).toBeUndefined();

    // The push-to-components hook fired exactly once.
    expect(el._loadDataInComponents).toHaveBeenCalledTimes(1);
  });

  it('leaves the __unfiltered baseline pristine so repeated filtering does not compound', () => {
    const el = buildElement();

    // First interaction: narrow to a single stop_gained/uniprot variant.
    el.handleFilterClick(
      filterEvent(['consequence:stop_gained', 'provenance:uniprot']),
      TRACK_KEY
    );
    expect(
      (el.data[TRACK_KEY] as { variants: unknown[] }).variants
    ).toHaveLength(1);
    // Baseline untouched by the first filter.
    expect(
      (el.data[BASELINE_KEY] as { variants: unknown[] }).variants
    ).toHaveLength(3);

    // Second interaction against the FULL baseline (not the 1-item
    // result): missense ∧ uniprot → v3. If the handler had re-read the
    // already-filtered live slot this would collapse to empty.
    el.handleFilterClick(
      filterEvent(['consequence:missense', 'provenance:uniprot']),
      TRACK_KEY
    );
    expect(
      (el.data[TRACK_KEY] as {
        variants: Array<{ protvistaFeatureId: string }>;
      }).variants.map((v) => v.protvistaFeatureId)
    ).toEqual(['v3']);
    expect(
      (el.data[BASELINE_KEY] as { variants: unknown[] }).variants
    ).toHaveLength(3);
  });
});
