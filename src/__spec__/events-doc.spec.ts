/**
 * Drift test for the Events page (`docs/src/content/docs/events.md`). Its
 * "Every event" table is the integrator's contract, so this pins it against
 * the code: the events it lists are the ones the library dispatches, the
 * `protvista-error` phases it names are the `ErrorPhase` union, the
 * `LayoutPatch` shape it gives for `protvista-layout-change` is the
 * interface's, and each row's Bubbles/Composed cells match the options at
 * the dispatch site. A change to either side without the other fails here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Vitest runs from the repo root, so resolve paths from cwd.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const PAGE = read('docs/src/content/docs/events.md');

/** Every non-test TypeScript file under `src`, repo-relative. */
function sourceFiles(dir = 'src'): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), dir), {
    withFileTypes: true,
  })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^__\w+__$/.test(entry.name)) continue; // __spec__, __browser__, …
      files.push(...sourceFiles(path));
    } else if (
      /\.ts$/.test(entry.name) &&
      !/\.(spec|test)\.ts$|\.d\.ts$/.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}

interface Flags {
  bubbles: boolean;
  composed: boolean;
}

/** The text from `open` (an opening `(` or `{`) to its matching close. */
function balanced(text: string, open: number): string {
  const [left, right] = text[open] === '{' ? ['{', '}'] : ['(', ')'];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === left) depth += 1;
    else if (text[i] === right && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${left} at ${open}`);
}

/** A type literal's fields: each one's type text, or its nested fields. */
interface Shape {
  [field: string]: string | Shape;
}

/**
 * The fields of an object type literal, `{ a: T; b: { c: U } }`, with
 * comments dropped and whitespace removed from each type, so the Events
 * page's one-line form and the interface's commented form compare equal.
 */
function shape(literal: string): Shape {
  const body = literal
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim()
    .slice(1, -1);
  // Split on `,` and `;` outside any bracket.
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if ('{<(['.includes(ch)) depth += 1;
    else if ('}>)]'.includes(ch)) depth -= 1;
    else if ((ch === ',' || ch === ';') && depth === 0) {
      parts.push(body.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(body.slice(from));

  const fields: Shape = {};
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    const field = part.match(/^(\w+\??)\s*:\s*([\s\S]+)$/);
    expect(field, part).not.toBeNull();
    const type = field![2].trim();
    fields[field![1]] = type.startsWith('{')
      ? shape(type)
      : type.replace(/\s+/g, '');
  }
  return fields;
}

/** The fields of `interface LayoutPatch` in `src/schema/types.ts`. */
function layoutPatchInterface(): Shape {
  const source = read('src/schema/types.ts');
  const start = source.indexOf('export interface LayoutPatch {');
  expect(start).toBeGreaterThan(-1);
  return shape(balanced(source, source.indexOf('{', start)));
}

/**
 * Every `new CustomEvent('…', { … })` in the library, by event name, with
 * the `bubbles`/`composed` options of each dispatch site.
 */
function dispatched(): Map<string, Flags[]> {
  const sites = new Map<string, Flags[]>();
  const call = /new CustomEvent(?:<[\s\S]*?>)?\(\s*(['"])([^'"]+)\1/g;
  for (const file of sourceFiles()) {
    const text = read(file);
    for (const match of text.matchAll(call)) {
      const args = balanced(text, match.index + match[0].indexOf('('));
      const flags = {
        bubbles: /\bbubbles:\s*true\b/.test(args),
        composed: /\bcomposed:\s*true\b/.test(args),
      };
      sites.set(match[2], [...(sites.get(match[2]) ?? []), flags]);
    }
  }
  return sites;
}

interface Row {
  event: string;
  detail: string;
  bubbles: string;
  composed: string;
}

/** The rows of the table under "## Every event". */
function documented(): Row[] {
  const start = PAGE.indexOf('\n## Every event\n');
  expect(start).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  return section
    .split('\n')
    .filter((line) => /^\| `[^`]+` \|/.test(line))
    .map((line) => {
      // `\|` inside a cell is an escaped pipe, not a column break.
      const cells = line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(6);
      return {
        event: cells[0].replace(/`/g, ''),
        detail: cells[3],
        bubbles: cells[4],
        composed: cells[5],
      };
    });
}

/** The members of the `ErrorPhase` union in `src/errors/report.ts`. */
function errorPhases(): string[] {
  const source = read('src/errors/report.ts');
  const union = source.match(/export type ErrorPhase =([^;]+);/);
  expect(union).not.toBeNull();
  return [...union![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('docs: the Events page matches the code', () => {
  it('lists exactly the events the library dispatches', () => {
    const code = [...dispatched().keys()].sort();
    expect(code.length).toBeGreaterThan(0);
    expect(documented().map((row) => row.event).sort()).toEqual(code);
  });

  it('names every protvista-error phase, and no other', () => {
    const row = documented().find((r) => r.event === 'protvista-error');
    expect(row).toBeDefined();
    const listed = row!.detail.match(/`phase` is one of ([^;]+);/);
    expect(listed).not.toBeNull();
    const phases = [...listed![1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const union = errorPhases();
    expect(union.length).toBeGreaterThan(0);
    expect([...phases].sort()).toEqual([...union].sort());
  });

  it('gives the LayoutPatch of protvista-layout-change as the interface has it', () => {
    const row = documented().find((r) => r.event === 'protvista-layout-change');
    expect(row).toBeDefined();
    // `\|` in the table cell is a `|` in the type.
    const literal = row!.detail
      .replace(/\\\|/g, '|')
      .match(/^`LayoutPatch`: `(\{[^`]+\})`/);
    expect(literal).not.toBeNull();
    const documentedShape = shape(literal![1]);
    // The page's prose rests on these three fields, so name them outright.
    expect(Object.keys(documentedShape)).toEqual(['order', 'tracks', 'hidden']);
    expect(documentedShape).toEqual(layoutPatchInterface());
  });

  it("gives each event's Bubbles and Composed as its dispatch options set them", () => {
    const code = dispatched();
    const yesNo = (on: boolean) => (on ? 'Yes' : 'No');
    for (const row of documented()) {
      const sites = code.get(row.event) ?? [];
      expect(sites.length, row.event).toBeGreaterThan(0);
      for (const site of sites) {
        expect([row.event, row.bubbles, row.composed]).toEqual([
          row.event,
          yesNo(site.bubbles),
          yesNo(site.composed),
        ]);
      }
    }
  });
});
