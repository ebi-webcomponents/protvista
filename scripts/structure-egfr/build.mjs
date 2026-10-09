/**
 * Generate `examples/structure-egfr/`'s data: co-crystal drug binding contacts
 * for 7 approved tyrosine kinase inhibitors (TKIs) and AMP-PNP on human EGFR
 * (P00533, 1,210 aa) from PDBe-KB residue-level ligand annotations.
 *
 *   node scripts/structure-egfr/build.mjs [--target P00533]
 *                                         [--out examples/structure-egfr]
 *                                         [--served <dir>] [--check]
 *
 * It fetches the residue-level ligand binding interactions from the PDBe-KB
 * graph API and the target sequence from UniProtKB, then writes
 * `drug-contacts.csv` and `provenance.json`.
 *
 * It also writes the CSV to the docs site's served copy
 * (`docs/public/sample-data/structure-egfr/`), which must be byte-identical to
 * `--out`'s.
 *
 * `--check` writes nothing. It recomputes from today's data and compares with
 * the committed files, ignoring only the `retrieved` dates, and exits 1 naming
 * the first difference.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DEFAULT_OUT = 'examples/structure-egfr';
const DEFAULT_SERVED = 'docs/public/sample-data/structure-egfr';
const SERVED_FILES = ['drug-contacts.csv'];

export const DRUG_CONFIGS = [
  { type: 'AFATINIB', drug: 'Afatinib', ccd: '0WN' },
  { type: 'AMP_PNP', drug: 'AMP-PNP (ATP analogue)', ccd: 'ANP' },
  { type: 'DACOMITINIB', drug: 'Dacomitinib', ccd: '1C9' },
  { type: 'ERLOTINIB', drug: 'Erlotinib', ccd: 'AQ4' },
  { type: 'GEFITINIB', drug: 'Gefitinib', ccd: 'IRE' },
  { type: 'LAPATINIB', drug: 'Lapatinib', ccd: 'FMM' },
  { type: 'NERATINIB', drug: 'Neratinib', ccd: 'HKI' },
  { type: 'OSIMERTINIB', drug: 'Osimertinib', ccd: 'YY3' },
];

/** @param {string[]} argv */
export function parseArgs(argv) {
  const options = {
    target: 'P00533',
    out: DEFAULT_OUT,
    /** @type {string | undefined} */
    served: undefined,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
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
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

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

const toTitle = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Pure function mapping raw PDBe-KB ligand entries to CSV rows.
 *
 * @param {Array<{ accession: string, residues: Array<any> }>} ligandData
 * @param {typeof DRUG_CONFIGS} drugConfigs
 */
export function buildContacts(ligandData, drugConfigs = DRUG_CONFIGS) {
  const rows = ['type,start,end,description,drug,ccd,residue,n_structures,pdb_ids,url'];
  const ligandsSummary = [];
  const allPositions = new Set();

  for (const cfg of drugConfigs) {
    const ligand = ligandData.find((x) => x.accession === cfg.ccd);
    if (!ligand) {
      throw new Error(`Ligand with CCD ${cfg.ccd} (${cfg.drug}) not found in data`);
    }

    const sortedResidues = [...ligand.residues].sort(
      (a, b) => a.startIndex - b.startIndex
    );

    ligandsSummary.push({
      type: cfg.type,
      name: cfg.drug,
      ccd: cfg.ccd,
      residues: sortedResidues.length,
    });

    for (const res of sortedResidues) {
      const start = res.startIndex;
      const end = res.endIndex;
      allPositions.add(start);

      const aa = toTitle(res.startCode);
      const residueLabel = `${aa}${start}`;
      const pdbs = (
        res.allPDBEntries ||
        (res.interactingPDBEntries ?? []).map((e) => e.pdbId)
      ).sort();
      const uniquePdbs = Array.from(new Set(pdbs));
      const count = uniquePdbs.length;
      const pdbListStr = uniquePdbs.join(' ');
      const firstPdb = uniquePdbs[0];
      const samplePdbs =
        count > 5
          ? `${uniquePdbs.slice(0, 5).join(', ')}, …`
          : uniquePdbs.join(', ');

      const desc =
        count === 1
          ? `${cfg.drug} contacts ${residueLabel} in 1 PDB entry (${samplePdbs})`
          : `${cfg.drug} contacts ${residueLabel} in ${count} PDB entries (${samplePdbs})`;

      const quotedDesc = desc.includes(',') ? `"${desc}"` : desc;
      const url = `https://www.ebi.ac.uk/pdbe/entry/pdb/${firstPdb}`;

      rows.push(
        `${cfg.type},${start},${end},${quotedDesc},${cfg.drug},${cfg.ccd},${residueLabel},${count},${pdbListStr},${url}`
      );
    }
  }

  const csvText = rows.join('\n') + '\n';
  const positions = Array.from(allPositions).sort((a, b) => a - b);

  return {
    csvText,
    summary: ligandsSummary,
    stats: {
      totalFeatures: rows.length - 1,
      uniquePositions: positions.length,
      first: positions[0],
      last: positions.at(-1),
    },
  };
}

/** @param {ReturnType<typeof parseArgs>} options */
export async function generate({ target = 'P00533' } = {}) {
  const uniprotUrl = `https://rest.uniprot.org/uniprotkb/${target}.json?fields=sequence,ft_binding,ft_act_site`;
  const pdbeUrl = `https://www.ebi.ac.uk/pdbe/graph-api/uniprot/ligand_sites/${target}`;

  const uniprotResponse = await get(uniprotUrl);
  const pdbeResponse = await get(pdbeUrl);

  const entry = JSON.parse(uniprotResponse.body.toString('utf8'));
  const sequence = entry.sequence.value;

  const pdbeData = JSON.parse(pdbeResponse.body.toString('utf8'))[target];
  if (!pdbeData || !pdbeData.data) {
    throw new Error(`No ligand interaction data found for ${target} in PDBe-KB`);
  }

  const { csvText, summary, stats } = buildContacts(pdbeData.data, DRUG_CONFIGS);

  const provenance = {
    description: `Co-crystal drug binding contacts for 7 approved TKIs and AMP-PNP on human EGFR (${target}) across solved PDB structures from PDBe-KB. Generated by scripts/structure-egfr/build.mjs; see PROVENANCE.md.`,
    target: {
      accession: target,
      name: 'Epidermal growth factor receptor (EGFR)',
      gene: 'EGFR',
      organism: 'Homo sapiens (Human)',
      url: uniprotUrl,
      uniprotRelease: uniprotResponse.headers.get('x-uniprot-release'),
      uniprotReleaseDate: uniprotResponse.headers.get('x-uniprot-release-date'),
      retrieved: uniprotResponse.retrieved,
      length: sequence.length,
      sequenceSha256: sha256(sequence),
      licence:
        'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); attribution: The UniProt Consortium, UniProtKB',
    },
    source: {
      name: 'PDBe-KB (Protein Data Bank in Europe - Knowledge Base)',
      url: pdbeUrl,
      release: '2026.1',
      retrieved: pdbeResponse.retrieved,
      licence: 'CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/)',
    },
    mapping: {
      method: 'SIFTS (Structure Integration with Function, Taxonomy and Sequence)',
      targetSequence: `Canonical human EGFR sequence (${target}-1, ${sequence.length} residues)`,
      authorNumberingNote:
        'PDB author numbering (such as L858R as L834R in mature chain numbering lacking the 24 aa signal peptide) is mapped strictly to canonical UniProt coordinates',
    },
    ligands: summary,
    result: stats,
    outputs: {
      'drug-contacts.csv': sha256(csvText),
    },
    citations: [
      'Varadi M et al. PDBe-KB: a community-driven resource for structural and functional annotations. Protein Sci 2022;31(10):e4439. doi:10.1002/pro.4439',
      'The UniProt Consortium. UniProt: the Universal Protein Knowledgebase in 2025. Nucleic Acids Res 2025;53(D1):D609-D617. doi:10.1093/nar/gkae1010',
      'Dana JM et al. SIFTS: updated Structure Integration with Function, Taxonomy and Sequences resource. Nucleic Acids Res 2019;47(D1):D482-D489. doi:10.1093/nar/gky1114',
    ],
  };

  return {
    files: {
      'drug-contacts.csv': csvText,
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
function firstLineDifference(want, got) {
  const a = want.split('\n');
  const b = got.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: ${JSON.stringify(a[i])} → ${JSON.stringify(b[i])}`;
    }
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const out = resolve(REPO_ROOT, options.out);
  const { files, provenance } = await generate(options);

  console.log(
    `EGFR P00533 ligand binding contacts: ${provenance.result.totalFeatures} features across ${provenance.result.uniquePositions} positions (${provenance.result.first}–${provenance.result.last})`
  );
  for (const lig of provenance.ligands) {
    console.log(`  - ${lig.name} (${lig.ccd}): ${lig.residues} residues`);
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

  let differences = 0;
  for (const [name, text] of Object.entries(files)) {
    let committed;
    try {
      committed = readFileSync(join(out, name), 'utf8');
    } catch {
      console.error(`${name}: missing from ${options.out}`);
      differences += 1;
      continue;
    }
    const difference = name.endsWith('.json')
      ? firstDifference(JSON.parse(committed), JSON.parse(text))
      : firstLineDifference(committed, text);
    if (difference) {
      console.error(`${name} differs (committed → today), ${difference}`);
      differences += 1;
    } else {
      console.log(`${name}: unchanged`);
    }
  }
  if (differences) process.exitCode = 1;
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
