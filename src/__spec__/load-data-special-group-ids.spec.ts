import { describe, expect, it } from 'vitest';

import { loadProtvistaData } from '../load-data.js';
import { normalizeConfig } from '../schema/normalize.js';
import { createRegistry } from '../schema/registry.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';

describe('loader group IDs that shadow object properties', () => {
  it.each(['__proto__', 'constructor'])(
    'retains a group aggregate for %s as an own data property',
    async (groupId) => {
      const registry = createRegistry();
      const config: ProtvistaViewerConfig = {
        accession: 'P05067',
        rows: [
          {
            id: groupId,
            tracks: [
              {
                id: 'features',
                kind: 'features',
                data: {
                  from: 'inline',
                  inlineData: [{ type: 'DOMAIN', start: 1, end: 9 }],
                },
              },
            ],
          },
        ],
      };
      const result = await loadProtvistaData(
        'P05067',
        normalizeConfig(config, { registry }),
        async () => null,
        (name) => registry.getAdapter(name),
        {}
      );

      expect(Object.prototype.hasOwnProperty.call(result.data, groupId)).toBe(true);
      expect(Object.getPrototypeOf(result.data)).toBe(null);
      expect(result.data[groupId]).toMatchObject([
        { type: 'DOMAIN', start: 1, end: 9 },
      ]);
    }
  );
});
