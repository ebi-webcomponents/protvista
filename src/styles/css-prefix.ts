/**
 * Collision-proof prefix for every internal CSS class and wrapper/
 * wiring DOM id. Value = sha1('protvista-uniprot@'+<release version>).slice(0,6),
 * keyed to the 5.0.0 release line — the base version, ignoring any
 * pre-release suffix (`-beta.1`, `-rc.1`) — so the prefix stays stable
 * across 5.0.0-beta.1 → 5.0.0 rather than churning every pre-release
 * (it is not part of the compatibility contract; see architecture-audit §C).
 * Frozen here so the stylesheet, the render template, and the tests
 * share one literal and can never drift.
 *
 * Why a hash: our stylesheet lives in the
 * document's global selector scope (we render in light DOM because of
 * Mol*), so any third-party class name that happens to match ours can
 * collide. A hash prefix makes those collisions impossible by
 * construction. See docs/architecture-audit.md for the full rationale.
 */
export const CSS_PREFIX = 'pv-cecb45';
