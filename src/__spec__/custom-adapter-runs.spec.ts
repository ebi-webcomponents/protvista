/**
 * The `registerAdapter()` escape hatch, end to end.
 *
 * Before adapter unification the registry gated config *validation* while
 * the loader invoked a separate static map — so a consumer-registered
 * adapter validated but was never actually run (`adapters[name]` was
 * `undefined` → the loader threw and the track silently degraded). Now the
 * loader resolves through the same registry, so a registered adapter both
 * validates and runs. This pins that contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../schema/load.js';
import { createRegistry } from '../schema/registry.js';
import { loadProtvistaData } from '../load-data.js';

const makeConfig = (adapter: string) => ({
  rows: [
    {
      id: 'G',
      tracks: [
        {
          id: 't',
          component: 'nightingale-track-canvas',
          data: { from: 'url', url: 'https://example.org/data', adapter },
        },
      ],
    },
  ],
});

describe('consumer-registered adapter (registerAdapter escape hatch)', () => {
  it('validates AND runs: a config using a registered custom adapter renders its output', async () => {
    const registry = createRegistry();
    const customAdapter = vi.fn(() => [{ type: 'CUSTOM', start: 1, end: 5 }]);
    registry.registerAdapter('my-custom', customAdapter);

    // Validation consults `registry`; `adapter: my-custom` only passes
    // because it is registered.
    const config = await loadConfig(makeConfig('my-custom'), {
      registry,
      accession: 'P05067',
    });

    // The loader resolves the adapter function through the same registry.
    const result = await loadProtvistaData(
      'P05067',
      config,
      async () => ({ payload: true }),
      (name) => registry.getAdapter(name)
    );

    expect(customAdapter).toHaveBeenCalledTimes(1);
    const track = result.data['G-t'] as Array<{ type: string; start: number }>;
    expect(track).toHaveLength(1);
    expect(track[0]).toMatchObject({ type: 'CUSTOM', start: 1, end: 5 });
  });

  it('validation rejects an adapter name that was never registered', async () => {
    await expect(
      loadConfig(makeConfig('not-registered'), { accession: 'P05067' })
    ).rejects.toThrow(/not-registered/);
  });
});
