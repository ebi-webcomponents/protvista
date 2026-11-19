/**
 * Generate `examples/conservation/`'s data: per-residue conservation of a
 * UniProt protein from the Pfam full alignment it is a row of.
 *
 *   node scripts/conservation/build.mjs [--pfam PF00301] [--target P24297]
 *                                       [--out examples/conservation]
 *                                       [--served <dir>] [--check]
 *
 * It fetches the Pfam alignment and the InterPro release from the InterPro
 * API, and the target's sequence and binding sites from UniProt, then writes
 * `conservation.csv`, `conserved-sites.csv` and `provenance.json`. The scoring
 * is in `score.mjs`; see `examples/conservation/PROVENANCE.md` for the method.
 *
 * It also writes the two CSVs to the docs site's served copies, which must be
 * byte-identical to `--out`'s (a test checks): by default
 * `docs/public/sample-data/conservation/` when `--out` is the default, and
 * only `--served <dir>` otherwise.
 *
 * `--check` writes nothing. It recomputes from today's data and compares with
 * the committed files, served copies included, ignoring only the `retrieved`
 * dates, and exits 1 naming the first difference in each file. InterPro
 * serves only the current Pfam release, so a difference after a new release
 * is drift to review, not a bug.
 *
 * It uses the network, so it never gates a pull request: it runs by hand, and
 * `--check` runs weekly in `.github/workflows/sample-data-drift.yml`. It
 * fails loudly when the target is not exactly one row of the alignment, when
 * that row's residues differ from the UniProt sequence, or when the scored
 * residues are not one unbroken run.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  AMINO_ACIDS,
  BLOSUM62_BACKGROUND,
  GAP_CUTOFF,
  PSEUDOCOUNT,
  columnsOf,
  conservationCsv,
  conservedSitesDescription,
  henikoffWeights,
  isContiguous,
  matchColumns,
  parseStockholm,
  ranks,
  readPointCsv,
  scoreColumns,
  scoreResidues,
  sitesCsv,
  topDecileRuns,
} from './score.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DEFAULT_OUT = 'examples/conservation';
const DEFAULT_SERVED = 'docs/public/sample-data/conservation';
/** The outputs the playground fetches, so the docs site serves copies. */
const SERVED_FILES = ['conservation.csv', 'conserved-sites.csv'];

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = {
    pfam: 'PF00301',
    target: 'P24297',
    out: DEFAULT_OUT,
    /** @type {string | undefined} */
    served: undefined,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--pfam') options.pfam = argv[++i];
    else if (arg === '--target') options.target = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--served') options.served = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.served === undefined && options.out === DEFAULT_OUT) {
    options.served = DEFAULT_SERVED;
  }
  return options;
}

/** @param {string | Buffer} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * GET a URL; throws on a non-2xx answer.
 *
 * @param {string} url
 * @returns {Promise<{ body: Buffer, headers: Headers, retrieved: string }>}
 */
async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const date = response.headers.get('date');
  const retrieved = new Date(date ?? Date.now()).toISOString();
  return { body, headers: response.headers, retrieved };
}

/** `2026-03-26T00:00:00Z` → `2026-03-26`. @param {string | undefined} date */
const day = (date) => (date ? date.slice(0, 10) : undefined);

/**
 * Score a Pfam alignment and map the scores onto the target's row, refusing
 * (by throwing) when the target is not exactly one row of the alignment, when
 * that row's residues differ from the target's UniProt sequence, or when the
 * scored residues are not one unbroken run. No I/O, so the refusals can be
 * tested offline.
 *
 * @param {string} alignmentText Stockholm text.
 * @param {string} sequence The target's full UniProt sequence.
 * @param {{ pfam: string, target: string }} ids
 */
export function scoreTarget(alignmentText, sequence, { pfam, target }) {
  const { rows, annotations } = parseStockholm(alignmentText);
  const targetRows = rows.filter((row) => row.accession === target);
  if (targetRows.length !== 1) {
    throw new Error(
      `${target} is ${targetRows.length} rows of ${pfam}'s full alignment, not 1`
    );
  }
  const [row] = targetRows;
  const rowResidues = row.aligned.replace(/[.-]/g, '').toUpperCase();
  if (rowResidues !== sequence.slice(row.start - 1, row.end)) {
    throw new Error(
      `${row.name} differs from UniProt ${target} ${row.start}-${row.end}`
    );
  }

  const isMatch = matchColumns(rows);
  const columns = columnsOf(rows, isMatch);
  const scores = scoreColumns(columns, henikoffWeights(columns));
  const points = scoreResidues(row, isMatch, scores);
  if (points.length === 0 || !isContiguous(points)) {
    throw new Error(`${target}'s scored residues are not one unbroken run`);
  }
  return { rows, annotations, row, columns, points };
}

/** @param {ReturnType<typeof parseArgs>} options */
async function generate({ pfam, target }) {
  const alignmentUrl = `https://www.ebi.ac.uk/interpro/api/entry/pfam/${pfam}/?annotation=alignment:full`;
  const releaseUrl = 'https://www.ebi.ac.uk/interpro/api/';
  const uniprotUrl = `https://rest.uniprot.org/uniprotkb/${target}.json?fields=sequence,ft_binding`;

  const alignmentResponse = await get(alignmentUrl);
  const releaseResponse = await get(releaseUrl);
  const uniprotResponse = await get(uniprotUrl);

  // fetch() undoes `Content-Encoding: gzip`; this guards a body that is
  // itself gzipped.
  const raw = alignmentResponse.body;
  const alignmentBytes =
    raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  const alignmentText = alignmentBytes.toString('utf8');
  const databases = JSON.parse(releaseResponse.body.toString('utf8')).databases;
  const entry = JSON.parse(uniprotResponse.body.toString('utf8'));
  const sequence = entry.sequence.value;

  const { rows, annotations, row, columns, points } = scoreTarget(
    alignmentText,
    sequence,
    { pfam, target }
  );

  // Everything downstream uses the published (3 dp) values, so the sites
  // file can be re-derived from conservation.csv exactly.
  const conservation = conservationCsv(points);
  const published = readPointCsv(conservation);
  const sites = sitesCsv(
    topDecileRuns(published),
    conservedSitesDescription(pfam)
  );

  const rank = ranks(published);
  const knownSites = (entry.features ?? [])
    .filter((/** @type {any} */ f) => f.type === 'Binding site')
    .map((/** @type {any} */ f) => ({
      position: f.location.start.value,
      ligand: f.ligand?.name ?? '',
      rank: rank.get(f.location.start.value) ?? null,
      score:
        published.find((p) => p.position === f.location.start.value)?.value ??
        null,
    }));

  const provenance = {
    description: `Per-residue conservation of UniProt ${target} in the Pfam ${pfam} full alignment. Generated by scripts/conservation/build.mjs; see PROVENANCE.md.`,
    target: {
      accession: target,
      url: uniprotUrl,
      uniprotRelease: uniprotResponse.headers.get('x-uniprot-release'),
      uniprotReleaseDate: uniprotResponse.headers.get('x-uniprot-release-date'),
      retrieved: uniprotResponse.retrieved,
      length: sequence.length,
      sequenceSha256: sha256(sequence),
      licence:
        'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); attribution: The UniProt Consortium, UniProtKB',
    },
    alignment: {
      url: alignmentUrl,
      pfam: annotations.AC,
      name: annotations.ID,
      set: 'full',
      pfamRelease: databases.pfam.version,
      pfamReleaseDate: day(databases.pfam.releaseDate),
      interproRelease: databases.interpro.version,
      interproReleaseDate: day(databases.interpro.releaseDate),
      releaseUrl,
      retrieved: alignmentResponse.retrieved,
      bytes: alignmentBytes.length,
      sha256: sha256(alignmentBytes),
      sequences: rows.length,
      matchColumns: columns.length,
      targetRow: row.name,
      licence:
        'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/), InterPro and Pfam data',
    },
    method: {
      score:
        'Jensen-Shannon divergence from the BLOSUM62 background, times (1 - weighted gap fraction)',
      background: {
        order: AMINO_ACIDS,
        values: BLOSUM62_BACKGROUND,
        sum: Number(BLOSUM62_BACKGROUND.reduce((a, b) => a + b, 0).toFixed(3)),
        source:
          'Capra & Singh 2007, distributions/blosum62.distribution in conservation_code.tar.gz (https://compbio.cs.princeton.edu/conservation/, sha256 ee2565eb93a1e8865fdfab544b70c0b2b6199c86f81b737e17ef0f16bf2fe26c)',
        handling:
          'used as published (sum 1.002 from rounding), not renormalised, as the reference program does',
      },
      weighting:
        'Henikoff & Henikoff 1994 position-based, over match columns; gaps ignored',
      columns: 'match states only (upper case or -); inserts dropped',
      symbols: 'B as D, Z as Q, X and other letters as a gap',
      pseudocount: PSEUDOCOUNT,
      gapCutoff: `columns with more than ${GAP_CUTOFF * 100}% gaps (unweighted) are not scored`,
      window: 'none',
      precision: '3 decimal places',
      mapping: `${target} is the alignment row ${row.name}; residue numbers are counted from its /start; the row's residues were checked identical to the UniProt sequence`,
      conservedSites:
        'scores at least the value at ascending index floor(0.9 x (n - 1)) among the n scored residues, adjacent residues merged into runs',
    },
    result: {
      scoredResidues: published.length,
      first: published[0].position,
      last: published.at(-1)?.position,
      knownSites: {
        source: `UniProtKB ${target} Binding site features`,
        sites: knownSites,
      },
    },
    outputs: {
      'conservation.csv': sha256(conservation),
      'conserved-sites.csv': sha256(sites),
    },
    citations: [
      'Capra JA, Singh M. Predicting functionally important residues from sequence conservation. Bioinformatics 2007;23(15):1875-1882. doi:10.1093/bioinformatics/btm270',
      'Henikoff S, Henikoff JG. Position-based sequence weights. J Mol Biol 1994;243(4):574-578. doi:10.1016/0022-2836(94)90032-9',
      'Henikoff S, Henikoff JG. Amino acid substitution matrices from protein blocks. Proc Natl Acad Sci USA 1992;89(22):10915-10919. doi:10.1073/pnas.89.22.10915',
      'Mistry J et al. Pfam: The protein families database in 2021. Nucleic Acids Res 2021;49(D1):D412-D419. doi:10.1093/nar/gkaa913',
      'Blum M et al. InterPro: the protein sequence classification resource in 2025. Nucleic Acids Res 2025;53(D1):D444-D456. doi:10.1093/nar/gkae1082',
      'The UniProt Consortium. UniProt: the Universal Protein Knowledgebase in 2025. Nucleic Acids Res 2025;53(D1):D609-D617. doi:10.1093/nar/gkae1010',
    ],
  };

  return {
    files: {
      'conservation.csv': conservation,
      'conserved-sites.csv': sites,
      'provenance.json': JSON.stringify(provenance, null, 2) + '\n',
    },
    provenance,
  };
}

/**
 * The first difference between two JSON values, ignoring every `retrieved`
 * key, as a path; `null` when they match.
 *
 * @param {unknown} want
 * @param {unknown} got
 * @param {string} [path]
 * @returns {string | null}
 */
export function firstDifference(want, got, path = '') {
  if (
    typeof want !== 'object' ||
    want === null ||
    typeof got !== 'object' ||
    got === null
  ) {
    return want === got
      ? null
      : `${path || '(root)'}: ${JSON.stringify(want)} → ${JSON.stringify(got)}`;
  }
  const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
  for (const key of keys) {
    if (key === 'retrieved') continue;
    const difference = firstDifference(
      /** @type {any} */ (want)[key],
      /** @type {any} */ (got)[key],
      path ? `${path}.${key}` : key
    );
    if (difference) return difference;
  }
  return null;
}

/**
 * The first differing line of two texts, or `null`.
 *
 * @param {string} want
 * @param {string} got
 */
export function firstLineDifference(want, got) {
  const a = want.split('\n');
  const b = got.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: ${JSON.stringify(a[i])} → ${JSON.stringify(b[i])}`;
    }
  }
  return null;
}

/**
 * Compare freshly generated files with the committed ones in `out`, and the
 * served copies in `served` when given. JSON is compared ignoring `retrieved`
 * dates; text line by line.
 *
 * @param {Record<string, string>} files
 * @param {string} out
 * @param {string} [served]
 * @returns {Array<{ path: string, difference: string | null }>}
 */
export function checkFiles(files, out, served) {
  const committedFiles = Object.keys(files).map((name) => ({
    name,
    path: join(out, name),
  }));
  if (served) {
    for (const name of SERVED_FILES) {
      committedFiles.push({ name, path: join(served, name) });
    }
  }
  return committedFiles.map(({ name, path }) => {
    let committed;
    try {
      committed = readFileSync(path, 'utf8');
    } catch {
      return { path, difference: 'missing' };
    }
    const difference = name.endsWith('.json')
      ? firstDifference(JSON.parse(committed), JSON.parse(files[name]))
      : firstLineDifference(committed, files[name]);
    return { path, difference };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const out = resolve(REPO_ROOT, options.out);
  const { files, provenance } = await generate(options);

  for (const site of provenance.result.knownSites.sites) {
    console.log(
      `${options.target} binding site ${site.position} (${site.ligand}): rank ${site.rank}, score ${site.score}`
    );
  }

  if (!options.check) {
    mkdirSync(out, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(out, name), text);
      console.log(`wrote ${join(options.out, name)}`);
    }
    if (options.served) {
      const served = resolve(REPO_ROOT, options.served);
      mkdirSync(served, { recursive: true });
      for (const name of SERVED_FILES) {
        writeFileSync(join(served, name), files[name]);
        console.log(`wrote ${join(options.served, name)}`);
      }
    }
    return;
  }

  const served = options.served && resolve(REPO_ROOT, options.served);
  const results = checkFiles(files, out, served);
  for (const { path, difference } of results) {
    const shown = relative(REPO_ROOT, path);
    if (difference === 'missing') console.error(`${shown}: missing`);
    else if (difference) {
      console.error(`${shown} differs (committed → today), ${difference}`);
    } else console.log(`${shown}: unchanged`);
  }
  if (results.some(({ difference }) => difference)) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
