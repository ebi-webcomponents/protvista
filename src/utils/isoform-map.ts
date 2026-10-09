/**
 * Canonical ↔ isoform mapping from a UniProt entry's own data.
 *
 * A UniProtKB entry lists its isoforms in the ALTERNATIVE PRODUCTS comment
 * and the edits that build each one from the canonical sequence as
 * "Alternative sequence" (VAR_SEQ) features. Each isoform names its edits in
 * `sequenceIds`, which are the VAR_SEQ `featureId`s; joining on those ids
 * (never on the free-text "in isoform APP639" descriptions) and applying the
 * edits rebuilds the isoform exactly as UniProt's FASTA has it.
 *
 * Fetch the entry with `fields=sequence,ft_var_seq,cc_alternative_products`.
 */

/** The four `isoformSequenceStatus` values UniProt uses. */
export type IsoformSequenceStatus =
  'Displayed' | 'Described' | 'External' | 'Not described';

/** One isoform in the ALTERNATIVE PRODUCTS comment. */
export interface UniProtIsoform {
  name?: { value: string };
  synonyms?: Array<{ value: string }>;
  isoformIds: string[];
  /**
   * `Displayed` is the canonical (not always `-1`); `External` isoforms are
   * described in another entry (CDKN2A's ARF is read in another frame) and
   * cannot be built from this one's edits; a `Not described` isoform's
   * sequence is unknown (it has no `sequenceIds`).
   */
  isoformSequenceStatus: IsoformSequenceStatus;
  /** The VAR_SEQ `featureId`s that build this isoform from the canonical. */
  sequenceIds?: string[];
}

export interface UniProtComment {
  commentType: string;
  isoforms?: UniProtIsoform[];
}

/**
 * A VAR_SEQ feature. UniProt writes a deleted ("Missing") segment as
 * `alternativeSequence: {}`, and a replacement as
 * `{ originalSequence: 'E', alternativeSequences: ['V'] }`.
 */
export interface UniProtAlternativeSequenceFeature {
  type: string;
  featureId?: string;
  location: { start: { value: number }; end: { value: number } };
  alternativeSequence?: {
    originalSequence?: string;
    alternativeSequences?: string[];
  };
}

/** The subset of a UniProtKB entry (REST JSON) the mapper reads. */
export interface UniProtIsoformEntry {
  primaryAccession?: string;
  sequence?: { value: string; length: number };
  comments?: UniProtComment[];
  features?: UniProtAlternativeSequenceFeature[];
}

/** One edit, on canonical coordinates (1-based, inclusive). */
export interface IsoformEdit {
  featureId: string;
  start: number;
  end: number;
  /** The canonical residues `start..end`. */
  original: string;
  /** What the isoform has instead: `''` for a deletion. */
  replacement: string;
}

export interface Isoform {
  /** The isoform's first id, e.g. `P05067-4`. */
  id: string;
  name: string;
  status: IsoformSequenceStatus;
  canonical: boolean;
  external: boolean;
  /** In canonical order; empty for the canonical and External isoforms. */
  edits: IsoformEdit[];
  /** `sequenceIds` with no VAR_SEQ feature in the entry. */
  unresolved: string[];
}

export interface PositionMap {
  /** The isoform residue for a canonical one, or `null` if it has none. */
  canonicalToIsoform: (pos: number) => number | null;
  /** The canonical residue for an isoform one, or `null` if it has none. */
  isoformToCanonical: (pos: number) => number | null;
  isoformLength: number;
}

const ALTERNATIVE_SEQUENCE = 'Alternative sequence';

const toEdit = (
  feature: UniProtAlternativeSequenceFeature,
  canonical: string
): IsoformEdit => {
  const start = feature.location.start.value;
  const end = feature.location.end.value;
  const alternative = feature.alternativeSequence;
  return {
    featureId: feature.featureId ?? '',
    start,
    end,
    original: alternative?.originalSequence ?? canonical.slice(start - 1, end),
    // `{}` is a deletion: there is no alternative sequence to read.
    replacement: alternative?.alternativeSequences?.[0] ?? '',
  };
};

/**
 * True for an isoform's own entry (`P10636-8.json`, even `P10636-1.json`):
 * UniProt answers it with that isoform's sequence and the full ALTERNATIVE
 * PRODUCTS comment, but no VAR_SEQ features, so no isoform can be built from
 * it. Only the canonical entry (`P10636.json`) has the edits.
 */
const isIsoformEntry = (entry: UniProtIsoformEntry) =>
  /-\d+$/.test(entry.primaryAccession ?? '');

/**
 * Every isoform the entry lists, in UniProt's order, with the edits that
 * build it. An entry without an ALTERNATIVE PRODUCTS comment has none, and
 * so does an isoform's own entry (see {@link isIsoformEntry}).
 */
export function isoformEdits(entry: UniProtIsoformEntry): Isoform[] {
  if (isIsoformEntry(entry)) return [];
  const isoforms =
    entry.comments?.find(
      (comment) => comment.commentType === 'ALTERNATIVE PRODUCTS'
    )?.isoforms ?? [];
  const canonical = entry.sequence?.value ?? '';
  const varSeqs = new Map<string, UniProtAlternativeSequenceFeature>();
  entry.features?.forEach((feature) => {
    if (feature.type === ALTERNATIVE_SEQUENCE && feature.featureId) {
      varSeqs.set(feature.featureId, feature);
    }
  });

  return isoforms.map((isoform) => {
    const external = isoform.isoformSequenceStatus === 'External';
    const edits: IsoformEdit[] = [];
    const unresolved: string[] = [];
    if (!external) {
      isoform.sequenceIds?.forEach((id) => {
        const feature = varSeqs.get(id);
        if (feature) edits.push(toEdit(feature, canonical));
        else unresolved.push(id);
      });
    }
    edits.sort((a, b) => a.start - b.start);
    return {
      id: isoform.isoformIds[0],
      name: isoform.name?.value ?? '',
      status: isoform.isoformSequenceStatus,
      canonical: isoform.isoformSequenceStatus === 'Displayed',
      external,
      edits,
      unresolved,
    };
  });
}

/** Apply `edits` (canonical coordinates, non-overlapping) to `canonical`. */
export function buildIsoform(canonical: string, edits: IsoformEdit[]): string {
  // Right to left, so an edit never shifts the ones still to apply.
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (sequence, edit) =>
        sequence.slice(0, edit.start - 1) +
        edit.replacement +
        sequence.slice(edit.end),
      canonical
    );
}

/**
 * Residue-to-residue maps between the canonical and an isoform. A canonical
 * residue an edit deletes or replaces has no isoform counterpart, and the
 * residues an edit puts in its place (replacements, insertions) have no
 * canonical one; both map to `null`, as does any position outside the
 * sequence.
 */
export function canonicalToIsoformMap(
  canonicalLength: number,
  edits: IsoformEdit[]
): PositionMap {
  const canToIso: Array<number | null> = [null];
  const isoToCan: Array<number | null> = [null];
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let next = 0;
  let pos = 1;
  while (pos <= canonicalLength) {
    const edit = sorted[next];
    if (edit && pos === edit.start) {
      for (; pos <= edit.end; pos += 1) canToIso.push(null);
      for (let i = 0; i < edit.replacement.length; i += 1) isoToCan.push(null);
      next += 1;
    } else {
      canToIso.push(isoToCan.length);
      isoToCan.push(pos);
      pos += 1;
    }
  }
  const lookup = (table: Array<number | null>) => (p: number) =>
    Number.isInteger(p) && p > 0 && p < table.length ? table[p] : null;
  return {
    canonicalToIsoform: lookup(canToIso),
    isoformToCanonical: lookup(isoToCan),
    isoformLength: isoToCan.length - 1,
  };
}

/**
 * The position map for one isoform of `entry`, or `null` for an External
 * isoform (its sequence is not built from this entry), a Not described one
 * (its sequence is unknown), an unknown id, or an isoform with edits missing
 * from the entry (a map without them is wrong).
 */
export function isoformPositionMap(
  entry: UniProtIsoformEntry,
  isoformId: string
): PositionMap | null {
  const isoform = isoformEdits(entry).find(({ id }) => id === isoformId);
  if (
    !isoform ||
    isoform.external ||
    isoform.status === 'Not described' ||
    isoform.unresolved.length > 0 ||
    !entry.sequence
  ) {
    return null;
  }
  return canonicalToIsoformMap(entry.sequence.value.length, isoform.edits);
}
