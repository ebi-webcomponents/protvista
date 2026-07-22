/**
 * Setup for the `browser` Vitest project (Playwright/Chromium).
 *
 * The browser specs mount the real `<protvista-uniprot>` element to
 * exercise rendered DOM, keyboard operability and axe-core assertions.
 * That element imports every `@nightingale-elements/*` package, which
 * pulls d3 / Mol* / canvas layout work we neither need nor want inside
 * an accessibility test. Reuse the exact same stubs the jsdom suite
 * already relies on — `vi.mock` is honoured in browser mode too — so the
 * custom-element registrations happen without the heavy runtime.
 *
 * The datatable spec doesn't touch Nightingale at all (it's a
 * self-contained shadow-DOM component), so it simply never triggers
 * these mocked imports.
 */
import '../__spec__/nightingale-mocks';
