/**
 * Unit tests for `scripts/structure-egfr/build.mjs`.
 *
 * Tests the offline mapping, difference detection, and formatting logic using
 * fixtures without network requests. Runs under Vitest during CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContacts,
  firstDifference,
  parseArgs,
  DRUG_CONFIGS,
} from './build.mjs';

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/sample-ligands.json'
);
const SAMPLE_LIGANDS = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('firstDifference (build.mjs --check)', () => {
  const committed = {
    target: {
      retrieved: '2026-10-09T14:57:51.000Z',
      uniprotRelease: '2026_03',
    },
    source: {
      retrieved: '2026-10-09T14:57:51.000Z',
      release: '2026.1',
    },
    outputs: { 'drug-contacts.csv': 'c5f015f8' },
  };

  it('ignores the retrieved dates at any depth', () => {
    const today = structuredClone(committed);
    today.target.retrieved = '2026-10-10T00:00:00.000Z';
    today.source.retrieved = '2026-10-10T00:00:00.000Z';
    expect(firstDifference(committed, today)).toBeNull();
  });

  it('names the path of any other difference', () => {
    const today = structuredClone(committed);
    today.target.uniprotRelease = '2026_04';
    expect(firstDifference(committed, today)).toBe(
      'target.uniprotRelease: "2026_03" → "2026_04"'
    );
  });

  it('reports a field that disappeared', () => {
    const today = structuredClone(committed);
    delete today.outputs['drug-contacts.csv'];
    expect(firstDifference(committed, today)).toMatch(
      /^outputs\.drug-contacts\.csv: "c5f015f8" → undefined/
    );
  });

  it('reports a field that appeared', () => {
    const today = structuredClone(committed);
    today.outputs['extra.csv'] = '999';
    expect(firstDifference(committed, today)).toBe(
      'outputs.extra.csv: undefined → "999"'
    );
  });
});

describe('buildContacts', () => {
  const singleConfig = [
    { type: 'AFATINIB', drug: 'Afatinib', ccd: '0WN' },
  ];

  it('maps residues and formats descriptions for sample ligands', () => {
    const { csvText, summary, stats } = buildContacts(
      SAMPLE_LIGANDS,
      singleConfig
    );
    expect(summary).toEqual([
      { type: 'AFATINIB', name: 'Afatinib', ccd: '0WN', residues: 2 },
    ]);
    expect(stats.totalFeatures).toBe(2);
    expect(stats.first).toBe(718);
    expect(stats.last).toBe(797);

    const lines = csvText.trim().split('\n');
    expect(lines[0]).toBe(
      'type,start,end,description,drug,ccd,residue,n_structures,pdb_ids,url'
    );
    expect(lines[1]).toBe(
      'AFATINIB,718,718,"Afatinib contacts Leu718 in 2 PDB entries (4g5j, 4g5p)",Afatinib,0WN,Leu718,2,4g5j 4g5p,https://www.ebi.ac.uk/pdbe/entry/pdb/4g5j'
    );
    expect(lines[2]).toBe(
      'AFATINIB,797,797,Afatinib contacts Cys797 in 1 PDB entry (4g5j),Afatinib,0WN,Cys797,1,4g5j,https://www.ebi.ac.uk/pdbe/entry/pdb/4g5j'
    );
  });

  it('refuses missing ligand CCD configuration', () => {
    expect(() =>
      buildContacts(SAMPLE_LIGANDS, [
        { type: 'OSIMERTINIB', drug: 'Osimertinib', ccd: 'YY3' },
      ])
    ).toThrow('Ligand with CCD YY3 (Osimertinib) not found in data');
  });

  it('exposes the 8 curated drug configurations', () => {
    expect(DRUG_CONFIGS).toHaveLength(8);
    expect(DRUG_CONFIGS.map((c) => c.ccd)).toContain('YY3');
  });
});

describe('parseArgs', () => {
  it('parses default options', () => {
    const opts = parseArgs([]);
    expect(opts.target).toBe('P00533');
    expect(opts.out).toBe('examples/structure-egfr');
    expect(opts.served).toBe('docs/public/sample-data/structure-egfr');
    expect(opts.check).toBe(false);
  });

  it('supports custom flags and --check', () => {
    const opts = parseArgs([
      '--target',
      'P04637',
      '--out',
      'examples/custom',
      '--check',
    ]);
    expect(opts.target).toBe('P04637');
    expect(opts.out).toBe('examples/custom');
    expect(opts.check).toBe(true);
  });
});
