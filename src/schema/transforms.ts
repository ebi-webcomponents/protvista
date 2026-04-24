/**
 * ProtVista transform engine.
 *
 * Implements the Vega-Lite subset documented in `specs/config-approach.md`:
 *
 *   filter | calculate | rename | pick | limit
 *
 * plus the track-level `filter: "<value>"` shortcut documented on
 * `TrackConfig`, which is equivalent to prepending
 * `{ filter: { field: "type", equal: "<value>" } }` to the pipeline.
 *
 * Dispatch:
 *
 *   - The 5 built-ins are handled directly on a fast path — no
 *     registry lookup.
 *   - Any step whose key is not a built-in is dispatched via
 *     `opts.registry.getTransform(name)`; that is the escape hatch for
 *     custom operators (e.g. `aggregateBy`) registered via
 *     `ProtvistaRuntimeAPI.registerTransform()`.
 *
 * Expression strings:
 *
 *   `filter: "<vega-expression>"` and `calculate: "<vega-expression>"`
 *   are compiled via Vega's own `vega-expression` package (parser +
 *   codegen). One evaluator, same for production and tests — the
 *   previous pluggable `ExpressionEvaluator` abstraction added
 *   mental overhead for no observable win. Structured predicates and
 *   the non-expression operators (`rename` / `pick` / `limit`) never
 *   touch the expression path.
 *
 * Error handling (see specs/config-approach.md → Error Handling table):
 *
 *   - A `calculate` expression that throws for an item → that item's
 *     `as` field is set to `null`; a single aggregated `console.warn`
 *     is emitted per track (not per item).
 *   - An expression-string `filter` that throws for an item → the item
 *     is treated as filtered out (matches Vega-Lite semantics).
 *   - Unknown operator keys, empty predicates, bad comparator operand
 *     types, etc. are validation-layer errors. The engine trusts
 *     its input and assumes schema-valid data; a defensive runtime
 *     error is still thrown if an unknown operator actually reaches
 *     dispatch (e.g. if a caller bypasses the validator).
 */

import { parseExpression, codegenExpression } from 'vega-expression';
import type { Transform, FieldPredicate, TransformFunction } from './types';
import type { Registry } from './registry';

// ─────────────────────────────────────────────────────────────
// Expression compiler (vega-expression)
// ─────────────────────────────────────────────────────────────

/** Compiled expression: a closure that evaluates against one datum. */
type CompiledExpression = (datum: Record<string, unknown>) => unknown;

// `allowed: ['datum']` lets `datum.x` references through untouched.
// `globalvar` rewrites every OTHER free identifier to a non-existent
// name, so a malicious expression can't reach `window`, `document`,
// or `process`. Matches Vega-Lite's safe-expression posture.
const codegen = codegenExpression({
  globalvar: (id) => `__no_globals_${id}`,
  allowed: ['datum'],
});

/**
 * Parse a Vega-expression string and return a reusable closure that
 * evaluates it against a single `datum`. `new Function` is the
 * standard Vega-expression compile step; it carries the same trust
 * posture as eval, but the `globalvar` rewrite above sandboxes the
 * scope so authored expressions can only reach `datum`.
 */
function compileExpression(expression: string): CompiledExpression {
  const ast = parseExpression(expression);
  const { code } = codegen(ast);
  return new Function('datum', `"use strict"; return ${code};`) as CompiledExpression;
}

// ─────────────────────────────────────────────────────────────
// applyTransforms
// ─────────────────────────────────────────────────────────────

interface ApplyTransformsOptions {
  /**
   * Registry used for *custom-operator* dispatch. Built-in operators
   * never touch the registry; custom operators registered via
   * `registerTransform()` do.
   */
  registry?: Registry;

  /**
   * The track-level `filter: "<value>"` shortcut (see `TrackConfig`).
   * Equivalent to prepending `{ filter: { field: "type", equal:
   * "<value>" } }`, but implemented inline so that subsequent pipeline
   * steps cannot accidentally remove it.
   */
  filter?: string;

  /**
   * Identifier used in error / warning messages
   * (e.g. `"DOMAINS/domain"`). Kept deliberately free-form —
   * normalised by the loader before calling.
   */
  trackRef?: string;
}

export function applyTransforms(
  items: readonly unknown[],
  steps: readonly Transform[],
  opts: ApplyTransformsOptions = {}
): unknown[] {
  let current: unknown[] = [...items];

  // Track-level `filter: "X"` shortcut — applied FIRST so that
  // subsequent declarative steps operate on an already-narrowed set.
  if (typeof opts.filter === 'string' && opts.filter.length > 0) {
    const value = opts.filter;
    current = current.filter((i) => isRecord(i) && i['type'] === value);
  }

  for (const step of steps) {
    current = applyStep(current, step, opts);
  }

  return current;
}

function applyStep(
  items: unknown[],
  step: Transform,
  opts: ApplyTransformsOptions
): unknown[] {
  // Built-in fast path — ordered by expected popularity.
  if ('filter' in step) {
    return filterStep(items, step.filter);
  }
  if ('calculate' in step && 'as' in step) {
    return calculateStep(items, step, opts);
  }
  if ('rename' in step) {
    return renameStep(items, step.rename);
  }
  if ('pick' in step) {
    return pickStep(items, step.pick);
  }
  if ('limit' in step) {
    return limitStep(items, step.limit);
  }

  // Custom operator — dispatch via registry. The validator has
  // already closed the operator union against
  // `BUILTIN_TRANSFORM_OPERATORS ∪ registry.listTransforms()`, so
  // reaching this path with a missing registration means either a
  // programmatic caller bypassed the validator or the registry was
  // mutated after validation. Either way, surfacing a clear error
  // beats silently dropping the step.
  const asRecord = step as unknown as Record<string, unknown>;
  const keys = Object.keys(asRecord);
  if (keys.length !== 1) {
    throw new Error(
      `Transform step must have exactly one operator key; got: ${keys.join(', ') || '(none)'}.`
    );
  }
  const opName = keys[0];
  const opParams = asRecord[opName];
  const fn = opts.registry?.getTransform(opName);
  if (!fn) {
    throw new Error(
      `Unknown transform operator '${opName}'. Did you forget to call registerTransform()?`
    );
  }
  const result = fn(items, opParams);
  if (isPromise(result)) {
    throw new Error(
      `Transform operator '${opName}' returned a Promise, but applyTransforms is synchronous. Register a synchronous operator.`
    );
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// filter
// ─────────────────────────────────────────────────────────────

function filterStep(
  items: unknown[],
  predicate: FieldPredicate | string
): unknown[] {
  if (typeof predicate === 'string') {
    const fn = compileExpression(predicate);
    return items.filter((item) => {
      try {
        return Boolean(fn(isRecord(item) ? item : {}));
      } catch {
        // Matches Vega-Lite: items where the predicate throws are
        // treated as filtered out rather than aborting the pipeline.
        return false;
      }
    });
  }
  const test = fieldPredicateToFn(predicate);
  return items.filter(test);
}

/**
 * Compile a structured `FieldPredicate` into an `(item) => boolean`
 * closure. Exported so the normalize layer and future operators
 * can reuse the comparator logic without coupling to the engine.
 *
 * Missing-field semantics: if the item is not an object, or the field
 * resolves to `undefined`, the predicate returns `false` — except for
 * `valid: false`, which returns `true` for invalid values by design.
 *
 * Dotted-path fields (`association.disease`) mirror Vega-Lite's
 * field-accessor semantics and our own `dataTooltip` placeholder
 * support.
 */
export function fieldPredicateToFn(
  p: FieldPredicate
): (item: unknown) => boolean {
  const { field } = p;
  return (item: unknown) => {
    if (!isRecord(item)) return false;
    const value = readDottedPath(item, field);

    if ('equal' in p) {
      // Loose Vega-Lite equality: `===` for ordinary values, with
      // `Object.is` to make the very rare `NaN === NaN` predicate
      // behave sanely if someone writes one.
      return value === p.equal || Object.is(value, p.equal);
    }
    if ('lt' in p && p.lt !== undefined) {
      return compareOrderable(value, p.lt, '<');
    }
    if ('lte' in p && p.lte !== undefined) {
      return compareOrderable(value, p.lte, '<=');
    }
    if ('gt' in p && p.gt !== undefined) {
      return compareOrderable(value, p.gt, '>');
    }
    if ('gte' in p && p.gte !== undefined) {
      return compareOrderable(value, p.gte, '>=');
    }
    if (Array.isArray(p.oneOf)) {
      return p.oneOf.includes(value);
    }
    if (Array.isArray(p.range) && p.range.length === 2) {
      const [a, b] = p.range;
      return (
        compareOrderable(value, a, '>=') && compareOrderable(value, b, '<=')
      );
    }
    if ('valid' in p) {
      const isValid =
        value !== null &&
        value !== undefined &&
        !(typeof value === 'number' && Number.isNaN(value));
      return p.valid ? isValid : !isValid;
    }
    // Empty predicate: schema layer should have rejected this. Keep
    // the item (fail-open) rather than silently drop every row.
    return true;
  };
}

function compareOrderable(
  a: unknown,
  b: unknown,
  op: '<' | '<=' | '>' | '>='
): boolean {
  // Allow number↔number and string↔string comparisons (matches
  // Vega-Lite's FieldPredicate, where `lt`/`lte`/`gt`/`gte` accept
  // `number | string` for temporal predicates). Mixed or unordered
  // types return false rather than throwing.
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'number' && typeof a !== 'string') return false;
  switch (op) {
    case '<':
      return (a as number | string) < (b as number | string);
    case '<=':
      return (a as number | string) <= (b as number | string);
    case '>':
      return (a as number | string) > (b as number | string);
    case '>=':
      return (a as number | string) >= (b as number | string);
  }
}

// ─────────────────────────────────────────────────────────────
// calculate
// ─────────────────────────────────────────────────────────────

function calculateStep(
  items: unknown[],
  step: { calculate: string; as: string },
  opts: ApplyTransformsOptions
): unknown[] {
  const fn = compileExpression(step.calculate);
  let failures = 0;
  const out = items.map((item) => {
    const datum = isRecord(item) ? item : {};
    let value: unknown;
    try {
      value = fn(datum);
    } catch {
      failures += 1;
      value = null;
    }
    return { ...datum, [step.as]: value };
  });
  if (failures > 0) {
    // One aggregated warning per track — not per item — matching the
    // spec's Error Handling table.
    console.warn(
      `[protvista] calculate '${step.calculate}' → '${step.as}' threw for ${failures} item(s) on ${opts.trackRef ?? '<unknown track>'}; those items have '${step.as}' = null.`
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// rename
// ─────────────────────────────────────────────────────────────

function renameStep(
  items: unknown[],
  map: Record<string, string>
): unknown[] {
  return items.map((item) => {
    if (!isRecord(item)) return item;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      const newKey = Object.prototype.hasOwnProperty.call(map, k)
        ? map[k]
        : k;
      out[newKey] = v;
    }
    return out;
  });
}

// ─────────────────────────────────────────────────────────────
// pick
// ─────────────────────────────────────────────────────────────

function pickStep(items: unknown[], fields: readonly string[]): unknown[] {
  return items.map((item) => {
    if (!isRecord(item)) return item;
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(item, f)) {
        out[f] = item[f];
      }
    }
    return out;
  });
}

// ─────────────────────────────────────────────────────────────
// limit
// ─────────────────────────────────────────────────────────────

function limitStep(items: unknown[], n: number): unknown[] {
  const clamped = Math.max(0, Math.floor(n));
  return items.slice(0, clamped);
}

// ─────────────────────────────────────────────────────────────
// Built-in registration
// ─────────────────────────────────────────────────────────────

/**
 * Register the 5 built-in transform operator function bodies in the
 * given registry. Called once by the loader at init so that
 * `registry.listTransforms()` reflects the full public vocabulary
 * alongside any custom registrations — and so that downstream code
 * can `registry.getTransform('filter')` and apply a single step
 * outside the main engine.
 *
 * Note: the registered `filter` / `calculate` wrappers handle only
 * the *structured* / *non-expression* shapes. Expression strings go
 * through `applyTransforms`, which owns the vega-expression pipeline
 * end to end. Custom transforms registered via `registerTransform()`
 * follow the natural `(items, stepValue) => items` convention.
 */
export function registerBuiltinTransforms(registry: Registry): void {
  const filterFn: TransformFunction = (items, params) => {
    if (typeof params === 'string') {
      throw new Error(
        `Expression-string filter is not supported via registry dispatch; ` +
          `use applyTransforms() directly.`
      );
    }
    return (items as unknown[]).filter(
      fieldPredicateToFn(params as FieldPredicate)
    );
  };

  const calculateFn: TransformFunction = () => {
    throw new Error(
      `'calculate' is not dispatched through the registry; it requires ` +
        `an expression evaluator and is handled directly by applyTransforms().`
    );
  };

  const renameFn: TransformFunction = (items, params) =>
    renameStep(items as unknown[], params as Record<string, string>);

  const pickFn: TransformFunction = (items, params) =>
    pickStep(items as unknown[], params as string[]);

  const limitFn: TransformFunction = (items, params) =>
    limitStep(items as unknown[], params as number);

  registry.registerTransform('filter', filterFn);
  registry.registerTransform('calculate', calculateFn);
  registry.registerTransform('rename', renameFn);
  registry.registerTransform('pick', pickFn);
  registry.registerTransform('limit', limitFn);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPromise(v: unknown): v is Promise<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { then?: unknown }).then === 'function'
  );
}

/**
 * Maximum number of dot-separated segments `readDottedPath` will walk.
 * Real-world paths (`association.disease`, `ligand.name`) sit at 2–3
 * segments. A defensive ceiling keeps a misauthored or malicious
 * config from driving a linear walk through a pathological string
 * (e.g. `"a.a.a.…"` × thousands) and turning a per-item tooltip
 * render into a DoS vector.
 */
const MAX_DOTTED_PATH_DEPTH = 32;

/**
 * Read a dotted-path field from an item (e.g. `"association.disease"`).
 * Matches Vega-Lite's field-accessor semantics and mirrors the
 * placeholder support promised by `dataTooltip`. Returns `undefined`
 * for any missing segment rather than throwing, and also for any path
 * deeper than `MAX_DOTTED_PATH_DEPTH`.
 */
function readDottedPath(
  obj: Record<string, unknown>,
  path: string
): unknown {
  if (!path.includes('.')) return obj[path];
  const segments = path.split('.');
  if (segments.length > MAX_DOTTED_PATH_DEPTH) return undefined;
  return segments.reduce<unknown>((acc, key) => {
    if (isRecord(acc)) return acc[key];
    return undefined;
  }, obj);
}
