/**
 * The generic-format bring-your-own-data adapters must be wired into the
 * `<protvista-uniprot>` element's exported `adapters` map — the map the
 * loader actually invokes to transform a track's fetched body.
 *
 * The schema Registry side (which gates config validation) is covered by
 * `registry.spec.ts`, and the end-to-end file-source path by
 * `load-data-file-source.spec.ts` — but both of those inject their own
 * local adapter maps. Nothing else pins the *exported* runtime map, so
 * dropping a line from it would validate and even pass the file-source
 * specs while breaking real `<protvista-uniprot>` instances. This guards
 * that.
 */

import { describe, it, expect } from 'vitest';
import { adapters } from '../protvista-uniprot';
import { featuresCsv } from '../schema/adapters/features-csv';
import { featuresTsv } from '../schema/adapters/features-tsv';
import { featuresJson } from '../schema/adapters/features-json';
import { bed } from '../schema/adapters/bed';

describe('<protvista-uniprot> exported adapters map — generic formats', () => {
  it.each([
    ['features-csv', featuresCsv],
    ['features-tsv', featuresTsv],
    ['features-json', featuresJson],
    ['bed', bed],
  ])('wires %s to its adapter function', (name, fn) => {
    expect(adapters[name as keyof typeof adapters]).toBe(fn);
  });
});
