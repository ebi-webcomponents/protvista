#!/usr/bin/env node
// Measure code size and cyclomatic complexity of `src/` at a git commit.
//
//   node scripts/complexity/measure.mjs [<ref>] [--top N] [--files] [--list SUBSTR] [--json FILE]
//   pnpm metrics:complexity [<ref>] [options]
//
// Run it from inside this repository after `pnpm install`. The report that
// uses it is docs/program/complexity-report.md.
//
// <ref> defaults to HEAD. The committed `src/` tree of <ref> is extracted with
// `git archive` into a temporary directory and measured with this checkout's
// toolchain, so two commits are always compared with the same ESLint, parser
// and TypeScript versions (they are printed in the header).
//
// Complexity is ESLint's core `complexity` rule, configured in
// eslint.complexity.config.mjs (classic variant, every function reported).
// Lines are counted per file: `lines` matches `wc -l`; `code` is lines that
// hold at least one token; `comment` is lines that hold only comments.
//
// Test code (__spec__, __tests__, __browser__, __fixtures__, __mocks__,
// *.spec.ts, *.test.ts) is excluded. The playground is reported as its own
// area and kept out of the library totals.
//
// Options:
//   --top N        how many of the most complex functions to list (default 15)
//   --files        also print complexity and lines per file
//   --list SUBSTR  also print every function in files whose path contains SUBSTR
//   --json FILE    write every file and function as JSON, for diffing two runs
//
// The helpers are exported for measure.spec.mjs; main() runs only when this
// file is executed directly.
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import ts from 'typescript';
import config from './eslint.complexity.config.mjs';

export const TEST =
  /(^|\/)(__spec__|__tests__|__browser__|__fixtures__|__mocks__)\/|\.(spec|test)\.ts$/;

// First match wins. The same rules are applied to every commit.
export const AREAS = [
  ['playground', /^src\/playground\//],
  ['tooltips', /^src\/tooltips\//],
  ['styles', /^src\/styles\//],
  [
    'loader and adapters',
    /^src\/(adapters\/|schema\/adapters\/|load-data\.ts$|feature-source\.ts$|schema\/fetch-text\.ts$|schema\/file-formats\.ts$)/,
  ],
  ['schema, config and validation', /^src\/(schema\/|config\.ts$)/],
  [
    'element',
    /^src\/(protvista-uniprot\.ts$|renderer\/|errors\/|layout\.ts$|layout-persistence\.ts$)/,
  ],
  ['other', /^src\//],
];
export const AREA_NAMES = AREAS.map(([name]) => name);
export const LIBRARY = AREA_NAMES.filter((name) => name !== 'playground');

export function parseArgs(argv) {
  const opts = { ref: 'HEAD', top: 15, files: false, list: [], json: null };
  const value = (i) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--'))
      throw new Error(`${argv[i - 1]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--top') {
      const v = value(++i);
      if (!/^[1-9]\d*$/.test(v))
        throw new Error(`--top needs a positive whole number, not "${v}"`);
      opts.top = Number(v);
    } else if (arg === '--files') opts.files = true;
    else if (arg === '--list') opts.list.push(value(++i));
    else if (arg === '--json') opts.json = value(++i);
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else opts.ref = arg;
  }
  return opts;
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }).trim();
}

function extract(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'protvista-complexity-'));
  const tar = execFileSync('git', ['archive', '--format=tar', ref, 'src'], {
    maxBuffer: 1 << 30,
  });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return dir;
}

// The `complexity` options the measurement depends on, read from the config
// so that the report header states what was actually run.
export function ruleOptions(cfg = config) {
  const entry = cfg.find((c) => c.rules?.complexity);
  const [, options] = entry.rules.complexity;
  return {
    max: options.max,
    variant: options.variant,
    noInlineConfig: entry.linterOptions?.noInlineConfig === true,
  };
}

export function areaOf(path) {
  return AREAS.find(([, re]) => re.test(path))[0];
}

// Line counts from the parser's tokens and comments.
export function countLines(sourceCode, text) {
  const code = new Set();
  const comment = new Set();
  const mark = (set, loc) => {
    for (let l = loc.start.line; l <= loc.end.line; l++) set.add(l);
  };
  for (const token of sourceCode.ast.tokens) mark(code, token.loc);
  for (const c of sourceCode.getAllComments()) mark(comment, c.loc);
  let commentOnly = 0;
  for (const l of comment) if (!code.has(l)) commentOnly++;
  return {
    lines: (text.match(/\n/g) || []).length,
    code: code.size,
    comment: commentOnly,
  };
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

function keyName(key) {
  if (!key) return null;
  if (key.type === 'Identifier' || key.type === 'PrivateIdentifier')
    return key.name;
  if (key.type === 'Literal') return String(key.value);
  return '[computed]';
}

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') return keyName(callee.property);
  return 'call';
}

// Collect every function and class-field initialiser with a readable name,
// so ESLint's messages ("Arrow function has a complexity of 18") can be
// attributed to e.g. "ProtvistaUniprot._loadDataInComponents > forEach callback".
export function collectFunctions(sourceCode) {
  const keys = sourceCode.visitorKeys;
  const found = [];
  const visit = (node, parent, context) => {
    let ctx = context;
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      ctx = { ...context, cls: node.id?.name ?? context.cls ?? 'class' };
    }
    if (node.type === 'PropertyDefinition' && node.value) {
      const name = `${ctx.cls ? ctx.cls + '.' : ''}${keyName(node.key)}`;
      found.push({
        kind: 'field',
        range: node.value.range,
        name: `${name} (field)`,
      });
    }
    if (FUNCTION_TYPES.has(node.type)) {
      const own = ownName(node, parent, ctx);
      const name =
        ctx.fn && !own.qualified ? `${ctx.fn} > ${own.name}` : own.name;
      // ESLint reports a method at its key, which lies outside the function node.
      const head = [
        'MethodDefinition',
        'Property',
        'PropertyDefinition',
      ].includes(parent?.type)
        ? parent.range[0]
        : node.range[0];
      found.push({ kind: 'function', range: [head, node.range[1]], name });
      ctx = { ...ctx, fn: name };
    }
    for (const key of keys[node.type] || []) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child)
          if (c && typeof c.type === 'string') visit(c, node, ctx);
      } else if (child && typeof child.type === 'string') {
        visit(child, node, ctx);
      }
    }
  };
  const ownName = (node, parent, ctx) => {
    const cls = ctx.cls && !ctx.fn ? `${ctx.cls}.` : '';
    if (node.id) return { name: node.id.name, qualified: !ctx.fn };
    if (
      parent?.type === 'MethodDefinition' ||
      parent?.type === 'PropertyDefinition'
    ) {
      return { name: `${cls}${keyName(parent.key)}`, qualified: !ctx.fn };
    }
    if (parent?.type === 'Property')
      return { name: keyName(parent.key), qualified: false };
    if (parent?.type === 'VariableDeclarator') {
      return { name: keyName(parent.id) ?? 'function', qualified: !ctx.fn };
    }
    if (parent?.type === 'CallExpression' || parent?.type === 'NewExpression') {
      return {
        name: `${calleeName(parent.callee)} callback`,
        qualified: false,
      };
    }
    return { name: 'anonymous function', qualified: false };
  };
  visit(sourceCode.ast, null, {});
  return found;
}

export function attribute(message, sourceCode, functions) {
  const offset = sourceCode.getIndexFromLoc({
    line: message.line,
    column: message.column - 1,
  });
  const isField = message.message.startsWith('Class field initializer');
  let best = null;
  for (const f of functions) {
    if ((f.kind === 'field') !== isField) continue;
    if (f.range[0] > offset || f.range[1] < offset) continue;
    if (!best || f.range[1] - f.range[0] < best.range[1] - best.range[0])
      best = f;
  }
  return best ? best.name : message.message.split(' has a complexity')[0];
}

const FIELD_MESSAGE = /^Class field initializer has a complexity of (\d+)\./;
const FUNCTION_MESSAGE = / has a complexity of (\d+)\./;

// Measure one file. `root` is the directory that holds `src/`; the config's
// `files` globs are matched relative to it. A fresh Linter per file means a
// file the config does not match cannot reuse the previous file's parse:
// ESLint then returns only a non-fatal "No matching configuration" warning
// and getSourceCode() is null, which is an error here.
export function measureFile(root, abs, cfg = config) {
  const path = relative(root, abs).split(sep).join('/');
  const text = readFileSync(abs, 'utf8');
  const linter = new Linter({ cwd: root });
  const messages = linter.verify(text, cfg, { filename: abs });
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(`${path}: ${fatal.message}`);
  const sourceCode = linter.getSourceCode();
  if (!sourceCode) {
    const why = messages.map((m) => m.message).join(' ') || 'not linted';
    throw new Error(`${path}: ${why}`);
  }
  const functions = collectFunctions(sourceCode);
  const rows = [];
  for (const m of messages) {
    if (m.ruleId !== 'complexity') continue;
    const field = FIELD_MESSAGE.exec(m.message);
    const match = field ?? FUNCTION_MESSAGE.exec(m.message);
    if (!match)
      throw new Error(`${path}:${m.line}: unrecognised message "${m.message}"`);
    rows.push({
      complexity: Number(match[1]),
      line: m.line,
      name: attribute(m, sourceCode, functions),
      field: Boolean(field),
    });
  }
  // With max 0 and inline config ignored, ESLint reports every function and
  // every class-field initialiser exactly once. Any other count means the
  // config or ESLint's wording changed, and the figures would be wrong.
  for (const kind of ['function', 'field']) {
    const want = functions.filter((f) => f.kind === kind).length;
    const got = rows.filter((r) => r.field === (kind === 'field')).length;
    if (want !== got)
      throw new Error(
        `${path}: ${want} ${kind}s in the source but ${got} complexity reports`
      );
  }
  return {
    path,
    area: areaOf(path),
    ...countLines(sourceCode, text),
    functions: rows,
  };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

// Measure every non-test `.ts` file under `<root>/src`, sorted by path.
export function measureTree(root, cfg = config) {
  return walk(join(root, 'src'))
    .map((abs) => [abs, relative(root, abs).split(sep).join('/')])
    .filter(([, path]) => !TEST.test(path))
    .map(([abs]) => measureFile(root, abs, cfg))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function stats(files) {
  const ccs = files
    .flatMap((f) => f.functions.map((fn) => fn.complexity))
    .sort((a, b) => a - b);
  const total = ccs.reduce((a, b) => a + b, 0);
  const median = ccs.length
    ? ccs.length % 2
      ? ccs[(ccs.length - 1) / 2]
      : (ccs[ccs.length / 2 - 1] + ccs[ccs.length / 2]) / 2
    : 0;
  return {
    files: files.length,
    lines: files.reduce((a, f) => a + f.lines, 0),
    code: files.reduce((a, f) => a + f.code, 0),
    comment: files.reduce((a, f) => a + f.comment, 0),
    functions: ccs.length,
    fields: files.reduce(
      (a, f) => a + f.functions.filter((fn) => fn.field).length,
      0
    ),
    total,
    mean: ccs.length ? total / ccs.length : 0,
    median,
    max: ccs.length ? ccs[ccs.length - 1] : 0,
    over10: ccs.filter((c) => c > 10).length,
    over20: ccs.filter((c) => c > 20).length,
  };
}

const n = (x) => x.toLocaleString('en-GB');

function statRow(label, s) {
  return `| ${label} | ${n(s.files)} | ${n(s.lines)} | ${n(s.code)} | ${n(s.comment)} | ${n(s.functions)} | ${n(s.total)} | ${s.mean.toFixed(2)} | ${s.median} | ${s.max} | ${s.over10} | ${s.over20} |`;
}

export function topFunctions(files, count) {
  return files
    .flatMap((f) => f.functions.map((fn) => ({ ...fn, path: f.path })))
    .sort(
      (a, b) =>
        b.complexity - a.complexity ||
        a.path.localeCompare(b.path) ||
        a.line - b.line
    )
    .slice(0, count);
}

// Measure the committed `src/` of a git ref.
export function measureRef(ref) {
  const sha = git(['rev-parse', '--short=7', `${ref}^{commit}`]);
  const date = git(['show', '-s', '--format=%cs', sha]);
  const root = extract(sha);
  try {
    return { sha, date, files: measureTree(root) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function renderReport({ sha, date, files: all }, opts) {
  const library = all.filter((f) => f.area !== 'playground');
  const rule = ruleOptions();
  const out = [];
  out.push(`# Complexity of src/ at ${sha} (${date})`);
  out.push('');
  out.push(
    `Node ${process.version}, ESLint ${Linter.version}, @typescript-eslint/parser ${tsParser.version}, TypeScript ${ts.version}. Rule: complexity (${rule.variant}), max ${rule.max}. Tests excluded.`
  );
  out.push('');
  out.push(
    '| Area | Files | Lines | Code lines | Comment lines | Functions | Total complexity | Mean | Median | Max | > 10 | > 20 |'
  );
  out.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const name of LIBRARY) {
    out.push(statRow(name, stats(library.filter((f) => f.area === name))));
  }
  const lib = stats(library);
  out.push(statRow('**library total**', lib));
  out.push(
    statRow('playground', stats(all.filter((f) => f.area === 'playground')))
  );
  out.push(statRow('**all (library + playground)**', stats(all)));
  out.push('');
  out.push(
    `Functions include ${lib.fields} class-field initialisers in the library (ESLint scores each one; most score 1).`
  );
  out.push('');
  out.push(`## Most complex library functions (top ${opts.top})`);
  out.push('');
  out.push('| Complexity | Function | Location |');
  out.push('|--:|---|---|');
  for (const fn of topFunctions(library, opts.top)) {
    out.push(
      `| ${fn.complexity} | \`${fn.name}\` | \`${fn.path}:${fn.line}\` |`
    );
  }
  out.push('');
  out.push('## Most complex playground functions (top 5)');
  out.push('');
  out.push('| Complexity | Function | Location |');
  out.push('|--:|---|---|');
  for (const fn of topFunctions(
    all.filter((f) => f.area === 'playground'),
    5
  )) {
    out.push(
      `| ${fn.complexity} | \`${fn.name}\` | \`${fn.path}:${fn.line}\` |`
    );
  }
  if (opts.files) {
    out.push('');
    out.push('## Per file');
    out.push('');
    out.push('| File | Area | Lines | Functions | Total complexity | Max |');
    out.push('|---|---|--:|--:|--:|--:|');
    for (const f of all) {
      const s = stats([f]);
      out.push(
        `| \`${f.path}\` | ${f.area} | ${n(s.lines)} | ${s.functions} | ${n(s.total)} | ${s.max} |`
      );
    }
  }
  for (const substr of opts.list) {
    out.push('');
    out.push(`## Functions in files matching "${substr}"`);
    out.push('');
    for (const f of all.filter((file) => file.path.includes(substr))) {
      for (const fn of f.functions) {
        out.push(`- ${fn.complexity} \`${fn.name}\` \`${f.path}:${fn.line}\``);
      }
    }
  }
  return out.join('\n');
}

export function main(argv) {
  const opts = parseArgs(argv);
  const result = measureRef(opts.ref);
  console.log(renderReport(result, opts));
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(result, null, 2) + '\n');
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
