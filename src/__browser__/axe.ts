/**
 * Thin wrapper over axe-core for the browser test project.
 *
 * We use axe-core directly rather than a matcher library (vitest-axe et
 * al.) to keep the dependency footprint minimal — the whole a11y layer
 * is one `axe.run()` call plus a readable failure message.
 *
 * axe traverses shadow roots automatically, so passing a shadow-DOM
 * host (e.g. `<protvista-uniprot-datatable>`) as the context checks the
 * rendered table inside it.
 */
import axe, { type RunOptions, type ElementContext } from 'axe-core';
import { expect } from 'vitest';

export type A11yOptions = RunOptions & {
  /** Rule ids to switch off for this run (e.g. a documented, out-of-scope gap). */
  disableRules?: string[];
};

/**
 * Assert that axe finds no accessibility violations in `context`.
 * Throws with a compact, human-readable list (rule id, impact, help URL
 * and the offending selector) when it does.
 */
export async function expectNoA11yViolations(
  context: ElementContext,
  options: A11yOptions = {}
): Promise<void> {
  const { disableRules, ...runOptions } = options;

  const merged: RunOptions = { ...runOptions };
  if (disableRules?.length) {
    merged.rules = {
      ...(runOptions.rules ?? {}),
      ...Object.fromEntries(disableRules.map((id) => [id, { enabled: false }])),
    };
  }

  const results = await axe.run(context, merged);

  if (results.violations.length > 0) {
    const report = results.violations
      .map((v) => {
        const nodes = v.nodes
          .map((n) => `      - ${n.target.join(' ')}`)
          .join('\n');
        return `  • [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${nodes}`;
      })
      .join('\n');
    throw new Error(
      `Expected no accessibility violations but found ${results.violations.length}:\n${report}`
    );
  }

  // A positive assertion so the test registers an expectation even on the
  // (expected) clean path.
  expect(results.violations).toHaveLength(0);
}
