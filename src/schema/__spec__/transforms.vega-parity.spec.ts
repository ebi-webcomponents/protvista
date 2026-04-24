/**
 * Vega-Lite parity check for `fieldPredicateToFn`.
 *
 * The spec promises that ProtVista's structured `FieldPredicate` is
 * "shape-compatible with Vega-Lite's Field Predicate". We implement
 * the evaluation by hand (vega-lite itself is a ~200 kB compiler
 * tied to its dataflow runtime — wrong shape and wrong size for an
 * array-transform subset), and that hand-roll could silently drift
 * from Vega-Lite semantics as the VL docs evolve.
 *
 * This test is the drift alarm. For a closed set of fixtures we:
 *
 *   1. Evaluate each item using our own `fieldPredicateToFn`.
 *   2. Evaluate the *same* predicate, re-expressed as a Vega
 *      expression string, via `vega-expression` (Vega's own parser +
 *      codegen — the same package the runtime will lazy-load for
 *      string-form `filter:` / `calculate:` steps).
 *   3. Assert the two outcomes agree on every item.
 *
 * `vega-expression` is a **devDependency**, not a runtime dep — this
 * check exists only to catch drift, and does not affect the
 * shipped bundle size. Structured predicates in production never
 * go through Vega's parser.
 *
 * Out of scope for this file:
 *   - The `valid` comparator is a ProtVista extension (Vega-Lite's
 *     closest analogue is the `isValid` function, which needs Vega's
 *     function library injected into codegen). Our unit tests in
 *     transforms.spec.ts cover `valid` directly.
 *   - Non-object items: we short-circuit to `false`; Vega-expression
 *     would typically throw a TypeError on `null.x`. Fixtures here
 *     all use well-formed objects.
 */

import { describe, it, expect } from 'vitest';
import { parseExpression, codegenExpression } from 'vega-expression';
import { fieldPredicateToFn } from '../transforms';
import type { FieldPredicate } from '../types';

// ─────────────────────────────────────────────────────────────
// Vega-expression setup
// ─────────────────────────────────────────────────────────────

// `allowed: ['datum']` tells the codegen to leave `datum` references
// alone (rather than rewriting them through the `globalvar` function,
// which is used to block every OTHER free identifier).
const codegen = codegenExpression({
  globalvar: (id) => `__no_globals_${id}`,
  allowed: ['datum'],
});

function compileExpression(
  expr: string
): (datum: Record<string, unknown>) => unknown {
  const ast = parseExpression(expr);
  const { code } = codegen(ast);
  // The generated code is a plain JS expression that reads `datum.x`.
  // `new Function` is the standard way to turn it into a callable —
  // this mirrors how the runtime loader will use vega-expression.
  return new Function('datum', `"use strict"; return ${code};`) as (
    datum: Record<string, unknown>
  ) => unknown;
}

// ─────────────────────────────────────────────────────────────
// Fixture: a predicate + its equivalent Vega expression + sample items
//
// The expression is hand-written alongside the predicate (not auto-
// derived) so the test fails loudly if either side drifts — that's
// the whole point. If you edit one, you have to edit the other.
// ─────────────────────────────────────────────────────────────

type Fixture = {
  name: string;
  predicate: FieldPredicate;
  expression: string;
  items: ReadonlyArray<Record<string, unknown>>;
};

const ITEMS: ReadonlyArray<Record<string, unknown>> = [
  { type: 'DOMAIN', score: 0.95, start: 10, end: 20 },
  { type: 'SIGNAL', score: 0.5, start: 30, end: 35 },
  { type: 'REGION', score: 0.8, start: 40, end: 60 },
  { type: 'HELIX', score: 0.2, start: 80, end: 85 },
  { type: 'DOMAIN', score: 0.5, start: 90, end: 95 },
];

const FIXTURES: Fixture[] = [
  // ── equal ─────────────────────────────────────────────────
  {
    name: 'equal — string',
    predicate: { field: 'type', equal: 'DOMAIN' },
    expression: 'datum.type === "DOMAIN"',
    items: ITEMS,
  },
  {
    name: 'equal — number',
    predicate: { field: 'start', equal: 30 },
    expression: 'datum.start === 30',
    items: ITEMS,
  },

  // ── lt / lte / gt / gte on numbers ────────────────────────
  {
    name: 'lt — number',
    predicate: { field: 'score', lt: 0.8 },
    expression: 'datum.score < 0.8',
    items: ITEMS,
  },
  {
    name: 'lte — number',
    predicate: { field: 'score', lte: 0.5 },
    expression: 'datum.score <= 0.5',
    items: ITEMS,
  },
  {
    name: 'gt — number',
    predicate: { field: 'score', gt: 0.8 },
    expression: 'datum.score > 0.8',
    items: ITEMS,
  },
  {
    name: 'gte — number',
    predicate: { field: 'score', gte: 0.5 },
    expression: 'datum.score >= 0.5',
    items: ITEMS,
  },

  // ── lt / gt on strings (Vega-Lite temporal-predicate parity) ──
  {
    name: 'gte — string',
    predicate: { field: 'type', gte: 'R' },
    expression: 'datum.type >= "R"',
    items: ITEMS,
  },

  // ── oneOf — encoded as OR chain for parity ────────────────
  {
    name: 'oneOf — 2 values',
    predicate: { field: 'type', oneOf: ['DOMAIN', 'SIGNAL'] },
    expression: '(datum.type === "DOMAIN") || (datum.type === "SIGNAL")',
    items: ITEMS,
  },
  {
    name: 'oneOf — 3 values (mixed types)',
    predicate: { field: 'start', oneOf: [10, 40, 'x'] },
    expression:
      '(datum.start === 10) || (datum.start === 40) || (datum.start === "x")',
    items: ITEMS,
  },

  // ── range — inclusive AND chain ───────────────────────────
  {
    name: 'range — number, straddling middle scores',
    predicate: { field: 'score', range: [0.4, 0.85] },
    expression: '(datum.score >= 0.4) && (datum.score <= 0.85)',
    items: ITEMS,
  },

  // ── dotted-path field access ──────────────────────────────
  {
    name: 'dotted-path equal',
    predicate: { field: 'meta.source', equal: 'UniProt' },
    expression: 'datum.meta.source === "UniProt"',
    items: [
      { id: 'a', meta: { source: 'UniProt' } },
      { id: 'b', meta: { source: 'InterPro' } },
      // `meta` present but inner key missing — parity: both return false.
      { id: 'c', meta: { other: 1 } },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// Parity assertions
// ─────────────────────────────────────────────────────────────

describe('FieldPredicate — Vega-expression parity', () => {
  for (const f of FIXTURES) {
    it(`'${f.name}' agrees with vega-expression`, () => {
      const ours = fieldPredicateToFn(f.predicate);
      const theirs = compileExpression(f.expression);

      const actual = f.items.map(ours);
      const expected = f.items.map((item) => {
        try {
          return Boolean(theirs(item));
        } catch {
          // Matches our "false on throw" contract; kept here so
          // predicates that hit missing nested keys still compare
          // cleanly on both sides.
          return false;
        }
      });

      expect(actual).toEqual(expected);
    });
  }

  it('every fixture exercises at least one true and one false outcome', () => {
    // Guard rail: ensures the fixtures are discriminating. A fixture
    // that returns all-true or all-false proves nothing about parity.
    for (const f of FIXTURES) {
      const ours = f.items.map(fieldPredicateToFn(f.predicate));
      expect(ours, `fixture '${f.name}' has no TRUE outcomes`).toContain(true);
      expect(ours, `fixture '${f.name}' has no FALSE outcomes`).toContain(
        false
      );
    }
  });
});
