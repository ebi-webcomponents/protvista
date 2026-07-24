/**
 * Focused unit tests for the domain adapters whose behaviour the
 * adapter-unification refactor concentrated in the adapter itself:
 *
 *   - `interpro-entries-json` now performs the representative-domain
 *     flattening that used to live in the loader;
 *   - `uniprot-variation-json` now owns the empty-payload guard the
 *     loader used to apply before calling it.
 *
 * A representative single-input adapter (`uniprot-features-json`) is
 * covered too, pinning the shared narrow-then-transform contract.
 */

import { describe, it, expect } from 'vitest';

import { interproAdapter } from '../interpro-adapter';
import { variationAdapter } from '../variation-adapter';
import { featureAdapter } from '../feature-adapter';

describe('interproAdapter', () => {
  const RAW = {
    results: [
      {
        metadata: {
          accession: 'IPR000001',
          name: 'Kringle',
          source_database: 'interpro',
          type: 'domain',
          integrated: null,
          member_databases: null,
          go_terms: null,
        },
        proteins: [
          {
            accession: 'p05067',
            protein_length: 770,
            source_database: 'reviewed',
            organism: '9606',
            in_alphafold: true,
            entry_protein_locations: [
              {
                representative: true,
                model: null,
                score: null,
                fragments: [
                  { start: 10, end: 50, 'dc-status': 'CONTINUOUS' },
                  { start: 100, end: 150, 'dc-status': 'CONTINUOUS' },
                ],
              },
              {
                representative: false,
                model: null,
                score: null,
                fragments: [{ start: 400, end: 450, 'dc-status': 'CONTINUOUS' }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('flattens each representative fragment into a synthetic domain feature and drops non-representative ones', () => {
    const out = interproAdapter(RAW) as Array<{
      type: string;
      start: number;
      end: number;
      accession: string;
    }>;
    // Two representative fragments → two features; the non-representative
    // location is dropped.
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.type === 'InterPro Representative Domain')).toBe(
      true
    );
    expect(out.map((f) => [f.start, f.end])).toEqual([
      [10, 50],
      [100, 150],
    ]);
    expect(out[0].accession).toBe('IPR000001');
  });
});

describe('variationAdapter empty-payload guard', () => {
  it('returns null for an empty fetched body (empty array)', () => {
    expect(variationAdapter([])).toBeNull();
  });

  it('returns null when the body carries no features', () => {
    expect(variationAdapter({})).toBeNull();
  });

  it('maps features into { sequence, variants } for a populated body', () => {
    const out = variationAdapter({
      sequence: 'MKT',
      features: [
        {
          begin: '2',
          alternativeSequence: 'A',
          genomicLocation: ['chr1:100'],
          xrefs: [{ name: 'dbSNP' }],
          sourceType: 'large_scale_study',
          predictions: [],
        },
      ],
    }) as { sequence: string; variants: Array<Record<string, unknown>> };
    expect(out).not.toBeNull();
    expect(out.sequence).toBe('MKT');
    expect(out.variants).toHaveLength(1);
    expect(out.variants[0]).toMatchObject({ start: 2, variant: 'A' });
  });
});

describe('featureAdapter', () => {
  it('renames begin→start and passes features through', () => {
    const out = featureAdapter({
      features: [{ type: 'CHAIN', begin: 5, end: 10 }],
    }) as Array<{ type: string; start: number }>;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'CHAIN', start: 5 });
  });

  it('returns an empty array for a body with no features', () => {
    expect(featureAdapter({})).toEqual([]);
    expect(featureAdapter([])).toEqual([]);
  });
});
