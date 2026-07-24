/**
 * Drift test for the paired example embedded in
 * `docs/configuration-vs-data.md`. That page hand-copies the config and
 * payload from the `examples/csv` example into fenced `yaml`/`csv` blocks.
 * The adapter-reference fixture-drift test only reads the *real* CSV; nothing
 * pins the doc's embedded copy to the file, so `examples/csv/*` could change
 * and the doc would silently drift. This closes that gap.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the repo root, so resolve paths from cwd.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

// Pull the first fenced code block of a given language out of a Markdown doc.
const fenced = (md: string, lang: string) => {
  const m = md.match(new RegExp('```' + lang + '\\n([\\s\\S]*?)```'));
  if (!m) throw new Error(`no ${lang} block found`);
  return m[1];
};

describe('docs/configuration-vs-data.md embedded example stays in sync', () => {
  const doc = read('docs/configuration-vs-data.md');

  it("the csv block matches examples/csv/hotspots.csv verbatim", () => {
    const file = read('examples/csv/hotspots.csv');
    expect(fenced(doc, 'csv').trim()).toBe(file.trim());
  });

  it("the yaml block matches examples/csv/config.yaml", () => {
    // The doc intentionally omits the file's leading `#` comment header, so the
    // embedded block is a contiguous slice of the file, not the whole file —
    // assert containment rather than equality.
    const file = read('examples/csv/config.yaml');
    expect(file).toContain(fenced(doc, 'yaml').trim());
  });
});
