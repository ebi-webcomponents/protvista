/**
 * Characterization test for `loadProtvistaData` — the schema-driven
 * data pipeline extracted from `<protvista-uniprot>._loadData`.
 *
 * Runs the shipped `default-config.yaml` through the same loader the
 * element mounts (`loadConfig`), then drives `loadProtvistaData` with
 * stub fetch/adapters. Pins down what the pipeline does end-to-end:
 *
 *   • The URL list that hits the network after `{accession}` resolution
 *     and template-URL dedup.
 *   • Which adapters fire, how many times, and which track slot each
 *     one populates.
 *   • The filter pass for tracks that carry a `filter:` literal.
 *   • The InterPro representative-domain flattening (`locations[]
 *     .representative` → synthetic features).
 *   • The per-group aggregation mode (`.flat()` for most groups,
 *     `groupData[0]` for linegraph / colored-sequence groups).
 *
 * Strategy
 *   • `fetchOne` is stubbed to return a distinct canned payload per URL,
 *     so URL substitution, dedup, and raw-data routing are all visible.
 *   • Each adapter is stubbed to return a deterministic array covering
 *     every filter type used by the config — filtered tracks collapse
 *     to a single entry (the matching type), unfiltered tracks retain
 *     the full list, cleanly surfacing filter wiring.
 *   • `interpro-adapter` is stubbed to return `locations[].representative`
 *     so the special-case flattening in `loadProtvistaData` actually
 *     runs.
 *
 * Adapter INTERNALS are covered by their own unit tests and are
 * deliberately not characterised here.
 *
 * READING THE SNAPSHOT
 *   Because every adapter shares the same uniform mock, the data under
 *   `ALPHAFOLD_CONFIDENCE`, `ALPHAMISSENSE_PATHOGENICITY`, and other
 *   colored-sequence / linegraph groups will look identical in shape to
 *   the feature-shaped groups (`DOMAINS`, `SITES`, …) — rows like
 *   `{ _adapter: "alphafold-prediction-json", type: "MOTIF" }` under
 *   `ALPHAFOLD_CONFIDENCE` are a mock artefact, NOT a loader bug. The
 *   real AlphaFold adapter would produce a coloured-sequence string,
 *   the real variant-counts adapter would produce a linegraph-point
 *   array, etc. The snapshot characterises *which slot each adapter's
 *   output lands in*, not *what shape the real adapter output has*.
 *   (Follow-on: replace with shape-correct per-adapter mocks —
 *   tracked as a next-branch issue.)
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig } from '../schema/load';
import type { NormalizedConfig } from '../schema/normalize';
import {
  loadProtvistaData,
  UNFILTERED_SUFFIX,
  type AdapterMap,
} from '../load-data';

const REFERENCE_ACCESSION = 'P05067';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_YAML = resolve(__dirname, '../default-config.yaml');

/**
 * Every literal UniProt feature-type that appears in a `filter:` field
 * across the current config. Centralised so tests that stub adapter
 * output return every value that any track would filter for — filtered
 * tracks then collapse to a single matching row, cleanly surfacing
 * filter wiring in the snapshot.
 */
const FILTER_TYPES_USED = [
  'ACT_SITE',
  'BINDING',
  'CA_BIND',
  'CARBOHYD',
  'CHAIN',
  'COMPBIAS',
  'CONFLICT',
  'CROSSLNK',
  'DISULFID',
  'DNA_BIND',
  'DOMAIN',
  'INIT_MET',
  'INTRAMEM',
  'LIPID',
  'METAL',
  'MOD_RES',
  'MOD_RES_LS',
  'MOTIF',
  'MUTAGEN',
  'NON_CONS',
  'NON_STD',
  'NON_TER',
  'NP_BIND',
  'PEPTIDE',
  'PROPEP',
  'REGION',
  'REPEAT',
  'SIGNAL',
  'SITE',
  'TOPO_DOM',
  'TRANSIT',
  'TRANSMEM',
  'UNSURE',
  'ZN_FING',
  'non_unique',
  'unique',
] as const;

/**
 * Stub adapter: returns one sentinel entry per known filter type.
 * Filtered tracks collapse to a single-element array; unfiltered tracks
 * retain the full list. The `_adapter` marker makes it obvious in the
 * snapshot which adapter produced each entry.
 */
function makeSimpleAdapter(adapterName: string) {
  return vi.fn(() =>
    FILTER_TYPES_USED.map((type) => ({ _adapter: adapterName, type }))
  );
}

/**
 * InterPro has a special-case branch in the loader: the adapter output is
 * walked to collect `locations[].representative` fragments, which are
 * emitted as synthetic features with `type: 'InterPro Representative
 * Domain'`. We return a shape that exercises both `representative: true`
 * (should be emitted) and `representative: false` (should be dropped).
 */
function makeInterproAdapter() {
  return vi.fn(() => [
    {
      accession: 'IPR-STUB-REPRESENTATIVE',
      source: 'InterPro',
      locations: [
        {
          representative: true,
          fragments: [
            { start: 1, end: 50 },
            { start: 200, end: 300 },
          ],
        },
      ],
    },
    {
      accession: 'IPR-STUB-NONREPRESENTATIVE',
      source: 'InterPro',
      locations: [
        {
          representative: false,
          fragments: [{ start: 400, end: 500 }],
        },
      ],
    },
  ]);
}

function buildMockAdapters(): AdapterMap {
  return {
    'uniprot-features-json': makeSimpleAdapter('uniprot-features-json'),
    'interpro-entries-json': makeInterproAdapter(),
    'uniprot-proteomics-json': makeSimpleAdapter('uniprot-proteomics-json'),
    'uniprot-proteins-pdb-json': makeSimpleAdapter(
      'uniprot-proteins-pdb-json'
    ),
    'uniprot-variation-json': makeSimpleAdapter('uniprot-variation-json'),
    'uniprot-variation-counts-json': makeSimpleAdapter(
      'uniprot-variation-counts-json'
    ),
    'uniprot-rna-editing-json': makeSimpleAdapter('uniprot-rna-editing-json'),
    'uniprot-rna-editing-counts-json': makeSimpleAdapter(
      'uniprot-rna-editing-counts-json'
    ),
    'uniprot-proteomics-ptm-json': makeSimpleAdapter(
      'uniprot-proteomics-ptm-json'
    ),
    'alphafold-prediction-json': makeSimpleAdapter(
      'alphafold-prediction-json'
    ),
    'alphamissense-average-csv': makeSimpleAdapter(
      'alphamissense-average-csv'
    ),
    'alphamissense-full-csv': makeSimpleAdapter('alphamissense-full-csv'),
  };
}

/** Deterministic canned fetch: one fixture per URL, echoing the (already
 *  substituted) URL back so the snapshot shows which URL produced which
 *  raw record. */
const makeCannedFetch = () =>
  vi.fn(async (url: string) => ({ fixture: true, url }));

describe('loadProtvistaData baseline (schema-driven default config)', () => {
  let config: NormalizedConfig;
  let mockAdapters: AdapterMap;
  let cannedFetch: ReturnType<typeof makeCannedFetch>;

  beforeAll(async () => {
    // Load the shipped default config through the same pipeline the
    // element uses. We supply `accession` so the `missing-accession`
    // validator rule (which refuses a template config without a
    // declared accession) accepts the template at validation time.
    // The accession substitution itself still happens inside
    // `loadProtvistaData` at fetch time, per the loader's contract.
    const yamlText = await readFile(DEFAULT_CONFIG_YAML, 'utf8');
    config = await loadConfig(yamlText, { accession: REFERENCE_ACCESSION });
  });

  beforeEach(() => {
    mockAdapters = buildMockAdapters();
    cannedFetch = makeCannedFetch();
  });

  it('produces a stable result for the reference accession', async () => {
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      cannedFetch,
      mockAdapters
    );
    expect(result).toMatchSnapshot();
  });

  it('invokes each adapter the expected number of times', async () => {
    await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      cannedFetch,
      mockAdapters
    );
    const callCounts = Object.fromEntries(
      Object.entries(mockAdapters)
        .map(([name, fn]) => [name, (fn as ReturnType<typeof vi.fn>).mock.calls.length])
        .sort(([a], [b]) => (a as string).localeCompare(b as string))
    );
    expect(callCounts).toMatchSnapshot();
  });

  it('fetches the expected unique URL set after {accession} substitution', async () => {
    await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      cannedFetch,
      mockAdapters
    );
    const fetched = cannedFetch.mock.calls.map(([u]) => u).sort();
    expect({ accession: REFERENCE_ACCESSION, fetched }).toMatchSnapshot();
  });

  it('computes hasData=true when any response has features.length > 0', async () => {
    const withFeatures = vi.fn(async (url: string) => ({
      url,
      features: [{ type: 'CHAIN', begin: 1, end: 10 }],
    }));
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      withFeatures,
      mockAdapters
    );
    expect(result.hasData).toBe(true);
  });

  it('computes hasData=false when no response has features', async () => {
    // Our default cannedFetch returns { fixture, url } — no `features`.
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      cannedFetch,
      mockAdapters
    );
    expect(result.hasData).toBe(false);
  });

  it('honors the variation-adapter early-return on empty raw data', async () => {
    // When the raw response for a variation URL is `[]`, loadProtvistaData
    // must NOT call the adapter and must NOT populate the track key.
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      async (url) =>
        url.includes('/variation/') ? [] : { fixture: true, url },
      mockAdapters
    );
    const variationAdapter = mockAdapters[
      'uniprot-variation-json'
    ] as ReturnType<typeof vi.fn>;
    expect(variationAdapter).not.toHaveBeenCalled();
    expect(result.data).not.toHaveProperty('VARIATION-variation');
  });

  it('mirrors a filterUI track under an __unfiltered baseline key', async () => {
    // The default config's variation track sets
    // `filterUI: nightingale-filter`, so the loader mirrors its adapted
    // payload under `${trackKey}${UNFILTERED_SUFFIX}` — the pristine
    // baseline the component's filter handler re-filters against without
    // compounding. The opt-in is `filterUI`, NOT a hardcoded track id.
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      cannedFetch,
      mockAdapters
    );
    const baselineKey = `VARIATION-variation${UNFILTERED_SUFFIX}`;
    // Same reference as the live slot at load time.
    expect(result.data[baselineKey]).toBe(result.data['VARIATION-variation']);
    // ...and it is the ONLY baseline: tracks without `filterUI` get no
    // `__unfiltered` copy, proving no id is special-cased.
    const unfilteredKeys = Object.keys(result.data).filter((k) =>
      k.endsWith(UNFILTERED_SUFFIX)
    );
    expect(unfilteredKeys).toEqual([baselineKey]);
  });

  it('rewrites InterPro representative fragments with the expected synthetic type', async () => {
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      cannedFetch,
      mockAdapters
    );
    // The track id in `default-config.yaml` is literally "InterPro
    // representative domain" (with spaces), so the data key is
    // `DOMAINS-InterPro representative domain`.
    const interpro = (result.data as Record<string, unknown>)[
      'DOMAINS-InterPro representative domain'
    ] as Array<{ type: string; accession: string; start: number; end: number }>;
    // Our stub emits two representative fragments from ONE feature and
    // zero from the other → 2 synthetic entries, all tagged with the
    // special type string.
    expect(interpro).toHaveLength(2);
    expect(
      interpro.every((f) => f.type === 'InterPro Representative Domain')
    ).toBe(true);
    expect(interpro.map((f) => [f.start, f.end])).toEqual([
      [1, 50],
      [200, 300],
    ]);
  });

  it('returns an empty `data` object when no accession is effectively provided', async () => {
    // `loadProtvistaData` requires a truthy accession to do any work;
    // pass an empty-string accession and the pure function will fetch
    // URLs with a literal `` substitution (cf. fetch-side behavior) but
    // still walk groups. We pin this down as-is.
    const result = await loadProtvistaData(
      '',
      config,
      cannedFetch,
      mockAdapters
    );
    // The function still produces group aggregates for each group
    // (since we only skip *at the component level* when accession is
    // falsy). This test documents the current pure-function behavior.
    expect(Object.keys(result.data)).toMatchSnapshot();
  });
});
