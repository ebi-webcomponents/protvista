/**
 * Unit tests for `scripts/structure-egfr/build.mjs`.
 *
 * Tests the offline mapping, difference detection, escaping, and formatting
 * logic using fixtures without network requests. Runs under Vitest during CI.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContacts,
  checkFiles,
  csvField,
  firstDifference,
  firstLineDifference,
  main,
  parseArgs,
  DRUG_CONFIGS,
} from './build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const read = (p) => readFileSync(resolve(REPO_ROOT, p), 'utf8');
const sha256 = (t) => createHash('sha256').update(t).digest('hex');

const FIXTURE_PATH = resolve(HERE, '__fixtures__/sample-ligands.json');
const SAMPLE_LIGANDS = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('firstDifference (build.mjs --check)', () => {
  const committed = {
    target: {
      retrieved: '2026-10-09T14:57:51.000Z',
      uniprotRelease: '2026_03',
    },
    source: {
      retrieved: '2026-10-09T14:57:51.000Z',
      name: 'PDBe-KB',
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

describe('firstLineDifference (build.mjs --check)', () => {
  it('is null for identical texts', () => {
    expect(firstLineDifference('a\nb\n', 'a\nb\n')).toBeNull();
  });

  it('names the first differing line', () => {
    expect(firstLineDifference('a\nb\nc\n', 'a\nB\nC\n')).toBe(
      'line 2: "b" → "B"'
    );
  });

  it('reports a line that appeared', () => {
    expect(firstLineDifference('a\n', 'a\nb\n')).toBe('line 2: "" → "b"');
  });
});

describe('csvField', () => {
  it('leaves plain strings and numbers untouched', () => {
    expect(csvField('simple')).toBe('simple');
    expect(csvField(123)).toBe('123');
  });

  it('quotes fields containing commas, double quotes, or newlines and escapes quotes', () => {
    expect(csvField('hello, world')).toBe('"hello, world"');
    expect(csvField('say "hello"')).toBe('"say ""hello"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildContacts', () => {
  const singleConfig = [{ type: 'AFATINIB', drug: 'Afatinib', ccd: '0WN' }];

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
    // Residue 718 has 6 entries (exercising the >5 truncation branch with '…')
    expect(lines[1]).toBe(
      'AFATINIB,718,718,"Afatinib contacts Leu718 in 6 PDB entries (4g5j, 4g5p, 4i24, 5d41, 6duk, …)",Afatinib,0WN,Leu718,6,4g5j 4g5p 4i24 5d41 6duk 7k1i,https://www.ebi.ac.uk/pdbe/entry/pdb/4g5j'
    );
    // Residue 797 has 1 interacting entry
    expect(lines[2]).toBe(
      'AFATINIB,797,797,Afatinib contacts Cys797 in 1 PDB entry (4g5j),Afatinib,0WN,Cys797,1,4g5j,https://www.ebi.ac.uk/pdbe/entry/pdb/4g5j'
    );
  });

  it('prefers interactingPDBEntries over allPDBEntries for per-residue counts', () => {
    const { csvText } = buildContacts(SAMPLE_LIGANDS, singleConfig);
    const lines = csvText.trim().split('\n');
    // Residue 797 has 1 interacting PDB entry despite allPDBEntries containing 6
    const cols = lines[2].split(',');
    expect(cols[7]).toBe('1');
    expect(cols[8]).toBe('4g5j');
  });

  describe('across several drugs, with untidy PDBe-KB data', () => {
    const configs = [
      { type: 'AFATINIB', drug: 'Afatinib', ccd: '0WN' },
      { type: 'GEFITINIB', drug: 'Gefitinib', ccd: 'IRE' },
      { type: 'LAPATINIB', drug: 'Lapatinib', ccd: 'FMM' },
    ];
    const { csvText, summary, stats } = buildContacts(SAMPLE_LIGANDS, configs);
    const lines = csvText.trim().split('\n');

    it('sorts residues by position within each drug', () => {
      // The fixture lists Gefitinib's Asp800 before its Leu718.
      expect(lines.slice(3, 5).map((line) => line.split(',')[1])).toEqual([
        '718',
        '800',
      ]);
    });

    it('sorts and de-duplicates PDB ids, and links the first', () => {
      // Asp800's entries arrive unsorted, with 4i22 on chains A and B.
      expect(lines[4]).toBe(
        'GEFITINIB,800,800,"Gefitinib contacts Asp800 in 5 PDB entries (2ito, 2itz, 3ug2, 4i22, 4wkq)",Gefitinib,IRE,Asp800,5,2ito 2itz 3ug2 4i22 4wkq,https://www.ebi.ac.uk/pdbe/entry/pdb/2ito'
      );
    });

    it('lists exactly 5 PDB entries in full, with no ellipsis', () => {
      expect(lines[4]).not.toContain('…');
    });

    it('falls back to allPDBEntries when interactingPDBEntries is absent', () => {
      expect(lines[5]).toBe(
        'LAPATINIB,1002,1002,Lapatinib contacts Met1002 in 1 PDB entry (1xkk),Lapatinib,FMM,Met1002,1,1xkk,https://www.ebi.ac.uk/pdbe/entry/pdb/1xkk'
      );
    });

    it('counts residues per drug and distinct positions across drugs', () => {
      expect(summary.map((ligand) => ligand.residues)).toEqual([2, 2, 1]);
      // Leu718 is contacted by both Afatinib and Gefitinib.
      expect(stats).toEqual({
        totalFeatures: 5,
        uniquePositions: 4,
        first: 718,
        last: 1002,
      });
    });
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
    expect(opts.served).toBeUndefined();
    expect(opts.check).toBe(true);
  });

  it('takes --served alongside a custom --out', () => {
    const opts = parseArgs(['--out', 'a', '--served', 'b']);
    expect(opts.out).toBe('a');
    expect(opts.served).toBe('b');
  });

  it('refuses an unknown argument', () => {
    expect(() => parseArgs(['--outt', 'x'])).toThrow(
      'unknown argument: --outt'
    );
  });
});

describe('main (offline, with fetch stubbed)', () => {
  const ligandSites = DRUG_CONFIGS.map(({ type, ccd }) => ({
    ...SAMPLE_LIGANDS[0],
    name: type,
    accession: ccd,
  }));

  /** @param {string} url */
  const respond = async (url) => {
    const headers = {
      date: 'Thu, 29 Oct 2026 12:00:00 GMT',
      'x-uniprot-release': '2026_04',
      'x-uniprot-release-date': '28-October-2026',
    };
    const body = url.startsWith('https://rest.uniprot.org/')
      ? { sequence: { value: 'M'.repeat(1210) } }
      : { P00533: { data: ligandSites } };
    return new Response(JSON.stringify(body), { headers });
  };

  let dir = '';
  const out = () => join(dir, 'out');
  const served = () => join(dir, 'served');
  const run = (...extra) =>
    main(['--out', out(), '--served', served(), ...extra]);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  const setUp = async () => {
    dir = mkdtempSync(join(tmpdir(), 'structure-egfr-'));
    vi.stubGlobal('fetch', vi.fn(respond));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toBe(0);
  };

  it('writes both outputs and the served copy', async () => {
    await setUp();
    const csv = readFileSync(join(out(), 'drug-contacts.csv'), 'utf8');
    expect(readFileSync(join(served(), 'drug-contacts.csv'), 'utf8')).toBe(csv);
    const provenance = JSON.parse(
      readFileSync(join(out(), 'provenance.json'), 'utf8')
    );
    expect(provenance.outputs['drug-contacts.csv']).toBe(sha256(csv));
    expect(provenance.source).not.toHaveProperty('release');
  });

  it('--check exits 0 when nothing changed', async () => {
    await setUp();
    expect(await run('--check')).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('--check exits 1 when the served copy is stale', async () => {
    await setUp();
    writeFileSync(join(served(), 'drug-contacts.csv'), 'stale\n');
    expect(await run('--check')).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/served[\\/]drug-contacts\.csv differs .*line 1/)
    );
  });

  it('--check exits 1 when a committed file is missing', async () => {
    await setUp();
    unlinkSync(join(out(), 'provenance.json'));
    expect(await run('--check')).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/provenance\.json: missing$/)
    );
  });

  it('--check ignores only the retrieved dates', async () => {
    await setUp();
    const path = join(out(), 'provenance.json');
    const provenance = JSON.parse(readFileSync(path, 'utf8'));
    provenance.source.retrieved = '2020-01-01T00:00:00.000Z';
    writeFileSync(path, JSON.stringify(provenance));
    expect(await run('--check')).toBe(0);
    provenance.target.uniprotRelease = '2020_01';
    writeFileSync(path, JSON.stringify(provenance));
    expect(await run('--check')).toBe(1);
  });

  it('checkFiles leaves the served copy alone when none is given', async () => {
    await setUp();
    writeFileSync(join(served(), 'drug-contacts.csv'), 'stale\n');
    const files = {
      'drug-contacts.csv': readFileSync(
        join(out(), 'drug-contacts.csv'),
        'utf8'
      ),
    };
    expect(checkFiles(files, out())).toEqual([
      { path: join(out(), 'drug-contacts.csv'), difference: null },
    ]);
  });
});

describe('the shipped structure-egfr data', () => {
  const csvText = read('examples/structure-egfr/drug-contacts.csv');
  const provenance = JSON.parse(
    read('examples/structure-egfr/provenance.json')
  );
  // `description` is the only column that can hold a comma, so the columns
  // either side of it can be read by splitting.
  const rows = csvText
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const cols = line.split(',');
      return {
        type: cols[0],
        start: Number(cols[1]),
        end: Number(cols[2]),
        count: Number(cols.at(-3)),
        pdbIds: cols.at(-2).split(' '),
        url: cols.at(-1),
      };
    });

  it('records the same per-drug counts and totals in provenance.json', () => {
    expect(provenance.ligands.map(({ type }) => type)).toEqual(
      DRUG_CONFIGS.map(({ type }) => type)
    );
    for (const ligand of provenance.ligands) {
      expect(ligand.residues, ligand.type).toBe(
        rows.filter((row) => row.type === ligand.type).length
      );
    }
    const positions = [...new Set(rows.map((row) => row.start))].sort(
      (a, b) => a - b
    );
    expect(provenance.result).toEqual({
      totalFeatures: rows.length,
      uniquePositions: positions.length,
      first: positions[0],
      last: positions.at(-1),
    });
  });

  it('agrees with itself on every row', () => {
    for (const row of rows) {
      const where = `${row.type} ${row.start}`;
      expect(row.end, where).toBe(row.start);
      expect(row.start, where).toBeGreaterThanOrEqual(1);
      expect(row.start, where).toBeLessThanOrEqual(provenance.target.length);
      expect(row.count, where).toBe(row.pdbIds.length);
      expect(row.pdbIds, where).toEqual([...new Set(row.pdbIds)].sort());
      expect(row.url, where).toBe(
        `https://www.ebi.ac.uk/pdbe/entry/pdb/${row.pdbIds[0]}`
      );
    }
  });

  it('matches the sha256 values in provenance.json', () => {
    const servedText = read(
      'docs/public/sample-data/structure-egfr/drug-contacts.csv'
    );

    expect(servedText).toBe(csvText);
    expect(provenance.outputs).toEqual({
      'drug-contacts.csv': sha256(csvText),
    });
  });
});
