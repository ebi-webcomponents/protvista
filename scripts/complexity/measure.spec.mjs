/**
 * @vitest-environment node
 *
 * Tests for `measure.mjs`, the code size and complexity measurement behind
 * docs/program/complexity-report.md.
 *
 * Most tests run on a small source tree written to a temporary directory, so
 * they need no git history: function naming and attribution, line counts,
 * area assignment, test exclusion, statistics, argument parsing, and the
 * checks that stop a misconfigured run from printing wrong figures. The
 * calibration file pins the score of every construct the report says is
 * counted, so an ESLint or parser upgrade that changes the scoring fails
 * here. The last block re-measures the commits the report cites and checks
 * the report's tables against the output; it is skipped in a shallow clone
 * that lacks those commits.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './eslint.complexity.config.mjs';
import {
  LIBRARY,
  TEST,
  areaOf,
  measureFile,
  measureRef,
  measureTree,
  parseArgs,
  renderReport,
  ruleOptions,
  stats,
  topFunctions,
} from './measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = join(HERE, '../../docs/program/complexity-report.md');

const ELEMENT = `// A host element.
/* A block comment
   over two lines. */
export class A {
  m() {
    if (x) {
    }
  }

  f = () => a ?? b;
  g = 1;
  #p = this.g || 2;

  static s() {
    return [1].map((v) => (v ? v : 0));
  }
}

export function h(arr) {
  arr.forEach(() => {
    if (y) {
    }
  });
  const tag = \`line one
line two\`;
  return tag; // trailing comment
}
`;

// One function per group of constructs; the expected score is 1 plus one per
// branch, as the report's Method section describes.
const CALIBRATION = `export function plain() {
  return 1;
}

export function branches(a, b) {
  if (a) return a ? 1 : 2;
  for (;;) break;
  for (const x of a) b += x;
  for (const k in a) b += k;
  while (b) b--;
  do b++;
  while (b < 0);
  try {
    b = a && b;
  } catch {
    b = a || b;
  }
  return b;
}

export function nullish(a, { b = 1 } = {}) {
  a ??= b;
  return a?.c?.() ?? a?.[b];
}

export function cases(a: number): number {
  switch (a) {
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return 3;
  }
}
`;

const TREE = {
  'src/protvista-uniprot.ts': ELEMENT,
  'src/utils/calibration.ts': CALIBRATION,
  'src/schema/fetch-text.ts': 'export const fetchText = (u) => u || null;\n',
  'src/schema/adapters/bed.ts': 'export function bed(t) {\n  return t;\n}\n',
  'src/schema/validate.ts':
    'export function validate(c) {\n  return c && c.ok;\n}\n',
  'src/config.ts': "export { default } from './default';\n",
  'src/tooltips/resolve.ts': 'export const resolve = (t) => t?.x;\n',
  'src/styles/theme.ts': 'export const css = `a { color: red; }`;\n',
  'src/playground/index.ts':
    'export function load(f) {\n  if (f) return 1;\n  return 0;\n}\n',
  'src/types.d.ts': 'export interface T {\n  a: string;\n}\n',
  'src/spec.ts': 'export const spec = 1;\n',
  // Test code, which the measurement skips.
  'src/__spec__/a.spec.ts': 'it("x", () => {});\n',
  'src/x.test.ts': 'it("x", () => {});\n',
  'src/a/__fixtures__/f.ts': 'export const f = () => 1;\n',
};

let root;
let files;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'complexity-spec-'));
  for (const [path, text] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  files = measureTree(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const byPath = (path) => files.find((f) => f.path === path);
const scores = (path) =>
  byPath(path).functions.map(({ name, complexity, field, line }) => [
    name,
    complexity,
    field,
    line,
  ]);

describe('measureTree', () => {
  it('measures every non-test .ts file under src/, sorted by path', () => {
    expect(files.map((f) => f.path)).toEqual([
      'src/config.ts',
      'src/playground/index.ts',
      'src/protvista-uniprot.ts',
      'src/schema/adapters/bed.ts',
      'src/schema/fetch-text.ts',
      'src/schema/validate.ts',
      'src/spec.ts',
      'src/styles/theme.ts',
      'src/tooltips/resolve.ts',
      'src/types.d.ts',
      'src/utils/calibration.ts',
    ]);
  });

  it('names and scores methods, fields, callbacks and functions', () => {
    expect(scores('src/protvista-uniprot.ts')).toEqual([
      ['A.m', 2, false, 5],
      ['A.f', 2, false, 10],
      ['A.f (field)', 1, true, 10],
      ['A.g (field)', 1, true, 11],
      ['A.p (field)', 2, true, 12],
      ['A.s', 1, false, 14],
      ['A.s > map callback', 2, false, 15],
      ['h', 1, false, 19],
      ['h > forEach callback', 2, false, 20],
    ]);
  });

  it('scores each counted construct as one branch (calibration)', () => {
    expect(scores('src/utils/calibration.ts')).toEqual([
      ['plain', 1, false, 1],
      // if, ?:, for, for-of, for-in, while, do-while, catch, &&, ||
      ['branches', 11, false, 5],
      // two default values, ??=, three ?., ??
      ['nullish', 8, false, 21],
      // classic variant: each case with a test
      ['cases', 3, false, 26],
    ]);
  });

  it('counts total, code and comment-only lines', () => {
    const { lines, code, comment } = byPath('src/protvista-uniprot.ts');
    // 27 lines: 3 comment-only (the line comment and the two-line block
    // comment), 3 blank, the rest code. The trailing comment shares a line
    // with code, and both lines of the template literal are code.
    expect({ lines, code, comment }).toEqual({
      lines: 27,
      code: 21,
      comment: 3,
    });
  });

  it('assigns areas and keeps the playground out of the library', () => {
    const area = Object.fromEntries(files.map((f) => [f.path, f.area]));
    expect(area).toEqual({
      'src/config.ts': 'schema, config and validation',
      'src/playground/index.ts': 'playground',
      'src/protvista-uniprot.ts': 'element',
      'src/schema/adapters/bed.ts': 'loader and adapters',
      'src/schema/fetch-text.ts': 'loader and adapters',
      'src/schema/validate.ts': 'schema, config and validation',
      'src/spec.ts': 'other',
      'src/styles/theme.ts': 'styles',
      'src/tooltips/resolve.ts': 'tooltips',
      'src/types.d.ts': 'other',
      'src/utils/calibration.ts': 'other',
    });
  });

  it('renders the totals the report tables are built from', () => {
    const text = renderReport(
      { sha: 'abc1234', date: '2026-01-01', files },
      { top: 3, files: false, list: [] }
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Complexity of src/ at abc1234 (2026-01-01)');
    expect(lines[2]).toMatch(
      /^Node v[\d.]+, ESLint [\d.]+, @typescript-eslint\/parser [\d.]+, TypeScript [\d.]+\. Rule: complexity \(classic\), max 0\. Tests excluded\.$/
    );
    expect(lines.slice(4, 16)).toEqual([
      '| Area | Files | Lines | Code lines | Comment lines | Functions | Total complexity | Mean | Median | Max | > 10 | > 20 |',
      '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
      '| tooltips | 1 | 1 | 1 | 0 | 1 | 2 | 2.00 | 2 | 2 | 0 | 0 |',
      '| styles | 1 | 1 | 1 | 0 | 0 | 0 | 0.00 | 0 | 0 | 0 | 0 |',
      '| loader and adapters | 2 | 4 | 4 | 0 | 2 | 3 | 1.50 | 1.5 | 2 | 0 | 0 |',
      '| schema, config and validation | 2 | 4 | 4 | 0 | 1 | 2 | 2.00 | 2 | 2 | 0 | 0 |',
      '| element | 1 | 27 | 21 | 3 | 9 | 14 | 1.56 | 2 | 2 | 0 | 0 |',
      '| other | 3 | 39 | 36 | 0 | 4 | 23 | 5.75 | 5.5 | 11 | 1 | 0 |',
      '| **library total** | 10 | 76 | 67 | 3 | 17 | 44 | 2.59 | 2 | 11 | 1 | 0 |',
      '| playground | 1 | 4 | 4 | 0 | 1 | 2 | 2.00 | 2 | 2 | 0 | 0 |',
      '| **all (library + playground)** | 11 | 80 | 71 | 3 | 18 | 46 | 2.56 | 2 | 11 | 1 | 0 |',
      '',
    ]);
    expect(text).toContain(
      'Functions include 3 class-field initialisers in the library'
    );
    expect(text).toContain(
      [
        '## Most complex library functions (top 3)',
        '',
        '| Complexity | Function | Location |',
        '|--:|---|---|',
        '| 11 | `branches` | `src/utils/calibration.ts:5` |',
        '| 8 | `nullish` | `src/utils/calibration.ts:21` |',
        '| 3 | `cases` | `src/utils/calibration.ts:26` |',
        '',
      ].join('\n')
    );
  });
});

describe('areaOf and TEST', () => {
  it('applies the first matching area', () => {
    expect(areaOf('src/schema/fetch-text.ts')).toBe('loader and adapters');
    expect(areaOf('src/schema/file-formats.ts')).toBe('loader and adapters');
    expect(areaOf('src/schema/adapters/x.ts')).toBe('loader and adapters');
    expect(areaOf('src/adapters/x.ts')).toBe('loader and adapters');
    expect(areaOf('src/load-data.ts')).toBe('loader and adapters');
    expect(areaOf('src/feature-source.ts')).toBe('loader and adapters');
    expect(areaOf('src/schema/validate.ts')).toBe(
      'schema, config and validation'
    );
    expect(areaOf('src/config.ts')).toBe('schema, config and validation');
    expect(areaOf('src/layout.ts')).toBe('element');
    expect(areaOf('src/layout-persistence.ts')).toBe('element');
    expect(areaOf('src/renderer/x.ts')).toBe('element');
    expect(areaOf('src/errors/x.ts')).toBe('element');
    expect(areaOf('src/protvista-uniprot.ts')).toBe('element');
    expect(areaOf('src/protvista-uniprot-structure.ts')).toBe('other');
    expect(areaOf('src/layout-other.ts')).toBe('other');
    expect(areaOf('src/playground/schema/x.ts')).toBe('playground');
  });

  it('lists the library areas in report order, without the playground', () => {
    expect(LIBRARY).toEqual([
      'tooltips',
      'styles',
      'loader and adapters',
      'schema, config and validation',
      'element',
      'other',
    ]);
  });

  it('matches test code only', () => {
    for (const path of [
      'src/a/__spec__/b.ts',
      'src/__tests__/b.ts',
      'src/a/__browser__/b.ts',
      'src/__fixtures__/b.ts',
      'src/__mocks__/b.ts',
      'src/x.test.ts',
      'src/a/x.spec.ts',
    ])
      expect(TEST.test(path), path).toBe(true);
    for (const path of ['src/spec.ts', 'src/a/test.ts', 'src/specs/x.ts'])
      expect(TEST.test(path), path).toBe(false);
  });
});

describe('stats and topFunctions', () => {
  const file = (...ccs) => ({
    lines: 1,
    code: 1,
    comment: 0,
    functions: ccs.map((complexity, i) => ({
      complexity,
      line: i + 1,
      name: `f${i}`,
      field: false,
    })),
  });

  it('takes the median of an even count as the mean of the middle two', () => {
    expect(stats([file(2, 1)]).median).toBe(1.5);
    expect(stats([file(4, 1), file(3, 2)]).median).toBe(2.5);
  });

  it('handles one function and no functions', () => {
    expect(stats([file(7)])).toMatchObject({
      functions: 1,
      total: 7,
      mean: 7,
      median: 7,
      max: 7,
    });
    expect(stats([file()])).toMatchObject({
      functions: 0,
      total: 0,
      mean: 0,
      median: 0,
      max: 0,
    });
  });

  it('counts functions strictly over 10 and over 20', () => {
    expect(stats([file(10, 11, 20, 21)])).toMatchObject({
      over10: 3,
      over20: 1,
    });
  });

  it('orders by complexity, then path, then line', () => {
    const files = [
      { path: 'src/b.ts', ...file(5, 9) },
      { path: 'src/a.ts', ...file(5, 1, 5) },
    ];
    expect(topFunctions(files, 3).map((f) => `${f.path}:${f.line}`)).toEqual([
      'src/b.ts:2',
      'src/a.ts:1',
      'src/a.ts:3',
    ]);
  });
});

describe('parseArgs', () => {
  it('reads a ref and options', () => {
    expect(
      parseArgs(['abc', '--top', '3', '--files', '--list', 'x', '--json', 'o'])
    ).toEqual({ ref: 'abc', top: 3, files: true, list: ['x'], json: 'o' });
    expect(parseArgs([])).toEqual({
      ref: 'HEAD',
      top: 15,
      files: false,
      list: [],
      json: null,
    });
  });

  it('rejects a missing or non-numeric --top instead of listing nothing', () => {
    expect(() => parseArgs(['--top'])).toThrow(/--top needs a value/);
    expect(() => parseArgs(['--top', 'x'])).toThrow(/positive whole number/);
    expect(() => parseArgs(['--top', '0'])).toThrow(/positive whole number/);
    expect(() => parseArgs(['--top', '--files'])).toThrow(/needs a value/);
  });

  it('rejects --list and --json without a value, and unknown options', () => {
    expect(() => parseArgs(['--list'])).toThrow(/--list needs a value/);
    expect(() => parseArgs(['--json', '--files'])).toThrow(
      /--json needs a value/
    );
    expect(() => parseArgs(['--nope'])).toThrow(/unknown option --nope/);
  });
});

describe('measureFile refuses a run that would print wrong figures', () => {
  const at = (path) => join(root, path);
  const withRule = (rule, linterOptions = {}) =>
    config.map((c) => ({
      ...c,
      linterOptions: { ...c.linterOptions, ...linterOptions },
      rules: { complexity: ['warn', { ...c.rules.complexity[1], ...rule }] },
    }));

  it('reads the rule options it reports from the config', () => {
    expect(ruleOptions()).toEqual({
      max: 0,
      variant: 'classic',
      noInlineConfig: true,
    });
  });

  it('throws when the config does not match the file', () => {
    const unmatched = config.map((c) => ({ ...c, files: ['**/*.js'] }));
    // Twice, so that the second file cannot reuse the first file's parse.
    for (const path of ['src/spec.ts', 'src/utils/calibration.ts'])
      expect(() => measureFile(root, at(path), unmatched)).toThrow(
        /No matching configuration/
      );
  });

  it('throws when not every function is reported', () => {
    expect(() =>
      measureFile(root, at('src/protvista-uniprot.ts'), withRule({ max: 1 }))
    ).toThrow(/6 functions in the source but 4 complexity reports/);
  });

  it('throws when an eslint-disable comment could hide a function', () => {
    const path = 'src/disabled.ts';
    writeFileSync(
      at(path),
      '// eslint-disable-next-line complexity\nexport function d() {}\n'
    );
    try {
      expect(measureFile(root, at(path)).functions).toHaveLength(1);
      expect(() =>
        measureFile(root, at(path), withRule({}, { noInlineConfig: false }))
      ).toThrow(/1 functions in the source but 0 complexity reports/);
    } finally {
      rmSync(at(path));
    }
  });
});

// The commits the report cites. A shallow clone does not have them.
const COMMITS = ['9615385', '17a2ea0', '09f1832'];
const haveCommits = COMMITS.every((sha) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
});

// The rows of the first table after `heading`, as arrays of trimmed cells.
function reportRows(text, heading) {
  const lines = text.split('\n');
  let i = lines.indexOf(heading);
  expect(i, heading).toBeGreaterThan(-1);
  while (!lines[i].startsWith('|')) i++;
  const rows = [];
  for (i += 2; lines[i]?.startsWith('|'); i++)
    rows.push(
      lines[i]
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
    );
  return rows;
}

// The same, as a map from each row's first cell to the rest.
function reportTable(text, heading) {
  return new Map(
    reportRows(text, heading).map(([label, ...cells]) => [label, cells])
  );
}

describe.skipIf(!haveCommits)('the figures in complexity-report.md', () => {
  const n = (x) => x.toLocaleString('en-GB');
  const pct = (part, whole) => `${((100 * part) / whole).toFixed(1)}%`;
  let report;
  let measured;

  beforeAll(() => {
    report = readFileSync(REPORT, 'utf8');
    measured = Object.fromEntries(COMMITS.map((sha) => [sha, measureRef(sha)]));
  }, 120_000);

  const library = (sha) =>
    measured[sha].files.filter((f) => f.area !== 'playground');
  const area = (sha, name) =>
    stats(measured[sha].files.filter((f) => f.area === name));

  it('matches the Totals table', () => {
    const rows = reportTable(report, '### Totals');
    const columns = ['9615385', '09f1832'].map((sha) => stats(library(sha)));
    const want = (fn) => columns.map(fn);
    expect(rows.get('Files')).toEqual(want((s) => n(s.files)));
    expect(rows.get('Lines')).toEqual(want((s) => n(s.lines)));
    expect(rows.get('Code lines')).toEqual(want((s) => n(s.code)));
    expect(rows.get('Comment lines')).toEqual(want((s) => n(s.comment)));
    expect(rows.get('Functions')).toEqual(want((s) => n(s.functions)));
    expect(rows.get('Total complexity')).toEqual(want((s) => n(s.total)));
    expect(rows.get('Mean complexity per function')).toEqual(
      want((s) => s.mean.toFixed(2))
    );
    expect(rows.get('Median')).toEqual(want((s) => String(s.median)));
    expect(rows.get('Maximum')).toEqual(want((s) => String(s.max)));
    expect(rows.get('Functions over 10')).toEqual(
      want((s) => `${s.over10} (${pct(s.over10, s.functions)})`)
    );
    expect(rows.get('Functions over 20')).toEqual(
      want((s) => String(s.over20))
    );
  });

  it('matches the By area table', () => {
    const rows = reportTable(report, '### By area');
    for (const name of [...LIBRARY, 'playground']) {
      const q1 = area('9615385', name);
      const next = area('09f1832', name);
      const old =
        q1.files === 0
          ? ['—', '—', '—']
          : [n(q1.lines), n(q1.total), String(q1.max)];
      expect(rows.get(name), name).toEqual([
        ...old,
        n(next.lines),
        n(next.total),
        String(next.max),
        String(next.over10),
      ]);
    }
    const total = (sha) => stats(library(sha));
    expect(rows.get('**library total**')).toEqual([
      n(total('9615385').lines),
      n(total('9615385').total),
      String(total('9615385').max),
      n(total('09f1832').lines),
      n(total('09f1832').total),
      String(total('09f1832').max),
      String(total('09f1832').over10),
    ]);
  });

  it('matches the Effect of PR #407 table', () => {
    const rows = reportTable(report, '## Effect of PR #407');
    const columns = ['17a2ea0', '09f1832'].map((sha) => stats(library(sha)));
    const host = ['17a2ea0', '09f1832'].map((sha) =>
      stats(
        measured[sha].files.filter((f) => f.path === 'src/protvista-uniprot.ts')
      )
    );
    expect(rows.get('Total complexity')).toEqual(
      columns.map((s) => n(s.total))
    );
    expect(rows.get('Functions')).toEqual(columns.map((s) => n(s.functions)));
    expect(rows.get('Mean')).toEqual(columns.map((s) => s.mean.toFixed(2)));
    expect(rows.get('Maximum')).toEqual(columns.map((s) => String(s.max)));
    expect(rows.get('Functions over 10')).toEqual(
      columns.map((s) => String(s.over10))
    );
    expect(rows.get('Functions over 20')).toEqual(
      columns.map((s) => String(s.over20))
    );
    expect(rows.get('`src/protvista-uniprot.ts` lines')).toEqual(
      host.map((s) => n(s.lines))
    );
    expect(rows.get('`src/protvista-uniprot.ts` complexity')).toEqual(
      host.map((s) => n(s.total))
    );
  });

  it('matches the most complex functions on next', () => {
    const rows = reportRows(report, '### Most complex functions on `next`');
    const top = topFunctions(library('09f1832'), rows.length);
    expect(rows).toEqual(
      top.map((f) => [
        String(f.complexity),
        `\`${f.name}\``,
        `\`${f.path}:${f.line}\``,
      ])
    );
  });
});
