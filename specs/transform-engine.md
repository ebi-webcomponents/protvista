# Transform engine — SQL-WHERE-flavored design

Design for a declarative data-transform pipeline on ProtVista track
data sources. Not currently implemented; the JSON Schema rejects
`transform:` as an unknown property. When built, this doc is the
implementation brief.

The expression-string branch of `filter:` / `calculate:` uses a
SQL-WHERE-clause-flavored grammar, parsed by an in-tree hand-rolled
Pratt parser (lexer + recursive-descent parser + closure compiler).
Zero runtime dependency, ~250 lines of TypeScript. SQL-WHERE was
chosen over JS- or Vega-expression syntax because ProtVista's
authoring audience (bench scientists, bioinformaticians, web devs
embedding viewers) consistently reaches for SQL-flavored dialects
across Excel filters, Google Sheets `QUERY()`, pandas `.query()`,
R's `dplyr::filter`, and Airtable formulas — SQL is the common
substrate.

---

## 1. Scope

What the feature adds:

- A `DataSourceDescriptor.transform?: Transform[]` field on the Intent
  layer — a pipeline of ordered, declarative operations applied to the
  adapter's output **before** the tooltip resolver and the renderer see
  it.
- Five built-in operators modelled on Vega-Lite's transform vocabulary:
  `filter`, `calculate`, `rename`, `pick`, `limit`.
- A `FieldPredicate` structure (`equal | lt | lte | gt | gte | oneOf |
  range | valid`) for `filter` steps, shape-compatible with Vega-Lite's
  field-predicate. This is the 95%-path and does not involve the
  expression parser at all.
- A SQL-WHERE-clause-flavored expression string form for
  `filter: "<expr>"` and `calculate: "<expr>"`, parsed by an
  in-tree hand-rolled parser (lexer + Pratt parser + closure
  compiler).
- A `registerTransform(name, fn)` escape hatch on `ProtvistaRuntimeAPI`
  for custom operators.
- Validator error messages covering unknown operators, missing predicate
  operators, and unknown transform operators.

What stays **out of scope** (by design):

- **Extending the track-level `filter: "<value>"` shortcut.** That
  shortcut already ships. This engine's `filter` step must produce the
  same results as the shortcut when used with `{ filter: { field:
  "type", equal: "<value>" } }` — the parity test below pins that.
- **Full SQL support.** `SELECT` / `FROM` / `JOIN` / `GROUP BY` / CTEs
  / window functions / correlated subqueries — none of it. This is
  strictly WHERE-clause semantics plus arithmetic for `calculate`.
- **Three-valued NULL logic.** SQL's `x = NULL` → NULL (not FALSE)
  surprises more people than it helps. We borrow the *syntax*, not the
  NULL semantics. Missing, `undefined`, `null`, and `NaN` are falsy;
  `IS NULL` matches any of them.
- **Case-insensitive identifiers.** SQL keywords (`AND`, `and`, `And`)
  are case-insensitive; field names (`score`, `Score`) are not. That
  matches how adapter output is structured and how our structured
  predicates already behave.
- **Async / Promise-returning operators.** The engine is synchronous
  so it can be composed cleanly inside the per-track loader loop.
  Custom operators that return a Promise throw a clear error.

---

## 2. Motivation

The shipped library lets authors do exactly one thing to narrow a
track's data: `filter: "<type>"`. For the default UniProt config that
is enough — every group already has an adapter that produces
correctly-shaped output, and `filter: SIGNAL` / `filter: DOMAIN` / etc.
covers all 15 groups.

The transform engine addresses the "almost right, just need to tweak"
case that would otherwise require writing a custom adapter:

- A bring-your-own-CSV track whose score column is named `confidence`
  but the renderer expects `score`. (`rename`)
- A collaborator-maintained JSON feed with 40 fields you want to project
  to 4. (`pick`)
- A prediction feed that emits thousands of items; you want to display
  only the top 500. (`limit`)
- A derived-field case: `length = end - start`, displayed in the
  tooltip. (`calculate`)
- A compound narrow: `score >= 0.8 AND type IN ('binding',
  'catalytic')`, which the track-level `filter:` shortcut cannot
  express. (`filter` with an expression string, or chained structured
  `filter` steps.)

### Why SQL-WHERE syntax

Three audiences author ProtVista configs:

1. **Bench scientists** — know Excel filters, Google Sheets `QUERY()`,
   Airtable filter formulas. All are SQL-flavored at heart.
2. **Bioinformaticians** — know SQL (Ensembl / UCSC queries), R
   (`dplyr::filter(score > 0.8 & type %in% c("DOMAIN"))`), pandas
   (`df.query("score > 0.8 and type in ['DOMAIN']")`). SQL is the
   common substrate.
3. **Web developers embedding viewers** — know SQL from backend work.

SQL is the one query dialect that all three have seen somewhere. A
JS/Vega-flavored expression (`datum.score > 0.8 && datum.type ==
'DOMAIN'`) assumes a JS mental model; a pandas-flavored one assumes
Python. A SQL-WHERE-flavored one assumes almost nothing — the reader
can transliterate from whatever dialect they already use.

---

## 3. Schema additions

### 3.1 TypeScript types (`src/schema/types.ts`)

`DataSourceDescriptor` gains:

```ts
/**
 * Declarative transformations applied to the adapter's output
 * *before* the track renders. Ordered: each step's output is
 * the next step's input.
 *
 * The vocabulary is a subset of Vega-Lite's `transform` pipeline
 * (https://vega.github.io/vega-lite/docs/transform.html). Structured
 * field predicates match Vega-Lite's shape
 * (https://vega.github.io/vega-lite/docs/filter.html). Expression
 * strings use a SQL-WHERE-clause-flavored dialect — see the
 * authoring guide for the grammar.
 *
 * Most configs never need this — the track-level `filter` shortcut
 * covers the common "pick items of a given type" case, and canonical
 * adapters produce ready-to-render output.
 */
transform?: Transform[];
```

```ts
/**
 * A single step in the data pipeline. Discriminated by which
 * operation key is present. Exactly one operation per step.
 *
 * A `registerTransform()` escape hatch lets advanced users add custom
 * operators while keeping the same discriminated-union shape.
 */
export type Transform =
  /** Keep only items matching a predicate (structured or SQL-WHERE string). */
  | { filter: FieldPredicate | string }
  /** Compute a derived field from a SQL-flavored arithmetic expression. */
  | { calculate: string; as: string }
  /** Rename fields on each item. Keys are old names, values new names. */
  | { rename: Record<string, string> }
  /** Project each item to only the named fields. */
  | { pick: string[] }
  /** Keep at most N items (items beyond the limit are dropped). */
  | { limit: number };

/**
 * A structured field predicate, shape-compatible with Vega-Lite's
 * Field Predicate
 * (https://vega.github.io/vega-lite/docs/filter.html#field-predicate).
 *
 * Exactly one comparison operator must be present alongside `field`:
 *
 *     { field: "score", gte: 0.8 }
 *     { field: "type",  oneOf: ["DOMAIN", "REGION"] }
 *     { field: "score", range: [0.5, 0.9] }
 *     { field: "start", valid: true }             // excludes null / NaN
 *
 * The expression-string form of `filter` accepts any predicate
 * expressible in the SQL-WHERE-flavored grammar:
 *     "score > 0.8 AND type IN ('DOMAIN', 'REGION')"
 */
export interface FieldPredicate {
  field: string;
  equal?: unknown;
  lt?: number | string;
  lte?: number | string;
  gt?: number | string;
  gte?: number | string;
  oneOf?: unknown[];
  range?: [unknown, unknown];
  valid?: boolean;
}

/**
 * Signature of a custom transform operator registered via
 * `registerTransform()`. Receives the current items array and the
 * operator's parameters, returns the transformed items.
 */
export type TransformFunction = (
  items: unknown[],
  params: unknown
) => unknown[] | Promise<unknown[]>;
```

`ProtvistaRuntimeAPI` gains:

```ts
/**
 * Register a custom transform operator so it can appear as a step in
 * `DataSourceDescriptor.transform`. The operator name becomes the
 * discriminator key in the transform step object.
 *
 *     api.registerTransform("aggregateBy", (items, params) => { ... });
 *
 *     # in config:
 *     transform:
 *       - aggregateBy: { field: type, op: count }
 */
registerTransform(name: string, fn: TransformFunction): void;
```

### 3.2 JSON Schema (`src/schema/schema.json`)

Add a `transform` property to `DataSourceDescriptor`:

```json
"transform": {
  "type": "array",
  "items": { "$ref": "#/$defs/Transform" }
}
```

Add the two `$defs`. The shape of the value is independent of the
expression-string grammar — the expression is parsed at evaluate
time, not at schema-validate time, so the JSON Schema only checks
that the value is a non-empty string:

```json
"Transform": {
  "description": "A single pipeline step. Discriminated by which operation key is present; exactly one per step.",
  "type": "object",
  "oneOf": [
    {
      "required": ["filter"],
      "additionalProperties": false,
      "properties": {
        "filter": {
          "oneOf": [
            { "type": "string", "minLength": 1 },
            { "$ref": "#/$defs/FieldPredicate" }
          ]
        }
      }
    },
    {
      "required": ["calculate", "as"],
      "additionalProperties": false,
      "properties": {
        "calculate": { "type": "string", "minLength": 1 },
        "as":        { "type": "string", "minLength": 1 }
      }
    },
    {
      "required": ["rename"],
      "additionalProperties": false,
      "properties": {
        "rename": {
          "type": "object",
          "minProperties": 1,
          "additionalProperties": { "type": "string", "minLength": 1 }
        }
      }
    },
    {
      "required": ["pick"],
      "additionalProperties": false,
      "properties": {
        "pick": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "minItems": 1,
          "uniqueItems": true
        }
      }
    },
    {
      "required": ["limit"],
      "additionalProperties": false,
      "properties": {
        "limit": { "type": "integer", "minimum": 0 }
      }
    }
  ]
},

"FieldPredicate": {
  "description": "Shape-compatible with Vega-Lite's Field Predicate. Exactly `field` plus at least one comparison operator.",
  "type": "object",
  "required": ["field"],
  "additionalProperties": false,
  "properties": {
    "field": { "type": "string", "minLength": 1 },
    "equal": {},
    "lt":    { "type": ["number", "string"] },
    "lte":   { "type": ["number", "string"] },
    "gt":    { "type": ["number", "string"] },
    "gte":   { "type": ["number", "string"] },
    "oneOf": { "type": "array", "minItems": 1 },
    "range": { "type": "array", "minItems": 2, "maxItems": 2 },
    "valid": { "type": "boolean" }
  },
  "anyOf": [
    { "required": ["equal"] },
    { "required": ["lt"]    },
    { "required": ["lte"]   },
    { "required": ["gt"]    },
    { "required": ["gte"]   },
    { "required": ["oneOf"] },
    { "required": ["range"] },
    { "required": ["valid"] }
  ]
}
```

---

## 4. Runtime implementation

### 4.1 File layout

```
src/schema/
  transforms.ts                  ← engine (section 4.2)
  expressions.ts                 ← hand-rolled parser (section 4.3)
  registry.ts                    ← gains BUILTIN_TRANSFORM_OPERATORS +
                                    register/get/has/listTransforms
  validate.ts                    ← gains checkTransform() +
                                    FieldPredicate anyOf → "missing-predicate-operator"
  normalize.ts                   ← preserves transform:[] verbatim on the
                                    normalised descriptor
  __spec__/transforms.spec.ts         ← engine contract tests
  __spec__/expressions.spec.ts        ← grammar + evaluator tests
```

### 4.2 Expression grammar (SQL-WHERE flavored)

```
expr         := or_expr
or_expr      := and_expr (OR and_expr)*
and_expr     := not_expr (AND not_expr)*
not_expr     := NOT not_expr | comparison
comparison   := add_expr (
                  (= | != | <> | < | <= | > | >=) add_expr
                | [NOT] IN '(' value_list ')'
                | [NOT] BETWEEN add_expr AND add_expr
                | [NOT] LIKE string
                | IS [NOT] NULL
                | /* none — bare truthiness, useful in calculate */
                )
add_expr     := mul_expr (('+' | '-') mul_expr)*
mul_expr     := unary_expr (('*' | '/') unary_expr)*
unary_expr   := '-' unary_expr | primary
primary      := NUMBER | STRING | IDENT | TRUE | FALSE | NULL | '(' expr ')'
value_list   := add_expr (',' add_expr)*
```

**Tokens**

| Token      | Form                                                                |
| ---------- | ------------------------------------------------------------------- |
| Keyword    | case-insensitive: `AND`, `OR`, `NOT`, `IN`, `BETWEEN`, `LIKE`, `IS`, `NULL`, `TRUE`, `FALSE` |
| Operator   | `=` `!=` `<>` `<` `<=` `>` `>=` `+` `-` `*` `/`                    |
| Punct.     | `(` `)` `,`                                                         |
| `NUMBER`   | `\d+(\.\d+)?([eE][+-]?\d+)?` or `\.\d+([eE][+-]?\d+)?`              |
| `STRING`   | `'…'` with `''` as the single-quote escape (SQL convention)         |
| `IDENT`    | `[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*` — **dotted paths allowed** |
| Whitespace | `\s+` skipped                                                       |

**Semantic decisions**

| Concern                | Rule                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Identifier dotted paths | `association.disease`, `locations.0.start` — walked via the existing `readDottedPath` (32-segment cap). Numeric segments OK. |
| Missing path            | `undefined`. Makes `IS NULL` natural, all comparisons with it `false`, arithmetic `null`. |
| `IS [NOT] NULL`         | NULL-ish = `null` ∨ `undefined` ∨ `NaN`. Falsy in boolean context.                  |
| Case of keywords        | Case-insensitive (`AND` / `and` / `And`).                                           |
| Case of identifiers     | Case-sensitive (`score` ≠ `Score`).                                                 |
| String quoting          | Single quotes only. Double quotes are a syntax error (no collision with JSON/YAML). |
| `LIKE` wildcards        | SQL standard: `%` = any sequence (incl. empty), `_` = exactly one char. Case-sensitive. |
| Equality (`=`, `!=`)    | JS `===` / `Object.is`. **Two-valued logic**: NULL-ish compared with anything is `false`. (Deliberate deviation from SQL's three-valued logic — documented in the Non-Goals.) |
| Ordered comparison      | Only number↔number and string↔string. Mixed types → `false`.                        |
| Arithmetic operand type | Both sides must be numbers. Otherwise → `null`.                                     |
| Division by zero        | `a / 0` → `null`. No exception thrown.                                              |
| Boolean context         | `isTruthy(v)`: not null, not undefined, not NaN, not `false`, not `0`, not `''`.    |

**Example expressions**

```
score >= 0.8 AND type IN ('DOMAIN', 'REGION')
start BETWEEN 100 AND 200
description LIKE '%kinase%'
association.disease IS NOT NULL
(score > 0.9 OR category = 'strong') AND NOT deprecated
locations.0.start > 100
```

And for `calculate`:

```
calculate: "end - start"                           as: length
calculate: "score * 100"                           as: percent
calculate: "(end - start) + 1"                     as: length_inclusive
```

### 4.3 Expression parser + compiler (`src/schema/expressions.ts`)

Hand-rolled. ~250 lines. Tokenizer, recursive-descent parser per
precedence level, then a single-pass compiler to a closure.

```ts
/**
 * SQL-WHERE-flavored expression parser + compiler for the transform
 * engine. Accepts a string, returns a reusable closure that evaluates
 * it against one `datum` record. No runtime dependency.
 *
 * Grammar: see specs/transform-engine.md §4.2.
 *
 * The compiled closure is:
 *   - Pure.     Never reads/writes globals; sees only the `datum`
 *               passed to it per call.
 *   - Safe.     No `new Function`, no `eval`. The AST is walked into
 *               a closure tree, never reflected back to code.
 *   - Total.    Every AST path produces a value; missing fields,
 *               type-mismatches, and div-by-zero all evaluate to
 *               `null` (or `false` for predicates) rather than
 *               throwing at evaluate time.
 */

// ─────────────────────────────────────────────────────────────
// Lexer
// ─────────────────────────────────────────────────────────────

type TokenType =
  | 'NUMBER' | 'STRING' | 'IDENT'
  | 'AND' | 'OR' | 'NOT' | 'IN' | 'BETWEEN' | 'LIKE'
  | 'IS' | 'NULL' | 'TRUE' | 'FALSE'
  | '=' | '!=' | '<>' | '<' | '<=' | '>' | '>='
  | '+' | '-' | '*' | '/'
  | '(' | ')' | ','
  | 'EOF';

interface Token {
  type: TokenType;
  value?: string | number;
  pos: number;
}

const KEYWORDS: Record<string, TokenType> = {
  AND: 'AND', OR: 'OR', NOT: 'NOT',
  IN: 'IN', BETWEEN: 'BETWEEN', LIKE: 'LIKE',
  IS: 'IS', NULL: 'NULL', TRUE: 'TRUE', FALSE: 'FALSE',
};

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    const c = input[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    if (c === '(' || c === ')' || c === ',') {
      out.push({ type: c, pos: i }); i++; continue;
    }

    if (c === '=') { out.push({ type: '=', pos: i }); i++; continue; }
    if (c === '!' && input[i + 1] === '=') { out.push({ type: '!=', pos: i }); i += 2; continue; }
    if (c === '<') {
      if (input[i + 1] === '>') { out.push({ type: '<>', pos: i }); i += 2; continue; }
      if (input[i + 1] === '=') { out.push({ type: '<=', pos: i }); i += 2; continue; }
      out.push({ type: '<', pos: i }); i++; continue;
    }
    if (c === '>') {
      if (input[i + 1] === '=') { out.push({ type: '>=', pos: i }); i += 2; continue; }
      out.push({ type: '>', pos: i }); i++; continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      out.push({ type: c, pos: i }); i++; continue;
    }

    if (c === "'") {
      const start = i; i++;
      let s = '';
      let closed = false;
      while (i < n) {
        if (input[i] === "'") {
          if (input[i + 1] === "'") { s += "'"; i += 2; continue; }
          i++; closed = true; break;
        }
        s += input[i]; i++;
      }
      if (!closed) throw new Error(`Unterminated string at position ${start}.`);
      out.push({ type: 'STRING', value: s, pos: start });
      continue;
    }

    // Number: \d+(\.\d+)? or \.\d+
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (!m) throw new Error(`Malformed number at position ${i}.`);
      out.push({ type: 'NUMBER', value: Number(m[0]), pos: i });
      i += m[0].length; continue;
    }

    // Identifier with dotted path, or keyword
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*/.exec(input.slice(i));
      if (!m) throw new Error(`Malformed identifier at position ${i}.`);
      const word = m[0];
      const kw = KEYWORDS[word.toUpperCase()];
      if (kw) {
        out.push({ type: kw, pos: i });
      } else {
        out.push({ type: 'IDENT', value: word, pos: i });
      }
      i += word.length; continue;
    }

    throw new Error(`Unexpected character '${c}' at position ${i}.`);
  }

  out.push({ type: 'EOF', pos: n });
  return out;
}

// ─────────────────────────────────────────────────────────────
// Parser (recursive descent by precedence)
// ─────────────────────────────────────────────────────────────

type AST =
  | { tag: 'literal'; value: unknown }
  | { tag: 'ident'; path: string }
  | { tag: 'unary'; op: 'not' | 'neg'; arg: AST }
  | { tag: 'binary'; op: BinOp; left: AST; right: AST }
  | { tag: 'between'; value: AST; lo: AST; hi: AST; negate: boolean }
  | { tag: 'in'; value: AST; list: AST[]; negate: boolean }
  | { tag: 'like'; value: AST; pattern: string; negate: boolean }
  | { tag: 'is-null'; value: AST; negate: boolean };

type BinOp = 'and' | 'or' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/';

class Parser {
  private pos = 0;
  constructor(private toks: Token[]) {}

  private peek(): Token { return this.toks[this.pos]; }
  private consume(): Token { return this.toks[this.pos++]; }
  private match(t: TokenType): boolean {
    if (this.peek().type === t) { this.consume(); return true; }
    return false;
  }
  private expect(t: TokenType): Token {
    const k = this.peek();
    if (k.type !== t) {
      throw new Error(`Expected ${t} at position ${k.pos}, got ${k.type}.`);
    }
    return this.consume();
  }

  parse(): AST {
    const e = this.parseOr();
    this.expect('EOF');
    return e;
  }

  private parseOr(): AST {
    let left = this.parseAnd();
    while (this.match('OR')) left = { tag: 'binary', op: 'or', left, right: this.parseAnd() };
    return left;
  }

  private parseAnd(): AST {
    let left = this.parseNot();
    while (this.match('AND')) left = { tag: 'binary', op: 'and', left, right: this.parseNot() };
    return left;
  }

  private parseNot(): AST {
    if (this.match('NOT')) return { tag: 'unary', op: 'not', arg: this.parseNot() };
    return this.parseComparison();
  }

  private parseComparison(): AST {
    const left = this.parseAdd();
    const t = this.peek().type;

    if (t === '=' || t === '!=' || t === '<>' || t === '<' || t === '<=' || t === '>' || t === '>=') {
      const op = this.consume().type;
      const right = this.parseAdd();
      return { tag: 'binary', op: (op === '<>' ? '!=' : op) as BinOp, left, right };
    }

    const withNegate = (negate: boolean): AST => {
      const head = this.peek().type;
      if (head === 'IN') {
        this.consume();
        this.expect('(');
        const list: AST[] = [this.parseAdd()];
        while (this.match(',')) list.push(this.parseAdd());
        this.expect(')');
        return { tag: 'in', value: left, list, negate };
      }
      if (head === 'BETWEEN') {
        this.consume();
        const lo = this.parseAdd();
        this.expect('AND');
        const hi = this.parseAdd();
        return { tag: 'between', value: left, lo, hi, negate };
      }
      if (head === 'LIKE') {
        this.consume();
        const s = this.expect('STRING');
        return { tag: 'like', value: left, pattern: s.value as string, negate };
      }
      throw new Error(`Expected IN, BETWEEN, or LIKE at position ${this.peek().pos}.`);
    };

    if (t === 'IN' || t === 'BETWEEN' || t === 'LIKE') return withNegate(false);
    if (t === 'NOT') { this.consume(); return withNegate(true); }

    if (t === 'IS') {
      this.consume();
      const neg = this.match('NOT');
      this.expect('NULL');
      return { tag: 'is-null', value: left, negate: neg };
    }

    return left; // bare expression (arithmetic truth test, or calculate target)
  }

  private parseAdd(): AST {
    let left = this.parseMul();
    while (this.peek().type === '+' || this.peek().type === '-') {
      const op = this.consume().type as '+' | '-';
      left = { tag: 'binary', op, left, right: this.parseMul() };
    }
    return left;
  }

  private parseMul(): AST {
    let left = this.parseUnary();
    while (this.peek().type === '*' || this.peek().type === '/') {
      const op = this.consume().type as '*' | '/';
      left = { tag: 'binary', op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): AST {
    if (this.match('-')) return { tag: 'unary', op: 'neg', arg: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): AST {
    const t = this.peek();
    switch (t.type) {
      case 'NUMBER':
      case 'STRING': this.consume(); return { tag: 'literal', value: t.value };
      case 'TRUE':   this.consume(); return { tag: 'literal', value: true };
      case 'FALSE':  this.consume(); return { tag: 'literal', value: false };
      case 'NULL':   this.consume(); return { tag: 'literal', value: null };
      case 'IDENT':  this.consume(); return { tag: 'ident', path: t.value as string };
      case '(':      this.consume(); { const e = this.parseOr(); this.expect(')'); return e; }
      default:
        throw new Error(`Unexpected token ${t.type} at position ${t.pos}.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Compiler: AST → closure
// ─────────────────────────────────────────────────────────────

type Datum = Record<string, unknown>;
type Compiled = (datum: Datum) => unknown;

function compile(ast: AST): Compiled {
  switch (ast.tag) {
    case 'literal': { const v = ast.value; return () => v; }
    case 'ident':   { const p = ast.path;  return (d) => readDottedPath(d, p); }

    case 'unary': {
      const a = compile(ast.arg);
      if (ast.op === 'not') return (d) => !isTruthy(a(d));
      return (d) => { const v = a(d); return typeof v === 'number' ? -v : null; };
    }

    case 'binary': {
      const l = compile(ast.left), r = compile(ast.right);
      switch (ast.op) {
        case 'and': return (d) => isTruthy(l(d)) && isTruthy(r(d));
        case 'or':  return (d) => isTruthy(l(d)) || isTruthy(r(d));
        case '=':   return (d) => looseEq(l(d), r(d));
        case '!=':  return (d) => !looseEq(l(d), r(d));
        case '<':   return (d) => cmp(l(d), r(d), '<');
        case '<=':  return (d) => cmp(l(d), r(d), '<=');
        case '>':   return (d) => cmp(l(d), r(d), '>');
        case '>=':  return (d) => cmp(l(d), r(d), '>=');
        case '+':   return (d) => num(l(d), r(d), (a, b) => a + b);
        case '-':   return (d) => num(l(d), r(d), (a, b) => a - b);
        case '*':   return (d) => num(l(d), r(d), (a, b) => a * b);
        case '/':   return (d) => num(l(d), r(d), (a, b) => b === 0 ? null : a / b);
      }
      break;
    }

    case 'between': {
      const v = compile(ast.value), lo = compile(ast.lo), hi = compile(ast.hi);
      const inR = (d: Datum) => cmp(v(d), lo(d), '>=') && cmp(v(d), hi(d), '<=');
      return ast.negate ? (d) => !inR(d) : inR;
    }

    case 'in': {
      const v = compile(ast.value);
      const items = ast.list.map(compile);
      const has = (d: Datum) => { const x = v(d); return items.some((f) => looseEq(f(d), x)); };
      return ast.negate ? (d) => !has(d) : has;
    }

    case 'like': {
      const v = compile(ast.value);
      const re = likeToRegex(ast.pattern);
      const m = (d: Datum) => { const x = v(d); return typeof x === 'string' && re.test(x); };
      return ast.negate ? (d) => !m(d) : m;
    }

    case 'is-null': {
      const v = compile(ast.value);
      const n = (d: Datum) => isNullish(v(d));
      return ast.negate ? (d) => !n(d) : n;
    }
  }
  throw new Error(`Unreachable AST: ${JSON.stringify(ast)}`);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

function isTruthy(v: unknown): boolean {
  if (isNullish(v)) return false;
  return Boolean(v);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (isNullish(a) || isNullish(b)) return false; // two-valued logic
  return a === b || Object.is(a, b);
}

function cmp(a: unknown, b: unknown, op: '<' | '<=' | '>' | '>='): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'number' && typeof a !== 'string') return false;
  const x = a as number | string, y = b as number | string;
  switch (op) {
    case '<':  return x < y;
    case '<=': return x <= y;
    case '>':  return x > y;
    case '>=': return x >= y;
  }
}

function num(
  a: unknown,
  b: unknown,
  f: (x: number, y: number) => number | null
): number | null {
  return typeof a === 'number' && typeof b === 'number' ? f(a, b) : null;
}

function likeToRegex(pattern: string): RegExp {
  // Escape regex specials, then translate SQL wildcards.
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = esc.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${body}$`);
}

const MAX_DOTTED_PATH_DEPTH = 32;
function readDottedPath(obj: Datum, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  const segs = path.split('.');
  if (segs.length > MAX_DOTTED_PATH_DEPTH) return undefined;
  let cur: unknown = obj;
  for (const k of segs) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Parse a SQL-WHERE-flavored expression string and return a reusable
 * closure that evaluates it against one `datum`. Errors from the
 * tokenizer / parser surface at compile time; evaluation-time errors
 * are absorbed into `null` / `false` so one bad item does not abort
 * a pipeline.
 */
export function compileExpression(expression: string): Compiled {
  const tokens = tokenize(expression);
  const ast = new Parser(tokens).parse();
  return compile(ast);
}
```

### 4.4 The engine (`src/schema/transforms.ts`)

The engine proper — dispatch, the five built-in operators, the
custom-operator registry path, and the track-level `filter: "<value>"`
shortcut implementation. Paste-in quality:

```ts
/**
 * ProtVista transform engine.
 *
 * Implements the Vega-Lite-subset-shaped vocabulary documented in this doc:
 *
 *   filter | calculate | rename | pick | limit
 *
 * plus the track-level `filter: "<value>"` shortcut documented on
 * `TrackConfig`.
 *
 * Dispatch:
 *
 *   - The 5 built-ins are handled directly on a fast path — no
 *     registry lookup.
 *   - Any step whose key is not a built-in is dispatched via
 *     `opts.registry.getTransform(name)`.
 *
 * Expression strings (`filter: "<expr>"`, `calculate: "<expr>"`) are
 * compiled via the SQL-WHERE-flavored in-tree parser in
 * `src/schema/expressions.ts`.
 *
 * Error handling:
 *
 *   - A `calculate` expression that throws or returns a non-number
 *     for an item → that item's `as` field is set to `null`; one
 *     aggregated `console.warn` per track.
 *   - An expression-string `filter` that returns falsy → the item is
 *     filtered out.
 *   - Unknown operator keys, empty predicates, bad comparator operand
 *     types, etc. are validation-layer errors.
 */

import { compileExpression } from './expressions';
import type { Transform, FieldPredicate, TransformFunction } from './types';
import type { Registry } from './registry';

interface ApplyTransformsOptions {
  registry?: Registry;
  filter?: string;  // track-level shortcut
  trackRef?: string;
}

export function applyTransforms(
  items: readonly unknown[],
  steps: readonly Transform[],
  opts: ApplyTransformsOptions = {}
): unknown[] {
  let current: unknown[] = [...items];

  // Track-level `filter: "X"` shortcut — applied FIRST.
  if (typeof opts.filter === 'string' && opts.filter.length > 0) {
    const value = opts.filter;
    current = current.filter((i) => isRecord(i) && i['type'] === value);
  }

  for (const step of steps) current = applyStep(current, step, opts);
  return current;
}

function applyStep(items: unknown[], step: Transform, opts: ApplyTransformsOptions): unknown[] {
  if ('filter' in step)                    return filterStep(items, step.filter);
  if ('calculate' in step && 'as' in step) return calculateStep(items, step, opts);
  if ('rename' in step)                    return renameStep(items, step.rename);
  if ('pick' in step)                      return pickStep(items, step.pick);
  if ('limit' in step)                     return limitStep(items, step.limit);

  // Custom operator — dispatch via registry.
  const asRecord = step as unknown as Record<string, unknown>;
  const keys = Object.keys(asRecord);
  if (keys.length !== 1) {
    throw new Error(
      `Transform step must have exactly one operator key; got: ${keys.join(', ') || '(none)'}.`
    );
  }
  const opName = keys[0];
  const fn = opts.registry?.getTransform(opName);
  if (!fn) {
    throw new Error(
      `Unknown transform operator '${opName}'. Did you forget to call registerTransform()?`
    );
  }
  const result = fn(items, asRecord[opName]);
  if (isPromise(result)) {
    throw new Error(
      `Transform operator '${opName}' returned a Promise, but applyTransforms is synchronous.`
    );
  }
  return result;
}

// ── filter ─────────────────────────────────────────────────

function filterStep(items: unknown[], predicate: FieldPredicate | string): unknown[] {
  if (typeof predicate === 'string') {
    const fn = compileExpression(predicate);
    return items.filter((item) => {
      try {
        return Boolean(fn(isRecord(item) ? item : {}));
      } catch {
        return false;
      }
    });
  }
  return items.filter(fieldPredicateToFn(predicate));
}

export function fieldPredicateToFn(p: FieldPredicate): (item: unknown) => boolean {
  const { field } = p;
  return (item: unknown) => {
    if (!isRecord(item)) return false;
    const value = readDottedPath(item, field);
    if ('equal' in p) return value === p.equal || Object.is(value, p.equal);
    if ('lt'    in p && p.lt    !== undefined) return orderCompare(value, p.lt,  '<');
    if ('lte'   in p && p.lte   !== undefined) return orderCompare(value, p.lte, '<=');
    if ('gt'    in p && p.gt    !== undefined) return orderCompare(value, p.gt,  '>');
    if ('gte'   in p && p.gte   !== undefined) return orderCompare(value, p.gte, '>=');
    if (Array.isArray(p.oneOf)) return p.oneOf.includes(value);
    if (Array.isArray(p.range) && p.range.length === 2) {
      return orderCompare(value, p.range[0], '>=') && orderCompare(value, p.range[1], '<=');
    }
    if ('valid' in p) {
      const isValid = value !== null && value !== undefined
        && !(typeof value === 'number' && Number.isNaN(value));
      return p.valid ? isValid : !isValid;
    }
    return true; // empty predicate, schema-layer bug — fail open
  };
}

// ── calculate ──────────────────────────────────────────────

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
    try { value = fn(datum); } catch { failures += 1; value = null; }
    return { ...datum, [step.as]: value };
  });
  if (failures > 0) {
    console.warn(
      `[protvista] calculate '${step.calculate}' → '${step.as}' threw for ${failures} item(s) on ${opts.trackRef ?? '<unknown track>'}; those items have '${step.as}' = null.`
    );
  }
  return out;
}

// ── rename / pick / limit ──────────────────────────────────

function renameStep(items: unknown[], map: Record<string, string>): unknown[] {
  return items.map((item) => {
    if (!isRecord(item)) return item;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      out[Object.prototype.hasOwnProperty.call(map, k) ? map[k] : k] = v;
    }
    return out;
  });
}

function pickStep(items: unknown[], fields: readonly string[]): unknown[] {
  return items.map((item) => {
    if (!isRecord(item)) return item;
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(item, f)) out[f] = item[f];
    }
    return out;
  });
}

function limitStep(items: unknown[], n: number): unknown[] {
  return items.slice(0, Math.max(0, Math.floor(n)));
}

// ── Built-in registration ──────────────────────────────────

export function registerBuiltinTransforms(registry: Registry): void {
  registry.registerTransform('filter', ((items, params) => {
    if (typeof params === 'string') {
      throw new Error(
        `Expression-string filter is not supported via registry dispatch; use applyTransforms().`
      );
    }
    return (items as unknown[]).filter(fieldPredicateToFn(params as FieldPredicate));
  }) as TransformFunction);

  registry.registerTransform('calculate', (() => {
    throw new Error(
      `'calculate' is not dispatched through the registry; it requires an expression evaluator.`
    );
  }) as TransformFunction);

  registry.registerTransform('rename', ((items, params) =>
    renameStep(items as unknown[], params as Record<string, string>)) as TransformFunction);
  registry.registerTransform('pick', ((items, params) =>
    pickStep(items as unknown[], params as string[])) as TransformFunction);
  registry.registerTransform('limit', ((items, params) =>
    limitStep(items as unknown[], params as number)) as TransformFunction);
}

// ── Helpers (duplicated tiny ones to keep this file self-contained) ──

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isPromise(v: unknown): v is Promise<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}
function orderCompare(a: unknown, b: unknown, op: '<' | '<=' | '>' | '>='): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'number' && typeof a !== 'string') return false;
  const x = a as number | string, y = b as number | string;
  switch (op) { case '<': return x < y; case '<=': return x <= y; case '>': return x > y; case '>=': return x >= y; }
}
const MAX_DOTTED_PATH_DEPTH = 32;
function readDottedPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  const segs = path.split('.');
  if (segs.length > MAX_DOTTED_PATH_DEPTH) return undefined;
  let cur: unknown = obj;
  for (const k of segs) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}
```

### 4.5 Registry surface (`src/schema/registry.ts`)

Add a transforms bucket and the built-in-operator-name export:

```ts
export interface Registry {
  // …existing buckets (semanticKinds, adapters, themes)…
  registerTransform(name: string, fn: TransformFunction): void;
  getTransform(name: string): TransformFunction | undefined;
  hasTransform(name: string): boolean;
  listTransforms(): string[];
}

export const BUILTIN_TRANSFORM_OPERATORS: readonly string[] = [
  'filter', 'calculate', 'rename', 'pick', 'limit',
];
```

### 4.6 Validator (`src/schema/validate.ts`)

Add a transform-vocabulary pass:

```ts
function checkTransform(
  trackPath: string,
  step: Transform,
  registry: Registry,
  issues: ValidationIssue[]
): void {
  const keys = Object.keys(step);
  const knownOps = new Set<string>([
    ...BUILTIN_TRANSFORM_OPERATORS,
    ...registry.listTransforms(),
  ]);
  const op = keys.find((k) => knownOps.has(k));
  if (!op) {
    issues.push({
      path: trackPath,
      message: `Unknown transform operator in track ${trackPath}. Valid operators: ${listQuoted(knownOps)}.`,
      code: 'unknown-transform-operator',
    });
    return;
  }

  if (op === 'filter') {
    const filterStep = step as { filter: FieldPredicate | string };
    if (typeof filterStep.filter === 'object' && filterStep.filter !== null) {
      const pred = filterStep.filter as FieldPredicate;
      const has = STRUCTURED_PREDICATE_OPERATORS.some((k) => k in pred);
      if (!has) {
        issues.push({
          path: trackPath,
          message: `Filter predicate on field '${pred.field}' must include one of: ${STRUCTURED_PREDICATE_OPERATORS.join(', ')}.`,
          code: 'missing-predicate-operator',
        });
      }
    }
  }
}

const STRUCTURED_PREDICATE_OPERATORS = [
  'equal', 'lt', 'lte', 'gt', 'gte', 'oneOf', 'range', 'valid',
] as const;
```

Also add the `ajvErrorToIssue` special-case so a FieldPredicate `anyOf`
failure is promoted to `missing-predicate-operator` with the field name
in the message.

**Parser errors at validation time (optional, recommended).** Because
the expression string is parsed lazily at apply time, authors with a
typo (`score >>> 0.8`) only see it when the track actually loads. For
a better author experience, have the validator try `compileExpression(...)`
inside a try/catch on every string-form `filter:` / `calculate:` and
surface parse errors as a new `invalid-expression` issue code, with the
error position from the lexer/parser.

### 4.7 Normalizer (`src/schema/normalize.ts`)

Preserve `transform:` verbatim on the descriptor:

```ts
// In NormalizedDataSource:
transform?: Transform[];

// In expandDescriptor():
if (d.transform !== undefined) out.transform = d.transform;
```

### 4.8 Loader wire-in (`src/load-data.ts`)

Two call sites (URL-sourced and `from: custom` branches). Replace the
inline `.filter(...)` with `applyTransforms(...)`:

```ts
import { applyTransforms } from './schema/transforms';

// …
const filtered = Array.isArray(transformedData)
  ? applyTransforms(transformedData, first.transform ?? [], {
      filter,
      registry,
      trackRef: `${groupId}/${trackId}`,
    })
  : transformedData;
```

Thread the `Registry` through `loadProtvistaData()`'s signature, same
way the adapter map is threaded today. At loader init (before the first
`_loadData()`), call `registerBuiltinTransforms(registry)` exactly once.

---

## 5. Tests

Three test files.

### 5.1 `src/schema/__spec__/expressions.spec.ts` — parser + evaluator

The core of the new surface. Covers:

- **Lexer.** Each token type — keywords (case-insensitive), operators,
  numbers (integer / decimal / exponent / leading-dot), strings (with
  `''` escape, with unterminated-string error), identifiers (simple,
  dotted, mixed-case).
- **Parser operator precedence.** `a OR b AND c` → `a OR (b AND c)`;
  `NOT a AND b` → `(NOT a) AND b`; arithmetic: `1 + 2 * 3` → `1 + (2 *
  3)`; parentheses override.
- **Parser error cases.** Unbalanced parens, `IN` without parens,
  `BETWEEN` without `AND`, `IS` without `NULL`, `NOT` without a follow-up.
  Each test asserts the error message includes a position.
- **Evaluator — primitives.** `score > 0.8` on various `score` values;
  string equality with single-quoted literals; boolean `TRUE`/`FALSE`/
  `NULL` literals; numeric arithmetic; division by zero → `null`.
- **Evaluator — dotted paths.** `association.disease`,
  `locations.0.start`, missing-segment → `undefined` without throw,
  32-segment depth cap.
- **Evaluator — operators.**
  - `IN (…)` and `NOT IN (…)` with mixed-type lists
  - `BETWEEN a AND b` inclusive, `NOT BETWEEN`
  - `LIKE` with `%` and `_` wildcards, case-sensitivity, anchor
  - `IS NULL` / `IS NOT NULL` across `null`, `undefined`, `NaN`,
    real values, missing fields
- **Null safety.** `missing_field = 1` → `false` (two-valued logic).
  `missing_field + 1` → `null`. `5 / 0` → `null`.

### 5.2 `src/schema/__spec__/transforms.spec.ts` — engine contract

Covers:

- `fieldPredicateToFn` — every documented comparator (`equal`, `lt` /
  `lte` / `gt` / `gte` on numbers and strings, `oneOf`, `range`,
  `valid:true`, `valid:false`), dotted-path field access, non-object
  items, empty predicate (fail-open).
- `applyTransforms` — every built-in with both structured and
  expression-string forms; `rename` / `pick` pass non-objects through
  unchanged; `limit` clamps negatives and non-ints.
- `calculate` error handling — sets `as` to `null` for throwing items,
  one aggregated `console.warn` per track with `trackRef` and count.
- Track-level `filter: X` shortcut — parity with structured
  `{ filter: { field: 'type', equal: X } }`, runs before pipeline steps.
- Example pipeline — the BYO-CSV "hotspots" flow with 5 chained steps.
- Custom-operator dispatch via the registry, unknown-operator error,
  Promise-returning-operator error.
- `registerBuiltinTransforms` — registers exactly the 5 names, the
  registered `filter` wrapper accepts structured predicates and rejects
  expression strings (they must go through the engine), `calculate`'s
  wrapper always throws.

### 5.3 Validator / schema / types

Add these cases to the existing suites:

- `src/schema/__spec__/schema.spec.ts`:
  - `'Example 4: transform pipeline on CSV'` — full pipeline validates.
  - `'accepts every FieldPredicate comparison operator'` — 8 predicates.
  - `'rejects a FieldPredicate with no comparison operator'`.
  - `'rejects a Transform step with two operation keys'`.
  - `'rejects a Transform step with an unknown operation key'`.
  - Keep `setUp` with `allowUnionTypes: true` (FieldPredicate
    comparators accept `number | string`).

- `src/schema/__spec__/validate.spec.ts`:
  - `'flags a filter predicate with no comparison operator'`.
  - `'accepts a registered custom transform operator'`.
  - **New**: `'flags an unparseable expression-string filter'` — if
    §4.6 optional parse-time validation is included, assert that a
    syntax error produces an `invalid-expression` issue.

- `src/schema/__spec__/types.spec.ts`:
  - `'Transform & FieldPredicate — discriminated unions'`.
  - `'BYO CSV + transform pipeline + reusable theme'`.

- `src/schema/__spec__/normalize.spec.ts`:
  - `'normalizeConfig — transform pipeline passthrough'`.

- `src/schema/__spec__/registry.spec.ts`:
  - `'exports the five built-in transform operator names'`.
  - `'ships with no pre-registered adapters or transforms'`.
  - `'registers a custom transform operator and retrieves it'`.
  - `'throws when registering the same custom transform name twice'`.

---

## 6. Dependency

**Zero runtime dependency.** The parser is ~250 lines of hand-rolled
TypeScript in `src/schema/expressions.ts`. No `vega-expression`, no
`filtrex`, no `node-sql-parser`, no `peggy`-generated parser.

Bundle cost: roughly 2–4 kB minified+gzipped for the parser, evaluator,
and helpers. Compare: `vega-expression` ≈ 40 kB. `filtrex` ≈ 15–20 kB.
Full SQL parsers ≈ 150–400 kB.

Trade-offs:

- We own the grammar. Any future extension (`COALESCE`, function calls,
  case-insensitive `ILIKE`, etc.) is a local change, not a library bump.
- We own the bugs. `vega-expression`'s parser has had years of real-world
  exercise; a hand-rolled one starts at zero. The test suite in §5.1
  is there to compensate.
- We can tune semantics without fighting a library's opinions. Two-valued
  NULL logic, case-sensitive identifiers, SQL-style `''` string escape,
  and the dotted-path identifier form all fall out naturally.

---

## 7. Spec updates

Add these passages to `specs/config-approach.md`:

- **Non-Goals.** Add: "Implementing the transform operators or the
  SQL-WHERE expression parser. The schema defines the *shape* of
  `transform` steps and field predicates; the `filter` / `calculate` /
  `rename` / `pick` / `limit` execution, and the parser for
  SQL-flavored expression strings, live in runtime code outside this
  spec."
- **Data Model.** Add the `transform?: Transform[]` field on
  `DataSourceDescriptor`, the `Transform` discriminated union, the
  `FieldPredicate` interface, and the `registerTransform()` surface on
  `ProtvistaRuntimeAPI`.
- **Edge Cases & Error Handling table.** Add:
  - "A `transform` step has no recognised operation key … Config
    validation fails: `Unknown transform operator in track
    <groupId>/<trackId>. Valid operators: …`."
  - "A `filter` step's field predicate has no comparison operator …
    `Filter predicate on field '<name>' must include one of: equal,
    lt, lte, gt, gte, oneOf, range, valid.`"
  - "A string-form `filter:` / `calculate:` expression fails to parse
    at validation time → `Invalid expression in track <groupId>/<trackId>
    at position <N>: <message>`."
  - "A `calculate` step's expression throws at evaluate time → the
    step is skipped for that item; the `as` field is set to `null`
    on those items. A single summary `console.warn` is emitted per
    track."
- **Constraints.** No new runtime dependency — the parser lives in
  `src/schema/expressions.ts`. The allowed-dependencies list is
  unchanged.
- **Acceptance Criteria.** Add:
  - "Vega-Lite-style `transform` pipelines work for the built-in
    operators (`filter`, `calculate`, `rename`, `pick`, `limit`).
    Structured field predicates accept `equal`, `lt`, `lte`, `gt`,
    `gte`, `oneOf`, `range`, `valid`. Expression-string filters
    (`\"score >= 0.8 AND type IN ('DOMAIN')\"`) work for the same
    cases."
  - "Track-level `filter: \"<value>\"` shortcut produces the same
    output as the equivalent `transform: [{ filter: { field: \"type\",
    equal: \"<value>\" } }]` — parity test."
- **Example 4** — a BYO-CSV example using the SQL-flavored expression
  form:
  ```yaml
  tracks:
    - id: hotspots
      kind: features
      data:
        url: ./hotspots.csv
        transform:
          - filter: "score >= 0.8 AND type IN ('binding', 'catalytic')"
          - rename: { desc: description, pos_start: start, pos_end: end }
          - calculate: "end - start"
            as: length
          - limit: 500
  ```

Also update the one-line comment in `src/default-config.yaml` so it
references the new `transform:` equivalence:

```yaml
#   • `filter:` shortcuts replace the legacy per-track filter string.
#     (`filter: SIGNAL` ≡ `transform: [{ filter: { field: type, equal: SIGNAL } }]`.)
```

---

## 8. Implementation plan

One PR, one reviewer-burden.

1. Extend `src/schema/types.ts` with `Transform`, `FieldPredicate`,
   `TransformFunction`, `DataSourceDescriptor.transform?:`, and
   `ProtvistaRuntimeAPI.registerTransform()`.
2. Extend `src/schema/schema.json` with the `Transform` /
   `FieldPredicate` `$defs` and the `transform:` property on
   `DataSourceDescriptor`.
3. Extend `src/schema/registry.ts` with the transforms bucket and
   `BUILTIN_TRANSFORM_OPERATORS`.
4. Re-export `BUILTIN_TRANSFORM_OPERATORS`, `Transform`,
   `FieldPredicate`, and `TransformFunction` from
   `src/schema/index.ts`.
5. Create `src/schema/expressions.ts` with the hand-rolled parser +
   compiler (section 4.3).
6. Create `src/schema/transforms.ts` with the engine (section 4.4).
7. Extend `src/schema/validate.ts` with the `anyOf` → predicate-operator
   special-case, the `checkTransform` pass, and (optionally) parse-time
   expression validation.
8. Preserve `transform` in `src/schema/normalize.ts`.
9. Replace the two inline `.filter(...)` call sites in
   `src/load-data.ts` with `applyTransforms(...)`. Call
   `registerBuiltinTransforms(registry)` once at loader init.
10. Write the three test suites (section 5).
11. Restore the spec passages in `specs/config-approach.md`.
12. Run `tsc`, `eslint`, `vitest` to green. Update any downstream
    snapshot as needed.

### Acceptance checklist

- [ ] The default UniProt config still loads and renders identically
      (no one adds a `transform:` block to it).
- [ ] An author can paste the Example 4 YAML verbatim and have it
      validate, load, and render.
- [ ] `filter: "DOMAIN"` and `transform: [{ filter: { field: "type",
      equal: "DOMAIN" } }]` produce the same output on the same input
      (parity test).
- [ ] Every documented SQL-WHERE operator (`AND`, `OR`, `NOT`, `=`,
      `!=`, `<>`, `<`, `<=`, `>`, `>=`, `IN`, `NOT IN`, `BETWEEN`,
      `NOT BETWEEN`, `LIKE`, `NOT LIKE`, `IS NULL`, `IS NOT NULL`,
      `+`, `-`, `*`, `/`, parens) has at least one passing test.
- [ ] Dotted-path identifier access (`association.disease`,
      `locations.0.start`) works in both `filter:` expressions and
      structured predicates.
- [ ] `calculate` error aggregation emits exactly one `console.warn`
      per track for N failing items.
- [ ] A custom `registerTransform("aggregateBy", …)` registration
      validates and runs end to end.
- [ ] Bundle-size delta stays under 5 kB gzipped (run
      `npm run build` + visualizer before and after).
