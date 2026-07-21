import { tokenDefaultsBlock } from './tokens';

/**
 * Shared light-DOM stylesheet injection.
 *
 * Both `<protvista-uniprot>` and `<protvista-uniprot-structure>` render
 * in light DOM (because of Mol*), so their styles live in the document's
 * global scope rather than a shadow root. Every instance on a page
 * shares one `<style>` node per key: the first mount installs it, later
 * mounts are no-ops. Keys are used (rather than one blob) so the token
 * defaults and the loader styles are installed once and shared, while
 * each component owns its own component-styles sheet.
 *
 * These sheets are install-once and page-lifetime: they are never
 * removed on disconnect, because a single shared node backs every
 * instance — tearing it down when one element unmounts would strip
 * styling from the others still on the page.
 */

const MARKER = 'data-protvista-style';

/** Idempotently install a keyed `<style>` into `<head>`. */
export function injectStyleOnce(key: string, cssText: string): void {
  if (typeof document === 'undefined') return;
  const head = document.head;
  if (!head) return;
  if (head.querySelector(`style[${MARKER}="${key}"]`)) return;
  const styleTag = document.createElement('style');
  styleTag.setAttribute(MARKER, key);
  styleTag.textContent = cssText;
  head.append(styleTag);
}

/**
 * The `--protvista-*` design-token defaults, declared on `:where(:root)`.
 *
 * Declaring on the document root (not on the host tags) is what makes
 * the documented theming recipes work: a value declared *directly* on an
 * element always beats one *inherited* from an ancestor, so putting the
 * defaults on the host element would shadow a consumer's
 * `:root { --protvista-…: … }` override. On `:root` instead, the value
 * inherits down to every viewer element (and into child shadow roots),
 * and any consumer override — on `:root`, on an ancestor, on the host
 * element, or inline via `style.setProperty` — takes precedence.
 *
 * `:where(:root)` keeps the defaults at specificity 0 so that even a
 * consumer's own `:root { … }` rule (specificity 0,1,0) wins, regardless
 * of source order — our sheet is injected late, at mount time.
 *
 * Computed once at module load rather than per `addStyles()` call.
 */
const TOKEN_DEFAULTS_CSS = tokenDefaultsBlock(':where(:root)');

/** Install the token defaults once for the whole page. */
export function installTokenDefaults(): void {
  injectStyleOnce('tokens', TOKEN_DEFAULTS_CSS);
}
