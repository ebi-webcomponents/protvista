/**
 * Collision-proof prefix for every internal CSS class and wrapper/
 * wiring DOM id. Value = sha1('protvista-uniprot@'+version).slice(0,6),
 * frozen here so the stylesheet, the render template, and the tests
 * share one literal and can never drift.
 *
 * Why a hash: our stylesheet lives in the
 * document's global selector scope (we render in light DOM because of
 * Mol*), so any third-party class name that happens to match ours can
 * collide. A hash prefix makes those collisions impossible by
 * construction. See docs/architecture-audit.md for the full rationale.
 */
export const CSS_PREFIX = 'pv-cecb45';
