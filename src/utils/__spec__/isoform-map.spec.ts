import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isoformEdits, buildIsoform, isoformPositionMap } from '../isoform-map.js';

const fixturesDir = path.join(__dirname, '../../__fixtures__/isoforms');

function readEntry(acc: string) {
  const file = path.join(fixturesDir, `${acc}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing fixture: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readFasta(acc: string) {
  const file = path.join(fixturesDir, `${acc}.fasta`);
  if (!fs.existsSync(file)) throw new Error(`Missing fixture: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const blocks = text.trim().split('>').filter(Boolean);
  const fasta = new Map<string, string>();
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0];
    const seq = lines.slice(1).join('').trim();
    const match = header.match(/\|([^|]+)\|/);
    if (match) fasta.set(match[1], seq);
  }
  return fasta;
}

describe('isoform-map', () => {
  it('rebuilds sequences exactly matching UniProt FASTA and handles insertions/deletions', () => {
    const proteins = ['P05067', 'P04637', 'P10636', 'P42771', 'A0A1B0GTW7'];
    
    for (const acc of proteins) {
      const entry = readEntry(acc);
      const fasta = readFasta(acc);
      const isoforms = isoformEdits(entry);
      
      for (const iso of isoforms) {
        if (iso.external) continue;
        
        // Canonical IDs in FASTA sometimes lack the -1 suffix, so fallback safely
        const expectedSeq = fasta.get(iso.id) || (iso.canonical ? fasta.get(acc) : undefined);
        expect(expectedSeq).toBeDefined();
        
        // FIX: pass entry.sequence.value, not the object itself
        const rebuilt = buildIsoform(entry.sequence.value, iso.edits);
        expect(rebuilt).toBe(expectedSeq);
        
        const map = isoformPositionMap(entry, iso.id);
        expect(map).not.toBeNull();
        
        if (map) {
          for (let i = 1; i <= entry.sequence.length; i++) {
            const isoPos = map.canonicalToIsoform(i);
            if (isoPos !== null) {
              expect(map.isoformToCanonical(isoPos)).toBe(i);
              // FIX: compare against entry.sequence.value
              expect(entry.sequence.value[i - 1]).toBe(expectedSeq![isoPos - 1]);
            }
          }
        }
      }
    }
  });

  it('flags ARF (CDKN2A) as external with no edits', () => {
    const entry = readEntry('P42771');
    const isoforms = isoformEdits(entry);
    const arf = isoforms.find(i => i.id === 'Q8N726-1');
    expect(arf).toBeDefined();
    expect(arf?.external).toBe(true);
    expect(arf?.edits).toHaveLength(0);
    expect(isoformPositionMap(entry, 'Q8N726-1')).toBeNull();
  });

  it('tracks unresolved sequence IDs', () => {
    const entry = readEntry('P05067');
    // Artificially break a mapping to test tracking
    entry.features = entry.features.filter((f: any) => f.featureId !== 'VSP_000002');
    const isoforms = isoformEdits(entry);
    const affected = isoforms.find(i => i.unresolved.includes('VSP_000002'));
    expect(affected).toBeDefined();
  });
});

describe('isoform-map: edits, insertions and entries it cannot map', () => {
  // A minimal entry with one isoform of the given status.
  const withStatus = (status: 'Described' | 'Not described') => ({
    sequence: { value: 'MAAA', length: 4 },
    comments: [
      {
        commentType: 'ALTERNATIVE PRODUCTS',
        isoforms: [
          { isoformIds: ['X-1'], isoformSequenceStatus: 'Displayed' as const },
          { isoformIds: ['X-2'], isoformSequenceStatus: status },
        ],
      },
    ],
  });

  it('reads a deletion ({}) as an empty replacement and a replacement as its residues', () => {
    const entry = readEntry('P05067');
    const app4 = isoformEdits(entry).find((i) => i.id === 'P05067-4');
    expect(app4?.edits).toEqual([
      { featureId: 'VSP_000002', start: 289, end: 289, original: 'E', replacement: 'V' },
      {
        featureId: 'VSP_000004',
        start: 290,
        end: 364,
        // A deletion has no originalSequence, so it is read from the canonical.
        original: entry.sequence.value.slice(289, 364),
        replacement: '',
      },
    ]);
  });

  it('maps inserted residues to null (CIROP isoform 3: V108 becomes VPPV)', () => {
    const map = isoformPositionMap(readEntry('A0A1B0GTW7'), 'A0A1B0GTW7-3');
    expect(map?.canonicalToIsoform(107)).toBe(107);
    expect(map?.canonicalToIsoform(108)).toBeNull();
    expect([108, 109, 110, 111].map((p) => map?.isoformToCanonical(p))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(map?.canonicalToIsoform(109)).toBe(112);
    expect(map?.isoformToCanonical(112)).toBe(109);
  });

  it('returns no isoforms for a comment without isoforms', () => {
    expect(
      isoformEdits({ comments: [{ commentType: 'ALTERNATIVE PRODUCTS' }] })
    ).toEqual([]);
  });

  it('has no position map for an entry without a sequence', () => {
    const entry = { ...readEntry('P05067'), sequence: undefined };
    expect(isoformPositionMap(entry, 'P05067-4')).toBeNull();
  });

  it('has no position map for an isoform whose edits are missing', () => {
    const entry = { ...readEntry('P05067'), features: [] };
    expect(isoformPositionMap(entry, 'P05067-4')).toBeNull();
  });

  it('has no position map for a Not described isoform, whose sequence is unknown', () => {
    expect(isoformPositionMap(withStatus('Described'), 'X-2')).not.toBeNull();
    expect(isoformPositionMap(withStatus('Not described'), 'X-2')).toBeNull();
  });

  it("returns no isoforms for an isoform's own entry, which has no VAR_SEQ", () => {
    // What UniProt returns for P10636-8.json: Tau-F's 441 residues and the
    // full ALTERNATIVE PRODUCTS comment, but no features.
    const tau = readEntry('P10636');
    const tauF = {
      ...tau,
      primaryAccession: 'P10636-8',
      sequence: { value: readFasta('P10636').get('P10636-8'), length: 441 },
      features: undefined,
    };
    expect(isoformEdits(tauF)).toEqual([]);
    expect(isoformPositionMap(tauF, 'P10636-8')).toBeNull();
    // Even the canonical's own -1 entry has no edits to read.
    expect(isoformEdits({ ...tau, primaryAccession: 'P10636-1' })).toEqual([]);
  });
});
