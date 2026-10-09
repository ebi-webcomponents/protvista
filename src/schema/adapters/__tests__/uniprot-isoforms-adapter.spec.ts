import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
      uniprotIsoformsAdapter,
  type IsoformFeature,
} from '../uniprot-isoforms-adapter.js';

/** The adapter's rows; adapters are typed to return `unknown`. */
const adapt = (data: unknown): IsoformFeature[] =>
  uniprotIsoformsAdapter(data) as unknown as IsoformFeature[];

const fixturesDir = path.join(__dirname, '../../../__fixtures__/isoforms');

function readEntry(acc: string) {
  const file = path.join(fixturesDir, `${acc}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('uniprot-isoforms-adapter', () => {
  it('APP695 (P05067-4): specific fragments, highlights, and description', () => {
    const data = readEntry('P05067');
    const features = adapt(data);
    const app695 = features.find((f: any) => f.accession === 'P05067-4');
    
    expect(app695.locations[0].fragments).toEqual([
      { start: 1, end: 289 },
      { start: 365, end: 770 }
    ]);
    expect(app695.residuesToHighlight).toEqual([
      { position: 289, name: '289: E → V' }
    ]);
    expect(app695.description).toBe('P05067-4 (APP695): 289: E → V; 290-364: missing');
  });

  it('Row counts: APP 11, tau 9, CDKN2A 4 (canonical included, external skipped)', () => {
    expect(adapt(readEntry('P05067'))).toHaveLength(11);
    expect(adapt(readEntry('P10636'))).toHaveLength(9);
    expect(adapt(readEntry('P42771'))).toHaveLength(4);
  });

  it('CDKN2A canonical row names External isoforms and checks colours', () => {
    const features = adapt(readEntry('P42771'));
    const canonical = features.find((f: any) => f.color === '#0053d6');
    const nonCanonical = features.find((f: any) => f.color === '#888888');
    
    expect(canonical).toBeDefined();
    expect(nonCanonical).toBeDefined();
    expect(canonical.description).toBe(
      'P42771-1 (isoform 1): canonical sequence; not shown (External): Q8N726-1 (tumor suppressor ARF), Q8N726-2 (smARF)'
    );
  });

  it('P05067-11: long sequence truncation formatting', () => {
    const features = adapt(readEntry('P05067'));
    const p11 = features.find((f: any) => f.accession === 'P05067-11');
    
    expect(p11.locations[0].fragments).toEqual([{ start: 1, end: 770 }]);
    const h1 = p11.residuesToHighlight.find((r: any) => r.position === 1);
    const h345 = p11.residuesToHighlight.find((r: any) => r.position === 345);
    
    expect(h1.name).toBe('1-19: MLPGLALLLL… (19 aa) → MDQLEDLLVL… (14 aa)');
    expect(h345.name).toBe('345-364: MSQSLLKTTQ… (20 aa) → I');
    expect(p11.description).toBe(
      'P05067-11 (isoform 11): 1-19: MLPGLALLLL… (19 aa) → MDQLEDLLVL… (14 aa); 345-364: MSQSLLKTTQ… (20 aa) → I'
    );
  });

  it('CIROP isoform 2 and 3: insertions and highlights', () => {
    const features = adapt(readEntry('A0A1B0GTW7'));
    
    const iso2 = features.find((f: any) => f.accession === 'A0A1B0GTW7-2');
    expect(iso2.locations[0].fragments).toEqual([{ start: 1, end: 201 }, { start: 260, end: 788 }]);
    expect(iso2.residuesToHighlight).toBeUndefined();

    const iso3 = features.find((f: any) => f.accession === 'A0A1B0GTW7-3');
    expect(iso3.locations[0].fragments).toEqual([{ start: 1, end: 201 }, { start: 302, end: 788 }]);
    
    const h108 = iso3.residuesToHighlight.find((r: any) => r.position === 108);
    expect(h108.name).toBe('108: V → VPPV (insertion)');
    
    const h493 = iso3.residuesToHighlight.find((r: any) => r.position === 493);
    expect(h493.name).toBe('493-495: SEC → VSR');
  });

  it('Every description contains no [object Object]', () => {
    const proteins = ['P05067', 'P10636', 'P42771', 'A0A1B0GTW7'];
    for (const acc of proteins) {
      const features = adapt(readEntry(acc));
      for (const feat of features) {
        expect(feat.description).not.toContain('[object Object]');
        if (feat.residuesToHighlight) {
          for (const res of feat.residuesToHighlight) {
            expect(res.name).not.toContain('[object Object]');
          }
        }
      }
    }
  });

  it('Edge cases: array input, no sequence, unresolved', () => {
    const entry = readEntry('P05067');
    
    // Array input
    const fromArray = adapt([entry]);
    expect(fromArray).toHaveLength(11);
    
    // No sequence
    const noSeq = { ...entry, sequence: undefined };
    expect(adapt(noSeq)).toEqual([]);
    
    // Unresolved
    const broken = JSON.parse(JSON.stringify(entry));
    broken.features = broken.features.filter((f: any) => f.featureId !== 'VSP_000002');
    const bFeats = adapt(broken);
    const affected = bFeats.find((f: any) => f.description.includes('edits not in the entry: VSP_000002'));
    expect(affected).toBeDefined();
  });
});

describe('uniprot-isoforms-adapter: labels, colours and rows it must not draw', () => {
  // A minimal entry: the canonical X-1 and the given other isoforms.
  const entryWith = (...isoforms: object[]) => ({
    primaryAccession: 'X',
    sequence: { value: 'MAAA', length: 4 },
    comments: [
      {
        commentType: 'ALTERNATIVE PRODUCTS',
        isoforms: [
          { isoformIds: ['X-1'], isoformSequenceStatus: 'Displayed' },
          ...isoforms,
        ],
      },
    ],
  });

  it('colours the canonical row blue and every other row grey', () => {
    for (const acc of ['P05067', 'P10636', 'P42771', 'A0A1B0GTW7']) {
      const rows = adapt(readEntry(acc));
      expect(rows[0].description).toContain('canonical sequence');
      expect(rows.map((row) => row.color)).toEqual(
        rows.map((_, i) => (i === 0 ? '#0053d6' : '#888888'))
      );
    }
  });

  it('calls a longer replacement an insertion only when it keeps the original residues', () => {
    // CDKN2A isoform 5 swaps its last four residues for 15 others.
    const cdkn2a = adapt(readEntry('P42771'));
    expect(cdkn2a.find((f) => f.accession === 'P42771-4').description).toBe(
      'P42771-4 (isoform 5): 153-156: DIPD → EMIGNHLWVC… (15 aa)'
    );
    // Tau-G keeps S502 and adds 18 residues after it.
    const tau = adapt(readEntry('P10636'));
    expect(tau.find((f) => f.accession === 'P10636-9').description).toContain(
      '502: S → SATKQVQRRP… (19 aa) (insertion)'
    );
  });

  it('marks every residue of a replacement (CIROP isoform 3, 493-495)', () => {
    const iso3 = adapt(readEntry('A0A1B0GTW7')).find(
      (f) => f.accession === 'A0A1B0GTW7-3'
    );
    expect(iso3.residuesToHighlight).toEqual([
      { position: 108, name: '108: V → VPPV (insertion)' },
      { position: 493, name: '493-495: SEC → VSR' },
      { position: 494, name: '493-495: SEC → VSR' },
      { position: 495, name: '493-495: SEC → VSR' },
    ]);
  });

  it('says so when a non-canonical isoform lists no edits', () => {
    const rows = adapt(
      entryWith({ isoformIds: ['X-2'], isoformSequenceStatus: 'Described' })
    );
    expect(rows[1].description).toBe('X-2: no edits listed');
  });

  it('draws no row for a Not described isoform and names it on the canonical row', () => {
    // UniProt doesn't know its sequence (e.g. O00712-3), so a full bar
    // would wrongly say it matches the canonical.
    const rows = adapt(
      entryWith({
        name: { value: '2' },
        isoformIds: ['X-3'],
        isoformSequenceStatus: 'Not described',
      })
    );
    expect(rows.map((row) => row.accession)).toEqual(['X-1']);
    expect(rows[0].description).toBe(
      'X-1: canonical sequence; not shown (sequence not described): X-3 (isoform 2)'
    );
  });

  it('names an External isoform with no name by its id alone', () => {
    const rows = adapt(
      entryWith({ isoformIds: ['Y-1'], isoformSequenceStatus: 'External' })
    );
    expect(rows[0].description).toBe(
      'X-1: canonical sequence; not shown (External): Y-1'
    );
  });

  it('says on the canonical row too when its edits are not in the entry', () => {
    const rows = adapt({
      ...entryWith(),
      comments: [
        {
          commentType: 'ALTERNATIVE PRODUCTS',
          isoforms: [
            {
              isoformIds: ['X-1'],
              isoformSequenceStatus: 'Displayed',
              sequenceIds: ['VSP_999999'],
            },
          ],
        },
      ],
    });
    expect(rows[0].description).toBe(
      'X-1: canonical sequence; edits not in the entry: VSP_999999'
    );
  });

  it("draws nothing for an isoform's own entry rather than a false canonical row", () => {
    // P10636-8.json: Tau-F's 441 residues and every isoform, but no VAR_SEQ.
    const entry = readEntry('P10636');
    expect(
      adapt({
        ...entry,
        primaryAccession: 'P10636-8',
        sequence: { value: 'M'.repeat(441), length: 441 },
        features: undefined,
      })
    ).toEqual([]);
  });
});
