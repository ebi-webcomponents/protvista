/**
 * Shared shape predicates for the schema layer.
 *
 * The validator needs to answer two questions before Ajv runs — "is this
 * a plain object that could carry a field?" and "did the author actually
 * set this field?" — and they express a single shared notion of "set"
 * across the schema layer. Keeping them here rather than inline in
 * `validate.ts` lets other schema-layer callers reuse them without the
 * definitions drifting.
 */

/**
 * A plain (non-null, non-array) object — the only shape that can carry a
 * named field like `rows:`, `tracks:`, or `data:`. Anything else (a bare
 * string, a number, `null`, an array) passes through untouched; the
 * validator surfaces a readable schema error for it.
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Whether a field was actually set by the author. An empty YAML key
 * (`tracks:` / `rows:` / `data:` with nothing after it) parses to
 * `null` — a leftover stub, not a value — so `null` counts as unset
 * alongside `undefined`. Deciding presence by key existence instead
 * would treat a blank line (common right after a rename) as a real
 * value: reading a bare `tracks:` as an empty group, or flagging an
 * entry that carries nothing as a both-fields conflict.
 */
export function isSet(v: unknown): boolean {
  return v !== undefined && v !== null;
}
