/**
 * CHARACTERIZATION TEST — documents the registry-vs-runtime adapter gap.
 *
 * A consumer adapter registered via `registerAdapter` lands in the schema
 * `Registry`, which is what *validation* consults (`registry.hasAdapter`).
 * But the map the component actually hands to `loadProtvistaData` is the
 * static `adapters` const in `protvista-uniprot.ts`, and `load-data.ts`
 * resolves adapter functions ONLY through that map (it never reads the
 * registry). So a consumer-registered adapter validates but can never run.
 *
 * These assertions pin the *current* (gappy) behaviour. When the domain
 * and generic adapters are unified behind the registry and `load-data.ts`
 * resolves via `registry.getAdapter(...)`, invert them: the adapter should
 * then be reachable and get called.
 */
import { describe, it, expect, vi } from 'vitest';
import { adapters } from '../protvista-uniprot';
import { loadProtvistaData } from '../load-data';
import { loadConfig } from '../schema/load';
import { createRegistry } from '../schema/registry';
import type { AdapterFunction } from '../schema/types';

describe('registerAdapter: registry validates it, but the loader cannot run it', () => {
  it('a registered adapter passes validation yet is absent from the runtime map', async () => {
    const spy = vi.fn(() => [{ type: 'X', start: 1, end: 2, description: 'x' }]);

    // A registry as it looks after `element.registerAdapter('consumer-features', fn)`.
    const registry = createRegistry();
    registry.registerAdapter(
      'consumer-features',
      spy as unknown as AdapterFunction
    );

    // (1) Validation side: the config using the custom adapter loads cleanly
    // (the registry knows the name), so an author gets no error.
    const config = await loadConfig(
      {
        accession: 'P05067',
        rows: [
          {
            id: 'G',
            tracks: [
              {
                id: 't',
                kind: 'features',
                data: {
                  from: 'url',
                  url: 'https://example.org/x',
                  adapter: 'consumer-features',
                },
              },
            ],
          },
        ],
      },
      { accession: 'P05067', registry }
    );
    expect(config).toBeDefined();

    // (2) Runtime side: the map the component passes to the loader does NOT
    // contain the registered adapter.
    expect('consumer-features' in adapters).toBe(false);

    // (3) End-to-end: run the loader with that same map. The registered
    // adapter is never invoked — the lookup misses and the track degrades.
    await loadProtvistaData(
      'P05067',
      config,
      async () => ({ features: [] }),
      adapters
    ).catch(() => undefined);
    expect(spy).not.toHaveBeenCalled();
  });
});
