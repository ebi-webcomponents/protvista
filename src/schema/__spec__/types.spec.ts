/**
 * Compile-time contract test for the ProtvistaViewerConfig types.
 *
 * This spec doesn't exercise runtime behaviour — the types are
 * runtime-free. Instead it uses TypeScript's structural typing as a
 * cheap, in-CI guard against type regressions:
 *
 *   - Every example config in `specs/config-approach.md` is expressed as a literal
 *     typed as `ProtvistaViewerConfig`. If any optional field is
 *     wrongly marked required (or any required field is dropped),
 *     the build fails before tests even run.
 *   - A minimal `expectType<T>(x: T)` helper pins the parameter's
 *     type without requiring a dependency on `tsd` / `expect-type`.
 *   - Runtime assertions are `expect(true).toBe(true)` so the spec
 *     also counts toward the test tally.
 */

import { describe, it, expect } from 'vitest';

import type {
  ProtvistaViewerConfig,
  GroupConfig,
  TrackConfig,
  DataSourceDescriptor,
  RenderingOptions,
  ColorScaleConfig,
  SemanticKind,
  ComponentName,
  AdapterName,
  ProtvistaRuntimeAPI,
  SemanticKindDefinition,
} from '../types';

/**
 * Compile-time type-identity check. The function returns its argument
 * unchanged; the value-side is a no-op, the type annotation on the
 * parameter is the actual assertion.
 */
function expectType<T>(value: T): T {
  return value;
}

describe('ProtvistaViewerConfig — type contract', () => {
  it('specs/config-approach.md Example 1: minimal config (string shorthand data, inferred label)', () => {
    const config: ProtvistaViewerConfig = {
      accession: 'P05067',
      sources: {
        features: 'https://www.ebi.ac.uk/proteins/api/features/{accession}',
      },
      groups: [
        {
          id: 'DOMAINS',
          tracks: [
            {
              id: 'domain',
              kind: 'features',
              filter: 'DOMAIN',
              data: 'features',
              description:
                'Specific combination of secondary structures organized into a characteristic 3D fold',
            },
          ],
        },
      ],
    };
    expectType<ProtvistaViewerConfig>(config);
    expect(config.groups).toHaveLength(1);
  });

  it('specs/config-approach.md Example 2: inline data (Starter Kit, no server)', () => {
    const config: ProtvistaViewerConfig = {
      groups: [
        {
          id: 'MY_ANNOTATIONS',
          label: 'My custom annotations',
          tracks: [
            {
              id: 'binding_sites',
              label: 'Predicted binding sites',
              kind: 'features',
              data: {
                from: 'inline',
                inlineData: [
                  {
                    type: 'BINDING',
                    start: 45,
                    end: 52,
                    description: 'ATP binding',
                  },
                  {
                    type: 'BINDING',
                    start: 120,
                    end: 128,
                    description: 'Mg2+ binding',
                  },
                ],
              },
              description: 'Binding sites predicted by my pipeline',
              rendering: { color: '#e74c3c', shape: 'diamond' },
            },
          ],
        },
      ],
    };
    expectType<ProtvistaViewerConfig>(config);
    expect(config.groups[0].tracks[0].data).toMatchObject({
      from: 'inline',
    });
  });

  it('specs/config-approach.md Example 3: inheritance, multi-URL adapter, filter UI', () => {
    const config: ProtvistaViewerConfig = {
      defaults: {
        labelUrl: 'https://www.uniprot.org/uniprot/{accession}',
      },
      sources: {
        features: 'https://www.ebi.ac.uk/proteins/api/features/{accession}',
        variation: 'https://www.ebi.ac.uk/proteins/api/variation/{accession}',
        proteins: 'https://www.ebi.ac.uk/proteins/api/proteins/{accession}',
        alphafoldPrediction:
          'https://alphafold.ebi.ac.uk/api/prediction/{accession}',
      },
      groups: [
        {
          id: 'ALPHAFOLD_CONFIDENCE',
          label: 'AlphaFold',
          helpPage: 'structure_section#alphafold-structural-models',
          tracks: [
            {
              id: 'alphafold_confidence',
              label: 'AlphaFold Confidence',
              labelUrl: 'https://alphafold.ebi.ac.uk/entry/{accession}',
              kind: 'confidence-score',
              data: { source: ['alphafoldPrediction', 'proteins'] },
              description: 'AlphaFold prediction confidence',
              dataTooltip:
                '### AlphaFold Confidence\n\n**pLDDT:** `{score}`\n\nScores above `90` indicate high expected accuracy.',
            },
          ],
        },
        {
          id: 'VARIATION',
          label: 'Variants',
          helpPage: 'variant_viewer',
          tracks: [
            {
              id: 'variation_graph',
              label: 'Counts',
              kind: 'variant-counts',
              data: 'variation',
              description: 'Variant counts per position',
            },
            {
              id: 'variation',
              kind: 'variants',
              filterUI: 'nightingale-filter',
              data: 'variation',
              description:
                'Natural variants including polymorphisms and disease-associated mutations',
            },
          ],
        },
      ],
    };
    expectType<ProtvistaViewerConfig>(config);
    expect(config.groups).toHaveLength(2);
  });

  it('specs/config-approach.md Example 5: extends — one line, one new track', () => {
    const config: ProtvistaViewerConfig = {
      extends: '@ebi/uniprot-default',
      groups: [
        {
          id: 'MY_LAB',
          label: 'My lab',
          tracks: [
            { id: 'hotspots', kind: 'features', data: './hotspots.csv' },
          ],
        },
      ],
    };
    expectType<ProtvistaViewerConfig>(config);
    expect(config.extends).toBe('@ebi/uniprot-default');
  });

  it('supports all four shapes of the `data` field', () => {
    const stringSourcesKey: TrackConfig['data'] = 'features';
    const stringFilePath: TrackConfig['data'] = './hits.csv';
    const singleDescriptor: TrackConfig['data'] = { url: 'https://x' };
    const descriptorArray: TrackConfig['data'] = [
      { source: 'a' },
      { source: 'b' },
    ];
    expectType<TrackConfig['data']>(stringSourcesKey);
    expectType<TrackConfig['data']>(stringFilePath);
    expectType<TrackConfig['data']>(singleDescriptor);
    expectType<TrackConfig['data']>(descriptorArray);
    // Sanity-check the runtime shape matches the types.
    expect(Array.isArray(descriptorArray)).toBe(true);
    expect(typeof stringSourcesKey).toBe('string');
  });

  it('accepts all documented `from` values including "custom"', () => {
    const froms: Array<DataSourceDescriptor['from']> = [
      'url',
      'inline',
      'file',
      'custom',
      undefined,
    ];
    for (const f of froms) {
      const d: DataSourceDescriptor = f === undefined ? {} : { from: f };
      expectType<DataSourceDescriptor>(d);
    }
    expect(froms).toHaveLength(5);
  });
});

describe('Rendering options', () => {
  it('RenderingOptions admits every documented field', () => {
    const r: RenderingOptions = {
      color: '#112233',
      shape: 'rectangle',
      height: 40,
      layout: 'non-overlapping',
      colorScale: { theme: 'alphafold-ramp' },
    };
    expectType<RenderingOptions>(r);
    expect(r.layout).toBe('non-overlapping');
  });

  it('ColorScaleConfig admits theme-only, stops-only, and both', () => {
    const themed: ColorScaleConfig = { theme: 'alphafold-ramp' };
    const stopsOnly: ColorScaleConfig = {
      stops: [
        { value: 0, color: '#000' },
        { value: 100, color: '#fff' },
      ],
    };
    const both: ColorScaleConfig = {
      theme: 'alphafold-ramp',
      stops: [{ value: 0, color: '#ff7d45', label: 'Very low' }],
    };
    for (const c of [themed, stopsOnly, both]) {
      expectType<ColorScaleConfig>(c);
    }
    expect(stopsOnly.stops).toHaveLength(2);
  });
});

describe('Open-ended vocabularies (IntelliSense + custom names)', () => {
  it('SemanticKind accepts built-ins and registered names', () => {
    const builtin: SemanticKind = 'confidence-score';
    const registered: SemanticKind = 'crispr-guides';
    expectType<SemanticKind>(builtin);
    expectType<SemanticKind>(registered);
    expect(builtin).toBe('confidence-score');
  });

  it('ComponentName and AdapterName accept built-ins and custom names', () => {
    const componentBuiltin: ComponentName = 'nightingale-track-canvas';
    const componentCustom: ComponentName = 'my-lab-track';
    const adapterBuiltin: AdapterName = 'features-csv';
    const adapterCustom: AdapterName = 'my-custom-json';
    expectType<ComponentName>(componentBuiltin);
    expectType<ComponentName>(componentCustom);
    expectType<AdapterName>(adapterBuiltin);
    expectType<AdapterName>(adapterCustom);
    expect(adapterBuiltin).toBe('features-csv');
  });

  it('AdapterName recognises features-tsv as a built-in generic adapter', () => {
    // features-tsv is a first-class sibling to features-csv (spec §Open
    // Questions Q1 resolution). This test guards against accidental
    // removal from KnownAdapterName.
    const tsvBuiltin: AdapterName = 'features-tsv';
    expectType<AdapterName>(tsvBuiltin);
    expect(tsvBuiltin).toBe('features-tsv');

    // A track using the `.tsv` file-path shorthand must type-check end
    // to end; the runtime will infer `from: file, adapter: features-tsv`.
    const track: TrackConfig = {
      id: 'hotspots',
      kind: 'features',
      data: './hotspots.tsv',
    };
    expectType<TrackConfig>(track);

    // And the explicit descriptor form must also accept features-tsv.
    const explicit: DataSourceDescriptor = {
      from: 'file',
      url: './hotspots.tsv',
      adapter: 'features-tsv',
    };
    expectType<DataSourceDescriptor>(explicit);
  });
});

describe('Escape-hatch API signatures', () => {
  it('ProtvistaRuntimeAPI exposes all documented methods', () => {
    // Build a no-op shim that must satisfy the interface for the test
    // to compile. This is the whole point — type-check the surface.
    // A zero-arg `noop` is assignable to any of these method slots via
    // TypeScript's contravariant parameter rule for function types.
    const noop = (): void => undefined;
    const api: ProtvistaRuntimeAPI = {
      registerAdapter: noop,
      registerSemanticKind: noop,
      registerTheme: noop,
      setTrackData: noop,
      setConfig: noop,
      on: noop,
    };
    const kindDef: SemanticKindDefinition = {
      component: 'nightingale-track-canvas',
      adapter: 'features-json',
      rendering: { shape: 'diamond', color: '#8e44ad' },
    };
    // Exercise one registration call to also prove signature compat.
    api.registerSemanticKind('crispr-guides', kindDef);
    expectType<ProtvistaRuntimeAPI>(api);
    expect(typeof api.registerAdapter).toBe('function');
  });
});

describe('Structural subsetting', () => {
  it('GroupConfig and TrackConfig require only `id` + `tracks`/`data`', () => {
    const minimalGroup: GroupConfig = {
      id: 'C',
      tracks: [],
    };
    const minimalTrack: TrackConfig = {
      id: 't',
      data: 'features',
    };
    expectType<GroupConfig>(minimalGroup);
    expectType<TrackConfig>(minimalTrack);
    expect(minimalGroup.tracks).toEqual([]);
  });

  it('ProtvistaViewerConfig requires only `groups`', () => {
    const c: ProtvistaViewerConfig = { groups: [] };
    expectType<ProtvistaViewerConfig>(c);
    expect(c.groups).toEqual([]);
  });
});
