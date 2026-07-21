/**
 * The `BUILTIN_ADAPTERS` dedup guard.
 *
 * Lives in its own spec file because it needs a deliberately-corrupt
 * table and `vi.mock` is file-wide — the other registry specs mock a
 * valid table or use the real one.
 *
 * What this pins: a duplicated row must fail with an error naming the
 * table and the offending name, not with the generic
 * `RegistryCollisionError` that `registerInto` would otherwise raise
 * from deep inside `createRegistry()`.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRegistry, registerBuiltinAdapters } from '../registry';
import type { AdapterFunction, KnownAdapterName } from '../types';

vi.mock('../adapters', () => {
  const table: ReadonlyArray<readonly [KnownAdapterName, AdapterFunction]> = [
    ['uniprot-features-json', () => 'first'],
    ['interpro-entries-json', () => 'unrelated'],
    ['uniprot-features-json', () => 'copy-paste duplicate'],
  ];
  return { BUILTIN_ADAPTERS: table };
});

describe('BUILTIN_ADAPTERS dedup guard', () => {
  it('rejects a duplicated entry with a message naming the table', () => {
    expect(() => registerBuiltinAdapters(createRegistrySafely())).toThrow(
      /BUILTIN_ADAPTERS.*registers 'uniprot-features-json' more than once/s
    );
  });

  it('fails createRegistry() with the table error, not a raw collision', () => {
    // The distinction is the whole point of the guard: the generic
    // RegistryCollisionError would say "a[n] adapter with this name is
    // already registered", which reads as a consumer mistake.
    expect(() => createRegistry()).toThrow(/BUILTIN_ADAPTERS/);
    expect(() => createRegistry()).not.toThrow(/already registered/);
  });

});

/**
 * A registry that never throws on register, so the first test observes
 * the guard rather than a downstream collision.
 */
function createRegistrySafely() {
  return { registerAdapter: () => {} } as unknown as Parameters<
    typeof registerBuiltinAdapters
  >[0];
}
