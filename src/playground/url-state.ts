/**
 * Shareable-link (de)serialisation for the configuration playground.
 *
 * The full playground state — which preset is loaded, any custom config
 * text, and the accession — round-trips through the URL **hash**
 * (`#accession=…&config=…`). The hash (not the query string) is used so
 * that a large embedded config never reaches the server's access logs
 * and never triggers a network round-trip on navigation.
 *
 * Two mutually-exclusive payloads keep shared links short when possible:
 *   - `preset=<id>`  — a built-in preset, unedited → tiny URL.
 *   - `config=<b64>` — the user's own edited text, Base64(UTF-8) encoded.
 * `config` wins when both are present (an edit supersedes its origin
 * preset).
 *
 * `encodeState`/`decodeState` are pure and DOM-free so they unit-test
 * without a browser; `readHash`/`writeHash` are the thin `location`
 * wrappers used by the page.
 */

/** Fallback accession when a link carries none (the repo's reference accession). */
export const DEFAULT_ACCESSION = 'P05067';

export interface PlaygroundState {
  /** Built-in preset id, when the link points at an unedited preset. */
  preset?: string;
  /** Raw editor text, when the link carries a custom (edited) config. */
  config?: string;
  /** UniProt accession to substitute into `{accession}` placeholders. */
  accession: string;
}

/** Base64(UTF-8) encode — handles non-ASCII config content losslessly. */
function encodeConfig(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Inverse of {@link encodeConfig}; throws on malformed Base64. */
function decodeConfig(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Serialise state to a hash string (without the leading `#`). Percent
 * encoding of the Base64 payload is handled by `URLSearchParams`.
 */
export function encodeState(state: PlaygroundState): string {
  const params = new URLSearchParams();
  params.set('accession', state.accession);
  if (state.config != null) {
    params.set('config', encodeConfig(state.config));
  } else if (state.preset) {
    params.set('preset', state.preset);
  }
  return params.toString();
}

/**
 * Parse a hash string back into state. Returns `null` when the hash
 * carries no recognised keys (a bare `#` or an unrelated fragment), so
 * the caller can fall back to its default preset. A malformed `config`
 * payload also yields `null` rather than throwing.
 */
export function decodeState(hash: string): PlaygroundState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accession = params.get('accession') || DEFAULT_ACCESSION;
  const config = params.get('config');
  const preset = params.get('preset');
  if (config != null) {
    try {
      return { accession, config: decodeConfig(config) };
    } catch {
      return null;
    }
  }
  if (preset != null) return { accession, preset };
  // Only an accession (or nothing) — not enough to restore a session.
  return params.has('accession') ? { accession } : null;
}

/**
 * Read an `accession` from a query string (e.g. `?accession=P12345`).
 * Returns the trimmed value, or `null` when absent/empty. This lets a bare
 * `/protvista/playground?accession=…` deep-link seed the viewer — a simple
 * query-string convention — alongside the richer hash-based links.
 */
export function accessionFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('accession');
  return value && value.trim() ? value.trim() : null;
}

/** Read and decode the current `location.hash`. */
export function readHash(): PlaygroundState | null {
  return decodeState(window.location.hash);
}

/**
 * Write state to `location.hash` without adding a history entry
 * (`replaceState`), so typing doesn't flood the back button.
 */
export function writeHash(state: PlaygroundState): void {
  const hash = `#${encodeState(state)}`;
  window.history.replaceState(null, '', hash);
}
