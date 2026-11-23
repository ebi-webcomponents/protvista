/**
 * Drift test: every URL override `<protvista-uniprot-structure>` declares is
 * documented on the docs site (the `protvista-uniprot/structure` row of
 * embed.md) and named in the CHANGELOG, and the
 * by-checksum default URL appears in the docs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the repo root, so resolve paths from cwd.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const urlAttributes = [
  ...read('src/protvista-uniprot-structure.ts').matchAll(
    /attribute: '([a-z-]+-url)'/g
  ),
].map((m) => m[1]);

const embedRow =
  read('docs/src/content/docs/embed.md')
    .split('\n')
    .find((line) => line.startsWith('| `protvista-uniprot/structure`')) ?? '';

// The whole file, not only `## Unreleased`: a release renames that heading to
// the version, and the entry must keep passing after it.
const changelog = read('CHANGELOG.md');

describe('structure URL overrides are documented', () => {
  it('finds the URL attributes in source', () => {
    expect(urlAttributes).toEqual([
      'uniprot-url',
      'alphafold-url',
      'beacons-url',
      'beacons-checksum-url',
    ]);
  });

  it.each(urlAttributes)('embed.md documents %s', (attr) => {
    expect(embedRow).toContain(`\`${attr}\``);
  });

  it.each(urlAttributes)('the CHANGELOG names %s', (attr) => {
    expect(changelog).toContain(`\`${attr}\``);
  });

  it('shows the by-checksum default URL', () => {
    const docs = ['embed', 'configure']
      .map((name) => read(`docs/src/content/docs/${name}.md`))
      .join('\n');
    expect(docs).toContain(
      'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/v2/sequence/summary?id={checksum}&type=md5'
    );
  });
});
