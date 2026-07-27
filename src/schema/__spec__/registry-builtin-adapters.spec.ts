/**
 * Built-in adapter extension-point tests.
 *
 * `BUILTIN_ADAPTERS` is empty until the generic-format adapter tickets
 * (`features-json`, `features-csv`, `features-tsv`, `bed`) land, so
 * these tests mock the table to inject fakes. That pins the seeding and
 * precedence contract now rather than leaving it unproven until the
 * first real adapter arrives — and it means a ticket that adds a line
 * to the table inherits the coverage for free.
 *
 * The mock lives in its own spec file because `vi.mock` is file-wide:
 * `registry.spec.ts` asserts against the *real* table and must not see
 * these fakes.
 *
 * The two names below are stand-ins. Any `KnownAdapterName` works —
 * the mechanism under test is name-agnostic.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRegistry,
  registerBuiltinAdapters,
  RegistryCollisionError,
  type Registry,
} from '../registry.js';
import { BUILTIN_ADAPTERS } from '../adapters/index.js';
import type { AdapterFunction, KnownAdapterName } from '../types.js';

vi.mock('../adapters', () => {
  const table: ReadonlyArray<readonly [KnownAdapterName, AdapterFunction]> = [
    ['uniprot-features-json', () => 'builtin-features'],
    ['interpro-entries-json', () => 'builtin-interpro'],
  ];
  return { BUILTIN_ADAPTERS: table };
});

/** The injected built-in functions, by name. */
const builtinFn = (name: string): AdapterFunction => {
  const entry = BUILTIN_ADAPTERS.find(([n]) => n === name);
  if (!entry) throw new Error(`test setup: no built-in named '${name}'`);
  return entry[1];
};

describe('registerBuiltinAdapters — seeding', () => {
  it('has the mocked table in place', () => {
    // Guard. Without the mock the real table is empty, and the
    // override tests below would pass vacuously — a consumer
    // registering a never-seeded name never collides.
    expect(BUILTIN_ADAPTERS).toHaveLength(2);
  });

  it('registers every built-in on a fresh registry with no consumer call', () => {
    const r = createRegistry();

    for (const [name, fn] of BUILTIN_ADAPTERS) {
      expect(r.hasAdapter(name)).toBe(true);
      expect(r.getAdapter(name)).toBe(fn);
    }
    expect(r.listAdapters()).toEqual(
      [...BUILTIN_ADAPTERS.map(([n]) => n)].sort()
    );
  });

  it('routes each built-in through the public registerAdapter path', () => {
    // The issue requires built-ins and consumer adapters to share one
    // namespace, which holds only if seeding uses the same entry point.
    const calls: Array<[string, AdapterFunction]> = [];
    const fake = {
      registerAdapter: (name: string, fn: AdapterFunction) => {
        calls.push([name, fn]);
      },
    } as unknown as Registry;

    registerBuiltinAdapters(fake);

    expect(calls).toEqual(BUILTIN_ADAPTERS.map(([n, fn]) => [n, fn]));
  });
});

describe('registerBuiltinAdapters — precedence', () => {
  it('lets a consumer adapter override a built-in of the same name', () => {
    const r = createRegistry();
    const mine: AdapterFunction = () => 'mine';

    expect(() => r.registerAdapter('uniprot-features-json', mine)).not.toThrow();
    expect(r.getAdapter('uniprot-features-json')).toBe(mine);
  });

  it('does not duplicate the name in listAdapters after an override', () => {
    const r = createRegistry();
    r.registerAdapter('uniprot-features-json', () => 'mine');

    expect(
      r.listAdapters().filter((n) => n === 'uniprot-features-json')
    ).toHaveLength(1);
  });

  it('leaves other built-ins intact when one is overridden', () => {
    const r = createRegistry();
    r.registerAdapter('uniprot-features-json', () => 'mine');

    expect(r.getAdapter('interpro-entries-json')).toBe(
      builtinFn('interpro-entries-json')
    );
  });

  it('throws when a consumer registers over its own override', () => {
    // The built-in may be overridden once. After that the name belongs
    // to the consumer, so a second registration is an ordinary
    // consumer-vs-consumer collision.
    const r = createRegistry();
    r.registerAdapter('uniprot-features-json', () => 'first');

    expect(() => r.registerAdapter('uniprot-features-json', () => 'second')).toThrow(
      RegistryCollisionError
    );
  });

  it('keeps overrides from leaking between registries', () => {
    const r1 = createRegistry();
    const r2 = createRegistry();
    const mine: AdapterFunction = () => 'mine';

    r1.registerAdapter('uniprot-features-json', mine);

    expect(r1.getAdapter('uniprot-features-json')).toBe(mine);
    expect(r2.getAdapter('uniprot-features-json')).toBe(
      builtinFn('uniprot-features-json')
    );
    // r2 has not spent its override.
    expect(() =>
      r2.registerAdapter('uniprot-features-json', () => 'theirs')
    ).not.toThrow();
  });
});
