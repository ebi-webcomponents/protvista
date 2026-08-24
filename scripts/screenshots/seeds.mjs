/**
 * Cold-start URL list for `--refresh-fixtures`.
 *
 * Not a contract, and not hand-maintained beyond this: a capture aborts and
 * reports anything it reaches that is not pinned, so the browser itself tells
 * you what to add. This is only the starting point on an empty `fixtures/`.
 */
import { shots } from './manifest.mjs';

/**
 * What the 3D pane fetches for one PDB entry: the residue mapping, and the
 * model itself from the PDBe model server.
 *
 * Derived from the shots rather than listed by hand. Which entry they name is
 * exactly what changed under the fixtures once already, and hand-listing is why
 * nothing noticed: the two URLs were never in this list at all, recorded ad hoc
 * when the 3D shots were added, so a cold-start recording produced a fixture
 * set those shots could not run against and only a browser could say so.
 * Tying them to `structureId` also means `screenshots-doc.spec.mjs` can assert
 * the fixtures exist for whatever the shots pin, in the ordinary unit suite.
 */
export const structureUrls = (id) => [
  `https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/${id}`,
  `https://www.ebi.ac.uk/pdbe/model-server/v1/${id.toLowerCase()}/full?encoding=bcif`,
];

export const PINNED_STRUCTURES = [
  ...new Set(shots.filter((s) => s.structureId).map((s) => s.structureId)),
];

export const SEED_URLS = [
  // Top-level sequence. Hardcoded in the component (not `sources:`-driven), so
  // every shot needs it regardless of preset.
  'https://www.ebi.ac.uk/proteins/api/proteins/P05067',
  // `sources:` in src/default-config.yaml
  'https://www.ebi.ac.uk/proteins/api/features/P05067',
  'https://www.ebi.ac.uk/proteins/api/variation/P05067',
  'https://www.ebi.ac.uk/proteins/api/antigen/P05067',
  'https://www.ebi.ac.uk/proteins/api/epitope/P05067',
  'https://www.ebi.ac.uk/proteins/api/mutagenesis/P05067',
  'https://www.ebi.ac.uk/proteins/api/rna-editing/P05067', // genuinely 404s
  'https://www.ebi.ac.uk/proteins/api/proteomics/nonPtm/P05067',
  'https://www.ebi.ac.uk/proteins/api/proteomics/ptm/P05067',
  'https://www.ebi.ac.uk/proteins/api/proteomics/hpp/P05067',
  'https://www.ebi.ac.uk/interpro/wwwapi/entry/all/protein/uniprot/P05067?type=domain&page_size=100',
  'https://alphafold.ebi.ac.uk/api/prediction/P05067',
  // The same endpoint again, with the query `<protvista-uniprot-structure>`
  // adds for itself (`Use predictions API for fetching complexes`, a6803a2).
  // Two consumers, two URLs: the config's `alphafoldPrediction:` source asks
  // without it, the structure pane with it, and a fixture is keyed by the whole
  // URL. Missing this one aborts *every* shot, structure or not, because the
  // pane mounts on every page.
  'https://alphafold.ebi.ac.uk/api/prediction/P05067?include_complexes=true',
  // Followed from the AlphaFold prediction response.
  'https://alphafold.ebi.ac.uk/files/AF-P05067-F1-confidence_v6.json',
  'https://alphafold.ebi.ac.uk/files/AF-P05067-F1-aa-substitutions.csv',
  // The playground's webfont. Recording the CSS pulls in the woff2 files it
  // references (see fixtures.mjs), so a capture needs no network at all.
  'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap',
  // The 3D pane's two list sources, both asked for on every page (the pane
  // always mounts) and both stubbed for every shot except a `structure: true`
  // one, which is served the real payload — see router.mjs. The first is
  // UniProt's own PDB cross-references, which is where the pinned entry comes
  // from: without it a `structure: true` shot resolves no structure at all.
  'https://rest.uniprot.org/uniprotkb/P05067',
  'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/P05067.json?exclude_provider=pdbe',
  // …and, for each structure a shot pins, the two URLs showing it needs.
  ...PINNED_STRUCTURES.flatMap(structureUrls),
];
