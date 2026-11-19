/**
 * Pure encode/decode + keying for persisting a customized layout. The
 * component owns the `localStorage` / URL glue (see `protvista-uniprot.ts`);
 * this module holds the parts worth testing in isolation: a stable storage
 * key derived from the config, and a compact, unicode-safe, tamper-tolerant
 * codec for the shareable `?layout=` URL parameter.
 *
 * What is persisted is a `LayoutPatch` — the diff from the authored config —
 * not the config itself. The user's edits do live in the config (see
 * `src/layout.ts`), but a whole config is far too large for a URL, so the
 * viewer stores the diff and replays it onto the authored baseline on mount.
 */
import type { NormalizedRow } from './schema/normalize.js';
import { isDefaultPatch, type LayoutPatch } from './layout.js';

/** The query-string parameter carrying a shareable layout. */
export const LAYOUT_PARAM = 'layout';

/** `localStorage` key namespace; the config identity is appended. */
export const STORAGE_PREFIX = 'protvista-layout';

/** FNV-1a → base36. Small, dependency-free, good enough for a storage key. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A stable identity for a config's track set, so a saved layout re-applies
 * to every protein viewed with the same config (per-config, not
 * per-accession). Reorder-invariant (rows and each row's tracks are sorted by
 * id) but sensitive to which rows/tracks exist, so reordering the authored
 * config keeps a saved layout while adding or removing a track yields a fresh
 * identity.
 *
 * Encoded as JSON, not a delimiter-joined string: a flat join over `row.id` +
 * `${row.id}-${track.id}` tokens blurs id boundaries, so two genuinely
 * different configs could hash alike and mis-share a layout when an id
 * contains a hyphen. Nesting track ids under their row keeps them unambiguous.
 */
export function configIdentity(rows: readonly NormalizedRow[]): string {
  const canonical = rows
    .map((row) => [row.id, row.tracks.map((t) => t.id).sort()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return fnv1a(JSON.stringify(canonical));
}

/** Full `localStorage` key for a config identity. */
export function storageKey(identity: string): string {
  return `${STORAGE_PREFIX}:${identity}`;
}

/** True when the patch is the authored default (nothing to persist). */
export function isDefaultLayout(patch: LayoutPatch): boolean {
  return isDefaultPatch(patch);
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(token: string): string {
  const binary = atob(token);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode a patch as a compact base64 token for the `?layout=` URL. */
export function encodeLayout(patch: LayoutPatch): string {
  return toBase64(
    JSON.stringify({
      order: patch.order,
      tracks: patch.tracks,
      hidden: patch.hidden,
    })
  );
}

/** A string array, or `null` if the value is anything else. */
function idList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((x) => typeof x === 'string')
    ? (value as string[])
    : null;
}

/**
 * Whether an untrusted value is a non-null object whose entries can be
 * walked. Arrays pass too (their entries are index-keyed), matching the
 * `typeof === 'object'` guard the decoder has always used.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

/**
 * The entries of an untrusted object that `pick` accepts (returns non-`null`
 * for), copied into a fresh `Object.create(null)` map — so a `__proto__` or
 * `constructor` key lands as a plain own key and can never reach a prototype.
 * Anything that is not an object yields an empty map.
 */
function pickEntries<T>(
  value: unknown,
  pick: (entry: unknown) => T | null
): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    const picked = pick(entry);
    if (picked !== null) out[key] = picked;
  }
  return out;
}

/** The boolean entries of an untrusted object; other entries are dropped. */
export function boolMap(value: unknown): Record<string, boolean> {
  return pickEntries(value, (v) => (typeof v === 'boolean' ? v : null));
}

/**
 * A two-level `boolMap` (row id → track id → boolean). A row whose value is
 * not an object, or that holds no boolean entries, is dropped entirely rather
 * than kept as an empty map.
 */
export function nestedBoolMap(
  value: unknown
): Record<string, Record<string, boolean>> {
  return pickEntries(value, (inner) => {
    const map = boolMap(inner);
    return Object.keys(map).length > 0 ? map : null;
  });
}

/**
 * Decode a `?layout=` / stored token back to a `LayoutPatch`, or `null` if it
 * is missing or malformed. Defensive: a hand-edited URL or a stale storage
 * entry must never throw or inject a wrong-typed patch — unknown shapes
 * degrade to `null`, and entries of the wrong type are dropped individually
 * so one bad key does not discard an otherwise good layout.
 */
export function decodeLayout(token: string | null): LayoutPatch | null {
  if (!token) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64(token));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const hidden: Record<string, unknown> = isRecord(parsed.hidden)
    ? parsed.hidden
    : {};
  return {
    order: idList(parsed.order),
    tracks: pickEntries(parsed.tracks, idList),
    hidden: {
      rows: boolMap(hidden.rows),
      tracks: nestedBoolMap(hidden.tracks),
    },
  };
}
