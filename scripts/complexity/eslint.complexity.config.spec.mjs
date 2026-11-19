/**
 * @vitest-environment node
 *
 * Tests for the flat config used by the complexity measurement
 * (`eslint.complexity.config.mjs`). The report in
 * docs/program/complexity-report.md depends on three settings: `max: 0` (every
 * function is reported, including those scoring 1), `noInlineConfig` (an
 * `eslint-disable` comment cannot hide a function) and the classic variant
 * (each `case` is a branch). A change to any of them, or an ESLint upgrade
 * that changes what they mean, would still print plausible numbers, so each
 * is pinned here by linting small snippets with the real config.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { Linter } from 'eslint';
import config from './eslint.complexity.config.mjs';

const ROOT = process.cwd();

function complexity(code, file = 'src/a.ts') {
  const messages = new Linter({ cwd: ROOT }).verify(code, config, {
    filename: join(ROOT, file),
  });
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  return messages
    .filter((m) => m.ruleId === 'complexity')
    .map((m) => m.message);
}

describe('eslint.complexity.config.mjs', () => {
  it('reports a function that scores 1 (max 0)', () => {
    expect(complexity('function f() {}')).toEqual([
      "Function 'f' has a complexity of 1. Maximum allowed is 0.",
    ]);
  });

  it('ignores eslint-disable comments (noInlineConfig)', () => {
    const scored = [
      "Function 'g' has a complexity of 2. Maximum allowed is 0.",
    ];
    const body = 'function g(a) { if (a) return 1; return 2; }';
    expect(
      complexity(`// eslint-disable-next-line complexity\n${body}`)
    ).toEqual(scored);
    expect(complexity(`/* eslint-disable complexity */\n${body}`)).toEqual(
      scored
    );
    expect(complexity(`/* eslint-disable */\n${body}`)).toEqual(scored);
  });

  it('counts each case of a switch (classic variant)', () => {
    const code =
      'function s(a) { switch (a) { case 1: return 1; case 2: return 2; default: return 3; } }';
    expect(complexity(code)).toEqual([
      "Function 's' has a complexity of 3. Maximum allowed is 0.",
    ]);
  });

  it('counts default parameters, optional chaining and ?? as branches', () => {
    expect(complexity('function h(a = 1) { return a?.b ?? c; }')).toEqual([
      "Function 'h' has a complexity of 4. Maximum allowed is 0.",
    ]);
  });

  it('scores class-field initialisers', () => {
    expect(complexity('class C { x = a || b; }')).toEqual([
      'Class field initializer has a complexity of 2. Maximum allowed is 0.',
    ]);
  });

  it('parses TypeScript in any .ts file under the working directory', () => {
    const code =
      'export function t(a: number): string { return a > 0 ? "p" : "n"; }';
    const want = ["Function 't' has a complexity of 2. Maximum allowed is 0."];
    expect(complexity(code, 'src/deep/er/b.ts')).toEqual(want);
    expect(complexity(code, 'b.ts')).toEqual(want);
  });
});
