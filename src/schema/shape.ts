/**
 * Shared shape predicates for the schema layer.
 *
 * `rows-alias.ts` and `validate.ts` both need to answer the same two
 * questions before Ajv runs — "is this a plain object that could carry a
 * field?" and "did the author actually set this field?" — and both had
 * their own copy. The copies were byte-identical and their doc comments
 * asserted a single shared notion ("one notion of 'set' across the schema
 * layer"), so they belong in one place where they cannot drift.
 */

/**
 * A plain (non-null, non-array) object — the only shape that can carry a
 * named field like `rows:`, `groups:`, `tracks:`, or `data:`. Anything
 * else (a bare string, a number, `null`, an array) passes through
 * untouched; the validator surfaces a readable schema error for it.
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Whether a field was actually set by the author. An empty YAML key
 * (`tracks:` / `rows:` / `groups:` with nothing after it) parses to
 * `null` — a leftover stub, not a value — so `null` counts as unset
 * alongside `undefined`. Deciding presence by key existence instead
 * would treat a blank line (common right after a rename) as a real
 * value: rejecting it as a both-fields conflict, firing the deprecation
 * warning for a field carrying nothing, or reading a bare `tracks:` as
 * an empty group.
 */
export function isSet(v: unknown): boolean {
  return v !== undefined && v !== null;
}
