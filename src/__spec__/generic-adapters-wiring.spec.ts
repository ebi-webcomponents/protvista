/**
 * The generic-format bring-your-own-data adapters must be registered as
 * built-ins so the loader — which resolves adapter functions from the
 * schema Registry (`registry.getAdapter`) — can invoke them.
 *
 * The end-to-end file-source path (`load-data-file-source.spec.ts`)
 * injects its own local adapters, so it would still pass even if a line
 * were dropped from `BUILTIN_ADAPTERS`. This pins the built-in wiring
 * directly: a dropped line breaks real `<protvista-uniprot>` instances.
 */

import { describe, it, expect } from 'vitest';
import { createRegistry } from '../schema/registry';
import { featuresCsv } from '../schema/adapters/features-csv';
import { featuresTsv } from '../schema/adapters/features-tsv';
import { featuresJson } from '../schema/adapters/features-json';
import { bed } from '../schema/adapters/bed';

describe('built-in registry — generic-format adapters', () => {
  const registry = createRegistry();
  it.each([
    ['features-csv', featuresCsv],
    ['features-tsv', featuresTsv],
    ['features-json', featuresJson],
    ['bed', bed],
  ])('resolves %s to its adapter function', (name, fn) => {
    expect(registry.getAdapter(name as string)).toBe(fn);
  });
});
