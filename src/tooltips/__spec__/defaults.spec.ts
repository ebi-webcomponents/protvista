/**
 * Coverage for the per-kind default tooltip specs.
 *
 * The library ships only small, declarative defaults (type / name /
 * description / position). Rich UniProt-specific rendering is out of
 * scope — consumers that want it listen for the Nightingale `change`
 * event and mount their own UI, or override per-track via
 * `dataTooltip:` in YAML.
 *
 * These tests pin the exact output so authors and integrators can see
 * what they get out of the box and what they'll need to override.
 */
import { describe, it, expect } from 'vitest';
import { resolveTooltip } from '../resolve.js';
import { tooltipDefaults } from '../defaults.js';
import type { TooltipContext } from '../types.js';

const ctx: TooltipContext = {
  accession: 'P05067',
  trackId: 'test',
  kind: 'test',
};

describe('tooltipDefaults — declarative field specs', () => {
  it('features emits type / description / start / end', () => {
    const got = resolveTooltip(
      { type: 'DOMAIN', description: 'Serpentine receptor', start: 10, end: 50 },
      tooltipDefaults.features,
      ctx
    );
    expect(got).toBe(
      '<h5>Type</h5><p>DOMAIN</p>' +
        '<h5>Description</h5><p>Serpentine receptor</p>' +
        '<h5>Start</h5><p>10</p>' +
        '<h5>End</h5><p>50</p>'
    );
  });

  it('features skips rows whose value resolves to missing / empty', () => {
    const got = resolveTooltip(
      { type: 'DOMAIN', start: 10, end: 50 },
      tooltipDefaults.features,
      ctx
    );
    expect(got).toBe(
      '<h5>Type</h5><p>DOMAIN</p>' +
        '<h5>Start</h5><p>10</p>' +
        '<h5>End</h5><p>50</p>'
    );
  });

  it('features-interpro emits name / accession / source_database / start / end', () => {
    const got = resolveTooltip(
      {
        start: 20,
        end: 120,
        accession: 'PF00001',
        name: 'Serpentine receptor',
        source_database: 'pfam',
      },
      tooltipDefaults['features-interpro'],
      ctx
    );
    expect(got).toBe(
      '<h5>Name</h5><p>Serpentine receptor</p>' +
        '<h5>Accession</h5><p>PF00001</p>' +
        '<h5>Source database</h5><p>pfam</p>' +
        '<h5>Start</h5><p>20</p>' +
        '<h5>End</h5><p>120</p>'
    );
  });

  it('variants emits wildType / alternativeSequence / consequenceType / begin', () => {
    const got = resolveTooltip(
      {
        wildType: 'G',
        alternativeSequence: 'V',
        consequenceType: 'missense',
        begin: 12,
      },
      tooltipDefaults.variants,
      ctx
    );
    expect(got).toBe(
      '<h5>Wild type</h5><p>G</p>' +
        '<h5>Variant</h5><p>V</p>' +
        '<h5>Consequence</h5><p>missense</p>' +
        '<h5>Position</h5><p>12</p>'
    );
  });

  it('peptides emits peptide / type / start / end', () => {
    const got = resolveTooltip(
      { peptide: 'KAPLNQGASQAK', type: 'unique', start: 100, end: 111 },
      tooltipDefaults.peptides,
      ctx
    );
    expect(got).toBe(
      '<h5>Peptide</h5><p>KAPLNQGASQAK</p>' +
        '<h5>Type</h5><p>unique</p>' +
        '<h5>Start</h5><p>100</p>' +
        '<h5>End</h5><p>111</p>'
    );
  });

  it('peptides-ptm emits type / position', () => {
    const got = resolveTooltip(
      { type: 'MOD_RES_LS', start: 7 },
      tooltipDefaults['peptides-ptm'],
      ctx
    );
    expect(got).toBe(
      '<h5>Type</h5><p>MOD_RES_LS</p><h5>Position</h5><p>7</p>'
    );
  });

  it('structure-coverage emits type / start / end', () => {
    const got = resolveTooltip(
      { type: 'PDB', start: 1, end: 200 },
      tooltipDefaults['structure-coverage'],
      ctx
    );
    expect(got).toBe(
      '<h5>Type</h5><p>PDB</p>' +
        '<h5>Start</h5><p>1</p>' +
        '<h5>End</h5><p>200</p>'
    );
  });

  it('rna-editing walks into variantType for wild-type / edited base', () => {
    const got = resolveTooltip(
      {
        variantType: { wildType: 'A', mutatedType: 'G' },
        consequenceType: 'synonymous',
        start: 42,
      },
      tooltipDefaults['rna-editing'],
      ctx
    );
    expect(got).toBe(
      '<h5>Wild type</h5><p>A</p>' +
        '<h5>Edited</h5><p>G</p>' +
        '<h5>Consequence</h5><p>synonymous</p>' +
        '<h5>Position</h5><p>42</p>'
    );
  });
});

describe('tooltipDefaults — graph kinds have no entry', () => {
  it.each([
    'variant-counts',
    'rna-editing-counts',
    'confidence-score',
    'pathogenicity-score',
    'pathogenicity-heatmap',
  ])('%s is unregistered', (kind) => {
    expect(tooltipDefaults[kind]).toBeUndefined();
  });
});
