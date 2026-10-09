import type { AdapterFunction } from '../types.js';
import {
  isoformEdits,
  type Isoform,
  type IsoformEdit,
  type UniProtIsoformEntry,
} from '../../utils/isoform-map.js';

/** A highlighted canonical residue, drawn in the row's own lane. */
interface HighlightedResidue {
  /** Relative to the feature's `start`, which is always 1 here. */
  position: number;
  name: string;
}

/** One isoform row, as `nightingale-track-canvas` draws it. */
export interface IsoformFeature {
  accession: string;
  description: string;
  color: string;
  /** Always `1` and the canonical length, so no two isoforms share a row. */
  start: number;
  end: number;
  /** The canonical residues the isoform keeps or replaces; gaps are deletions. */
  locations: Array<{ fragments: Array<{ start: number; end: number }> }>;
  /** The canonical residues the isoform replaces, including insertion sites. */
  residuesToHighlight?: HighlightedResidue[];
}

const CANONICAL_COLOR = '#0053d6';
const ISOFORM_COLOR = '#888888';

/** Sequences longer than this are shortened in tooltips. */
const SHOWN_RESIDUES = 10;
const shortSequence = (sequence: string) =>
  sequence.length > SHOWN_RESIDUES
    ? `${sequence.slice(0, SHOWN_RESIDUES)}… (${sequence.length} aa)`
    : sequence;

/**
 * A replacement that keeps the original residues and adds more (`V → VPPV`,
 * `S → SATKQ…`). A longer replacement that keeps nothing (CDKN2A's
 * `DIPD → EMIGNHLWVC…`) is a plain replacement.
 */
const isInsertion = ({ original, replacement }: IsoformEdit) =>
  replacement.length > original.length &&
  (replacement.startsWith(original) || replacement.endsWith(original));

/** `289: E → V`, `108: V → VPPV (insertion)`, `290-364: missing`. */
const describeEdit = (edit: IsoformEdit) => {
  const where =
    edit.start === edit.end ? `${edit.start}` : `${edit.start}-${edit.end}`;
  if (edit.replacement === '') return `${where}: missing`;
  const change = `${shortSequence(edit.original)} → ${shortSequence(edit.replacement)}`;
  return isInsertion(edit)
    ? `${where}: ${change} (insertion)`
    : `${where}: ${change}`;
};

/**
 * Isoforms this entry can't draw: External ones are built from another
 * entry, and a Not described one's sequence is unknown.
 */
const isDrawn = (isoform: Isoform) =>
  !isoform.external && isoform.status !== 'Not described';

/** `P05067-4 (APP695)`; numbered isoforms read `P42771-4 (isoform 5)`. */
const isoformLabel = ({ id, name }: Isoform) => {
  if (!name) return id;
  return `${id} (${/^\d+$/.test(name) ? `isoform ${name}` : name})`;
};

/** The canonical residues an isoform keeps (or replaces): 1..length minus deletions. */
const keptFragments = (length: number, edits: IsoformEdit[]) => {
  const fragments: Array<{ start: number; end: number }> = [];
  let start = 1;
  edits
    .filter((edit) => edit.replacement === '')
    .forEach((deletion) => {
      if (deletion.start > start) {
        fragments.push({ start, end: deletion.start - 1 });
      }
      start = Math.max(start, deletion.end + 1);
    });
  if (start <= length) fragments.push({ start, end: length });
  return fragments;
};

const toFeature = (
  isoform: Isoform,
  length: number,
  notDrawn: Isoform[]
): IsoformFeature => {
  const notes = isoform.edits.map(describeEdit);
  if (isoform.canonical) {
    notes.push('canonical sequence');
    const external = notDrawn.filter((other) => other.external);
    const unknown = notDrawn.filter((other) => !other.external);
    if (external.length > 0) {
      notes.push(
        `not shown (External): ${external.map(isoformLabel).join(', ')}`
      );
    }
    if (unknown.length > 0) {
      notes.push(
        `not shown (sequence not described): ${unknown.map(isoformLabel).join(', ')}`
      );
    }
  }
  if (isoform.unresolved.length > 0) {
    notes.push(`edits not in the entry: ${isoform.unresolved.join(', ')}`);
  }
  if (notes.length === 0) notes.push('no edits listed');

  const residuesToHighlight = isoform.edits
    .filter((edit) => edit.replacement !== '')
    .flatMap((edit) =>
      Array.from({ length: edit.end - edit.start + 1 }, (_, i) => ({
        position: edit.start + i,
        name: describeEdit(edit),
      }))
    );

  return {
    accession: isoform.id,
    description: `${isoformLabel(isoform)}: ${notes.join('; ')}`,
    color: isoform.canonical ? CANONICAL_COLOR : ISOFORM_COLOR,
    start: 1,
    end: length,
    locations: [{ fragments: keptFragments(length, isoform.edits) }],
    ...(residuesToHighlight.length > 0 ? { residuesToHighlight } : {}),
  };
};

/**
 * `uniprot-isoforms-json` — one row per isoform of a UniProtKB entry
 * (`fields=sequence,ft_var_seq,cc_alternative_products`), on canonical
 * coordinates: the canonical as a blue reference row, each other isoform in
 * grey with a gap where it lacks residues and its replaced residues (and
 * insertion sites) highlighted in the same row. External isoforms are
 * built from another entry, and a Not described isoform's sequence is
 * unknown, so neither gets a row; the canonical row names them.
 */
export const uniprotIsoformsAdapter: AdapterFunction = (raw) => {
  const entry = (Array.isArray(raw) ? raw[0] : raw) as
    UniProtIsoformEntry | undefined;
  const length = entry?.sequence?.value?.length;
  if (!entry || !length) return [];

  const isoforms = isoformEdits(entry);
  const notDrawn = isoforms.filter((isoform) => !isDrawn(isoform));
  return isoforms
    .filter(isDrawn)
    .map((isoform) => toFeature(isoform, length, notDrawn));
};
