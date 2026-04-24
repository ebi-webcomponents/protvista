/**
 * Transform engine contract tests.
 *
 * Covers:
 *   - the five built-in operators (filter / calculate / rename / pick /
 *     limit) with both structured and, where applicable, expression-
 *     string forms;
 *   - the track-level `filter: "X"` shortcut and parity with its
 *     explicit transform-step equivalent;
 *   - field-predicate comparator semantics (every documented operator);
 *   - `calculate`'s aggregated-warning contract (one warn per track,
 *     not per item) and `as = null` behaviour on throw;
 *   - custom-operator dispatch through the registry;
 *   - the `registerBuiltinTransforms()` wiring used by the loader.
 *
 * Expression evaluation is injected via a mock compiler so that these
 * tests do not depend on vega-expression (which is lazy-loaded at
 * runtime; see specs/config-approach.md's Constraints section).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyTransforms,
  fieldPredicateToFn,
  registerBuiltinTransforms,
  type ExpressionEvaluator,
  type CompiledExpression,
} from '../transforms';
import { createRegistry } from '../registry';
import type { Transform, FieldPredicate, TransformFunction } from '../types';

// ─────────────────────────────────────────────────────────────
// Expression evaluator mock
// ─────────────────────────────────────────────────────────────

// A tiny hand-written evaluator that knows just the expressions these
// tests use. Production wires vega-expression in its place; the
// interface is identical.
const mockEvaluator: ExpressionEvaluator = {
  compile(expr): CompiledExpression {
    switch (expr) {
      case 'datum.score > 0.8':
        return (d) =>
          typeof (d as { score?: unknown }).score === 'number' &&
          ((d as { score: number }).score as number) > 0.8;
      case 'datum.end - datum.start':
        return (d) =>
          ((d as { end: number }).end as number) -
          ((d as { start: number }).start as number);
      case 'datum.a.b':
        return (d) =>
          (d as { a: { b: unknown } }).a.b; // throws when d.a is undefined
      case 'datum.score >= 0 && datum.type == "DOMAIN"':
        return (d) => {
          const dd = d as { score?: number; type?: string };
          return (dd.score ?? -1) >= 0 && dd.type === 'DOMAIN';
        };
      default:
        throw new Error(`mock evaluator: unknown expression '${expr}'`);
    }
  },
};

// ─────────────────────────────────────────────────────────────
// fieldPredicateToFn
// ─────────────────────────────────────────────────────────────

describe('fieldPredicateToFn — every documented comparator', () => {
  const items = [
    { type: 'DOMAIN', score: 0.9, start: 10, end: 20 },
    { type: 'SIGNAL', score: 0.5, start: 30, end: 35 },
    { type: 'REGION', score: null, start: 40 },
    { type: 'HELIX', score: NaN, start: 50 },
  ] as const;

  it('equal', () => {
    const fn = fieldPredicateToFn({ field: 'type', equal: 'DOMAIN' });
    expect(items.filter(fn)).toEqual([items[0]]);
  });

  it('lt / lte / gt / gte on numbers', () => {
    expect(items.filter(fieldPredicateToFn({ field: 'score', lt: 0.8 }))).toEqual([
      items[1],
    ]);
    expect(items.filter(fieldPredicateToFn({ field: 'score', lte: 0.5 }))).toEqual([
      items[1],
    ]);
    expect(items.filter(fieldPredicateToFn({ field: 'score', gt: 0.5 }))).toEqual([
      items[0],
    ]);
    expect(
      items.filter(fieldPredicateToFn({ field: 'score', gte: 0.5 }))
    ).toEqual([items[0], items[1]]);
  });

  it('lt / gt on strings (Vega-Lite parity for temporal-like predicates)', () => {
    const fn = fieldPredicateToFn({ field: 'type', gte: 'R' });
    expect(items.filter(fn).map((i) => i.type)).toEqual(['SIGNAL', 'REGION']);
  });

  it('oneOf', () => {
    const fn = fieldPredicateToFn({
      field: 'type',
      oneOf: ['DOMAIN', 'SIGNAL'],
    });
    expect(items.filter(fn).map((i) => i.type)).toEqual(['DOMAIN', 'SIGNAL']);
  });

  it('range (inclusive)', () => {
    const fn = fieldPredicateToFn({ field: 'start', range: [20, 40] });
    expect(items.filter(fn).map((i) => i.start)).toEqual([30, 40]);
  });

  it('valid: true excludes null / undefined / NaN', () => {
    const fn = fieldPredicateToFn({ field: 'score', valid: true });
    expect(items.filter(fn).map((i) => i.type)).toEqual(['DOMAIN', 'SIGNAL']);
  });

  it('valid: false keeps only null / undefined / NaN / missing', () => {
    const fn = fieldPredicateToFn({ field: 'score', valid: false });
    expect(items.filter(fn).map((i) => i.type)).toEqual(['REGION', 'HELIX']);
  });

  it('dotted-path field access', () => {
    const nested = [
      { id: 'a', meta: { source: 'UniProt' } },
      { id: 'b', meta: { source: 'InterPro' } },
      { id: 'c' }, // meta missing entirely
    ];
    const fn = fieldPredicateToFn({ field: 'meta.source', equal: 'UniProt' });
    expect(nested.filter(fn).map((i) => i.id)).toEqual(['a']);
  });

  it('non-object items are always filtered out', () => {
    const fn = fieldPredicateToFn({ field: 'x', equal: 1 });
    expect([1, 'a', null, undefined, {} as unknown].filter(fn)).toEqual([]);
  });

  it('empty predicate is a schema-layer bug — fails open at runtime (keep all)', () => {
    const fn = fieldPredicateToFn({ field: 'score' } as FieldPredicate);
    expect(items.filter(fn).length).toBe(items.length);
  });
});

// ─────────────────────────────────────────────────────────────
// applyTransforms — built-ins
// ─────────────────────────────────────────────────────────────

describe('applyTransforms — built-in operators', () => {
  const sample = [
    { type: 'DOMAIN', start: 1, end: 10, score: 0.9, desc: 'A' },
    { type: 'DOMAIN', start: 12, end: 15, score: 0.6, desc: 'B' },
    { type: 'SIGNAL', start: 20, end: 25, score: 0.95, desc: 'C' },
  ];

  it('filter with a structured predicate', () => {
    const out = applyTransforms(sample, [
      { filter: { field: 'score', gte: 0.8 } },
    ]);
    expect(out.map((i) => (i as { desc: string }).desc)).toEqual(['A', 'C']);
  });

  it('filter with an expression string uses the evaluator', () => {
    const out = applyTransforms(
      sample,
      [{ filter: 'datum.score > 0.8' }],
      { expressionEvaluator: mockEvaluator }
    );
    expect(out.map((i) => (i as { desc: string }).desc)).toEqual(['A', 'C']);
  });

  it('filter with a string expression and no evaluator throws a clear error', () => {
    expect(() =>
      applyTransforms(sample, [{ filter: 'datum.score > 0.8' }])
    ).toThrow(/expression evaluator/i);
  });

  it('filter with an expression that throws treats that item as out', () => {
    const items = [{ a: { b: 1 } }, { a: null } as unknown, { other: true }];
    const out = applyTransforms(
      items,
      [{ filter: 'datum.a.b' }],
      { expressionEvaluator: mockEvaluator }
    );
    // Only the first item has a truthy result; the other two throw or
    // return undefined → filtered out.
    expect(out).toEqual([{ a: { b: 1 } }]);
  });

  it('calculate derives a field from an expression', () => {
    const out = applyTransforms(
      sample,
      [{ calculate: 'datum.end - datum.start', as: 'length' }],
      { expressionEvaluator: mockEvaluator }
    );
    expect(out.map((i) => (i as { length: number }).length)).toEqual([
      9, 3, 5,
    ]);
  });

  it('calculate throws without an evaluator', () => {
    expect(() =>
      applyTransforms(sample, [
        { calculate: 'datum.end - datum.start', as: 'length' },
      ])
    ).toThrow(/expression evaluator/i);
  });

  it('rename applies the mapping and keeps unmapped keys', () => {
    const out = applyTransforms(sample.slice(0, 1), [
      { rename: { desc: 'description', start: 'begin' } },
    ]);
    expect(out[0]).toEqual({
      type: 'DOMAIN',
      begin: 1,
      end: 10,
      score: 0.9,
      description: 'A',
    });
  });

  it('pick keeps only the named fields (missing ones omitted silently)', () => {
    const out = applyTransforms(sample, [
      { pick: ['type', 'start', 'zzz'] },
    ]);
    expect(out).toEqual([
      { type: 'DOMAIN', start: 1 },
      { type: 'DOMAIN', start: 12 },
      { type: 'SIGNAL', start: 20 },
    ]);
  });

  it('limit clamps negative and non-integer counts to 0 / floor', () => {
    expect(applyTransforms(sample, [{ limit: 2 }]).length).toBe(2);
    expect(applyTransforms(sample, [{ limit: 10 }]).length).toBe(3);
    expect(applyTransforms(sample, [{ limit: 0 }])).toEqual([]);
    expect(applyTransforms(sample, [{ limit: -5 }])).toEqual([]);
    expect(applyTransforms(sample, [{ limit: 2.7 }]).length).toBe(2);
  });

  it('rename / pick pass through non-object items untouched', () => {
    const out = applyTransforms(
      [1, 'hi', null as unknown, { x: 1 }],
      [{ rename: { x: 'y' } }, { pick: ['y'] }]
    );
    // Non-objects flow through both steps unchanged; the object is
    // renamed and then projected to just `y`.
    expect(out).toEqual([1, 'hi', null, { y: 1 }]);
  });
});

// ─────────────────────────────────────────────────────────────
// calculate — error aggregation
// ─────────────────────────────────────────────────────────────

describe("calculate — error handling matches specs/config-approach.md's table", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("sets `as` to null for items whose expression throws", () => {
    const items = [{ a: { b: 1 } }, { a: null } as unknown, { other: 1 }];
    const out = applyTransforms(
      items,
      [{ calculate: 'datum.a.b', as: 'derived' }],
      { expressionEvaluator: mockEvaluator, trackRef: 'GROUP/track' }
    );
    expect(out).toEqual([
      { a: { b: 1 }, derived: 1 },
      { a: null, derived: null },
      { other: 1, derived: null },
    ]);
  });

  it('emits ONE aggregated warning per track, not per failing item', () => {
    const items = [{ a: null }, { b: 2 }, { a: null }] as unknown[];
    applyTransforms(
      items,
      [{ calculate: 'datum.a.b', as: 'derived' }],
      { expressionEvaluator: mockEvaluator, trackRef: 'GROUP/track' }
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = (warnSpy.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toMatch(/calculate/);
    expect(msg).toMatch(/3 item/);
    expect(msg).toMatch(/GROUP\/track/);
  });
});

// ─────────────────────────────────────────────────────────────
// Track-level filter shortcut
// ─────────────────────────────────────────────────────────────

describe('applyTransforms — track-level `filter: X` shortcut', () => {
  const items = [
    { type: 'DOMAIN', start: 1, end: 10 },
    { type: 'SIGNAL', start: 11, end: 20 },
    { type: 'DOMAIN', start: 30, end: 40 },
  ];

  it('is applied when no transform pipeline is present', () => {
    const out = applyTransforms(items, [], { filter: 'DOMAIN' });
    expect(out.map((i) => (i as { start: number }).start)).toEqual([1, 30]);
  });

  it("produces the same output as `transform: [{ filter: { field: 'type', equal: X } }]` (parity test from specs/config-approach.md)", () => {
    const shortcut = applyTransforms(items, [], { filter: 'DOMAIN' });
    const equivalent = applyTransforms(items, [
      { filter: { field: 'type', equal: 'DOMAIN' } },
    ]);
    expect(shortcut).toEqual(equivalent);
  });

  it('runs BEFORE pipeline steps so subsequent filters narrow further', () => {
    const out = applyTransforms(
      items,
      [{ filter: { field: 'start', gte: 10 } }],
      { filter: 'DOMAIN' }
    );
    expect(out).toEqual([{ type: 'DOMAIN', start: 30, end: 40 }]);
  });

  it('empty or missing shortcut is a no-op', () => {
    expect(applyTransforms(items, [])).toEqual(items);
    expect(applyTransforms(items, [], { filter: '' })).toEqual(items);
  });
});

// ─────────────────────────────────────────────────────────────
// Pipeline composition — specs/config-approach.md Example 4
// ─────────────────────────────────────────────────────────────

describe("applyTransforms — specs/config-approach.md Example 4 pipeline", () => {
  it('chains filter + filter + rename + calculate + limit in order', () => {
    const items = [
      {
        hotspot_type: 'binding',
        score: 0.9,
        pos_start: 1,
        pos_end: 10,
        desc: 'A',
      },
      {
        hotspot_type: 'binding',
        score: 0.7, // below threshold — dropped by first filter
        pos_start: 11,
        pos_end: 20,
        desc: 'B',
      },
      {
        hotspot_type: 'regulatory', // not in oneOf — dropped by second filter
        score: 0.95,
        pos_start: 21,
        pos_end: 30,
        desc: 'C',
      },
      {
        hotspot_type: 'catalytic',
        score: 0.85,
        pos_start: 31,
        pos_end: 40,
        desc: 'D',
      },
      {
        hotspot_type: 'catalytic',
        score: 0.99,
        pos_start: 41,
        pos_end: 60,
        desc: 'E',
      },
    ];
    const steps: Transform[] = [
      { filter: { field: 'score', gte: 0.8 } },
      { filter: { field: 'hotspot_type', oneOf: ['binding', 'catalytic'] } },
      {
        rename: {
          desc: 'description',
          pos_start: 'start',
          pos_end: 'end',
        },
      },
      { calculate: 'datum.end - datum.start', as: 'length' },
      { limit: 2 },
    ];
    const out = applyTransforms(items, steps, {
      expressionEvaluator: mockEvaluator,
    });

    expect(out).toEqual([
      {
        hotspot_type: 'binding',
        score: 0.9,
        start: 1,
        end: 10,
        description: 'A',
        length: 9,
      },
      {
        hotspot_type: 'catalytic',
        score: 0.85,
        start: 31,
        end: 40,
        description: 'D',
        length: 9,
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Custom operator dispatch via registry
// ─────────────────────────────────────────────────────────────

describe('applyTransforms — custom operator dispatch', () => {
  it('dispatches unknown keys to a registered transform in the registry', () => {
    const registry = createRegistry();
    const head: TransformFunction = (items, params) =>
      (items as unknown[]).slice(0, (params as { n: number }).n);
    registry.registerTransform('head', head);

    const items = [1, 2, 3, 4, 5];
    const out = applyTransforms(
      items,
      // Cast because Transform's union doesn't include custom operator
      // shapes — custom operators live outside the closed type union
      // but inside the open registry vocabulary.
      [{ head: { n: 2 } } as unknown as Transform],
      { registry }
    );
    expect(out).toEqual([1, 2]);
  });

  it("throws a clear error when no evaluator, no registry, and key isn't a built-in", () => {
    expect(() =>
      applyTransforms(
        [1, 2, 3],
        [{ head: { n: 2 } } as unknown as Transform],
        {}
      )
    ).toThrow(/unknown transform operator/i);
  });

  it('throws when a custom operator returns a Promise (engine is sync)', () => {
    const registry = createRegistry();
    const asyncFn: TransformFunction = async (items) => items as unknown[];
    registry.registerTransform('slow', asyncFn);
    expect(() =>
      applyTransforms(
        [1],
        [{ slow: {} } as unknown as Transform],
        { registry }
      )
    ).toThrow(/synchronous/i);
  });
});

// ─────────────────────────────────────────────────────────────
// registerBuiltinTransforms
// ─────────────────────────────────────────────────────────────

describe('registerBuiltinTransforms — wires the 5 names into a registry', () => {
  it('registers exactly filter / calculate / rename / pick / limit', () => {
    const r = createRegistry();
    registerBuiltinTransforms(r);
    expect([...r.listTransforms()].sort()).toEqual(
      ['calculate', 'filter', 'limit', 'pick', 'rename'].sort()
    );
  });

  it('the registered `filter` works for a structured predicate', () => {
    const r = createRegistry();
    registerBuiltinTransforms(r);
    const fn = r.getTransform('filter');
    expect(fn).toBeTypeOf('function');
    const out = fn!(
      [
        { type: 'A', score: 1 },
        { type: 'B', score: 2 },
      ],
      { field: 'type', equal: 'A' } as FieldPredicate
    );
    expect(out).toEqual([{ type: 'A', score: 1 }]);
  });

  it('the registered `filter` throws for expression-string params (use the engine)', () => {
    const r = createRegistry();
    registerBuiltinTransforms(r);
    const fn = r.getTransform('filter');
    expect(() => fn!([], 'datum.score > 0')).toThrow(/expression/i);
  });

  it('the registered `calculate` throws (engine-only operator)', () => {
    const r = createRegistry();
    registerBuiltinTransforms(r);
    const fn = r.getTransform('calculate');
    expect(() => fn!([], { calculate: 'datum.x', as: 'y' })).toThrow(
      /applyTransforms/i
    );
  });

  it("a second call collides — registration is not idempotent", () => {
    const r = createRegistry();
    registerBuiltinTransforms(r);
    expect(() => registerBuiltinTransforms(r)).toThrow();
  });
});
