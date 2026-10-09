// Plain-JS twin of the built-in adapter for hackathon demo pages.
// Loads from published jsDelivr build, so it must run standalone.

// Helper to read each edit once, as requested in Step 6
function getEdit(feature) {
  const loc = feature.location;
  const start = loc.start ? loc.start.value : loc.position.value;
  const end = loc.end ? loc.end.value : loc.position.value;
  const original = feature.alternativeSequence?.originalSequence ?? '';
  const replacement = feature.alternativeSequence?.alternativeSequences?.[0] ?? '';
  const deletion = replacement === '';
  return { start, end, original, replacement, deletion };
}

function fmtSeq(seq) {
  if (seq.length > 10) return `${seq.slice(0, 10)}… (${seq.length} aa)`;
  return seq;
}

function formatEdit(edit) {
  const range = edit.start === edit.end ? `${edit.start}` : `${edit.start}-${edit.end}`;
  if (edit.deletion) return `${range}: missing`;
  // An insertion keeps the original residues and adds more (V → VPPV); a longer
  // replacement that keeps nothing (CDKN2A's DIPD → EMIGNHLWVC…) is not one.
  const isInsertion =
    edit.replacement.length > edit.original.length &&
    (edit.replacement.startsWith(edit.original) || edit.replacement.endsWith(edit.original));
  const insText = isInsertion ? ' (insertion)' : '';
  return `${range}: ${fmtSeq(edit.original)} → ${fmtSeq(edit.replacement)}${insText}`;
}

export function isoformEdits(entry) {
  // An isoform's own entry (P10636-8.json, even P10636-1.json) has no VAR_SEQ
  // features, so no isoform can be built from it: only P10636.json has the edits.
  if (/-\d+$/.test(entry?.primaryAccession ?? '')) return [];
  const comment = (entry.comments || []).find((c) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!comment) return [];

  const vspMap = new Map(
    (entry.features || [])
      .filter((f) => f.type === 'Alternative sequence')
      .map((f) => [f.featureId, f])
  );

  return comment.isoforms.map((isoform) => {
    const id = isoform.isoformIds[0];
    const status = isoform.isoformSequenceStatus;
    const external = status === 'External';
    const canonical = status === 'Displayed';
    const name = isoform.name?.value || isoform.name || '';

    const edits = [];
    const unresolved = [];

    if (!external && isoform.sequenceIds) {
      for (const seqId of isoform.sequenceIds) {
        const feature = vspMap.get(seqId);
        if (feature) {
          edits.push({ featureId: seqId, ...getEdit(feature) });
        } else {
          unresolved.push(seqId);
        }
      }
    }

    edits.sort((a, b) => a.start - b.start);
    return { id, name, status, canonical, external, edits, unresolved };
  });
}

// `P05067-4 (APP695)`; numbered isoforms read `P42771-4 (isoform 5)`.
function isoformLabel(isoform) {
  if (!isoform.name) return isoform.id;
  const name = /^\d+$/.test(isoform.name) ? `isoform ${isoform.name}` : isoform.name;
  return `${isoform.id} (${name})`;
}

// External isoforms are built from another entry, and a Not described one's
// sequence is unknown: neither gets a row, and the canonical row names them.
const isDrawn = (isoform) => !isoform.external && isoform.status !== 'Not described';

export function uniprotIsoforms(data) {
  const entry = Array.isArray(data) ? data[0] : data;
  const canonicalLength = entry?.sequence?.value?.length;
  if (!canonicalLength) return [];

  const isoforms = isoformEdits(entry);
  const external = isoforms.filter((i) => i.external);
  const unknown = isoforms.filter((i) => !i.external && !isDrawn(i));

  return isoforms.filter(isDrawn).map((isoform) => {
    const notes = isoform.edits.map(formatEdit);
    if (isoform.canonical) {
      notes.push('canonical sequence');
      if (external.length > 0) {
        notes.push(`not shown (External): ${external.map(isoformLabel).join(', ')}`);
      }
      if (unknown.length > 0) {
        notes.push(`not shown (sequence not described): ${unknown.map(isoformLabel).join(', ')}`);
      }
    }
    if (isoform.unresolved.length > 0) {
      notes.push(`edits not in the entry: ${isoform.unresolved.join(', ')}`);
    }
    if (notes.length === 0) notes.push('no edits listed');

    const fragments = [];
    const residuesToHighlight = [];
    let current = 1;
    for (const edit of isoform.edits) {
      if (edit.deletion) {
        if (edit.start > current) fragments.push({ start: current, end: edit.start - 1 });
        current = Math.max(current, edit.end + 1);
      } else {
        const name = formatEdit(edit);
        for (let p = edit.start; p <= edit.end; p++) residuesToHighlight.push({ position: p, name });
      }
    }
    if (current <= canonicalLength) fragments.push({ start: current, end: canonicalLength });

    const feature = {
      accession: isoform.id,
      description: `${isoformLabel(isoform)}: ${notes.join('; ')}`,
      color: isoform.canonical ? '#0053d6' : '#888888',
      start: 1,
      end: canonicalLength,
      locations: [{ fragments }],
    };
    if (residuesToHighlight.length > 0) feature.residuesToHighlight = residuesToHighlight;
    return feature;
  });
}

export function canonicalToIsoformMap(entry, isoformId) {
  const isoform = isoformEdits(entry).find((i) => i.id === isoformId);
  if (!isoform) {
    throw new Error(`${isoformId} is not listed as an isoform of ${entry?.primaryAccession}`);
  }
  if (isoform.external) {
    throw new Error(`${isoformId} is an External isoform: it has no edits to the canonical, so it cannot be aligned`);
  }
  if (isoform.status === 'Not described') {
    throw new Error(`${isoformId}'s sequence is not described, so it cannot be aligned`);
  }
  if (isoform.unresolved.length > 0) {
    throw new Error(`${isoformId} needs edits the entry does not have (${isoform.unresolved.join(', ')}), so it cannot be aligned`);
  }
  const length = entry.sequence.length || entry.sequence.value?.length;
  const map = new Array(length + 1).fill(null);
  let canonical = 1;
  let position = 0;
  for (const e of isoform.edits) {
    while (canonical < e.start) map[canonical++] = ++position;
    position += e.replacement.length; // '' for a deletion
    canonical = Math.max(canonical, e.end + 1);
  }
  while (canonical <= length) map[canonical++] = ++position;
  return map;
}

export function projectFeatures(features, entry, isoformId) {
  const map = canonicalToIsoformMap(entry, isoformId);
  const projected = [];
  const dropped = [];
  for (const feature of features || []) {
    const begin = Number(feature.begin ?? feature.start);
    const end = Number(feature.end ?? begin);
    if (!Number.isInteger(begin) || !Number.isInteger(end)) {
      dropped.push(feature); 
      continue;
    }
    const kept = [];
    for (let c = begin; c <= end; c++) if (map[c] != null) kept.push(map[c]);
    if (kept.length === 0) {
      dropped.push(feature);
      continue;
    }
    const start = Math.min(...kept);
    const stop = Math.max(...kept);
    const total = end - begin + 1;
    const partly = kept.length < total;
    const note = partly
      ? `canonical ${begin}-${end}; partly missing in ${isoformId}: ${kept.length} of ${total} residues kept`
      : `canonical ${begin}-${end}`;
    
    projected.push({
      ...feature,
      begin: start,
      start,
      end: stop,
      locations: [{ fragments: [{ start, end: stop }] }],
      description: `${feature.description ? `${feature.description} ` : ''}[${note}]`,
      ...(partly ? { partlyMissing: true } : {}),
    });
  }
  return { projected, dropped, droppedCount: dropped.length };
}

/**
 * Adapter factory. `data: { source: [features, entry], adapter }` calls the
 * adapter with one argument per source: adapter(featuresBody, entryBody).
 */
export const projectTo = (isoformId) => (featuresBody, entry) =>
  projectFeatures(featuresBody?.features, entry, isoformId).projected;
