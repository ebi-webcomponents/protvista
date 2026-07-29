/**
 * Drift tests for the per-adapter reference (`docs/adapter-reference.md`,
 * generated from `src/schema/adapters/adapter-reference.ts`). These keep
 * the documented shapes tied to the code so the reference can't silently
 * go stale:
 *
 *   - coverage: exactly the registered built-in adapters, no gaps/orphans;
 *   - domain linkage: every entry's kind resolves (via the registry) to
 *     that entry's own adapter + component;
 *   - generic accuracy: documented header columns match the parser's
 *     `REQUIRED_COLUMNS`, and ext/body match `DATA_FILE_FORMATS`;
 *   - fixture drift: the shipped `examples/csv` payload matches the doc,
 *     and the real adapter emits only documented fields.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ADAPTER_REFERENCE,
  FEATURE_RECORD_FIELDS,
  type GenericAdapterDoc,
  type DomainAdapterDoc,
} from '../adapters/adapter-reference.js';
import { BUILTIN_ADAPTERS } from '../adapters/index.js';
import { REQUIRED_COLUMNS } from '../adapters/dsv.js';
import { DATA_FILE_FORMATS } from '../file-formats.js';
import { featuresCsv } from '../adapters/features-csv.js';
import { createRegistry } from '../registry.js';

const generic = ADAPTER_REFERENCE.filter(
  (d): d is GenericAdapterDoc => d.tier === 'generic'
);
const domain = ADAPTER_REFERENCE.filter(
  (d): d is DomainAdapterDoc => d.tier === 'domain'
);

describe('adapter reference — coverage', () => {
  it('documents exactly the registered built-in adapters (no gaps, no orphans)', () => {
    const documented = ADAPTER_REFERENCE.map((d) => d.name).sort();
    const registered = BUILTIN_ADAPTERS.map(([name]) => name).sort();
    expect(documented).toEqual(registered);
  });

  it('has no duplicate entries', () => {
    const names = ADAPTER_REFERENCE.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('adapter reference — domain kind linkage', () => {
  const registry = createRegistry();

  it('covers every built-in semantic kind exactly once', () => {
    const documentedKinds = domain.map((d) => d.kind).sort();
    expect(documentedKinds).toEqual(registry.listSemanticKinds());
  });

  it('each domain entry matches the registry adapter + component for its kind', () => {
    for (const d of domain) {
      const def = registry.getSemanticKind(d.kind);
      expect(def, `kind '${d.kind}' is not a built-in`).toBeDefined();
      expect(def && def.adapter).toBe(d.name);
      expect(def && def.component).toBe(d.component);
    }
  });
});

describe('adapter reference — generic field accuracy', () => {
  it('CSV/TSV header columns match the parser REQUIRED_COLUMNS', () => {
    const delimited = generic.filter((d) => d.headerColumns);
    expect(delimited.length).toBeGreaterThan(0);
    for (const d of delimited) {
      expect(d.headerColumns).toEqual([...REQUIRED_COLUMNS]);
    }
  });

  it('each generic ext/body matches DATA_FILE_FORMATS', () => {
    for (const d of generic) {
      const fmt = DATA_FILE_FORMATS[d.ext];
      expect(fmt, `no DATA_FILE_FORMATS entry for '${d.ext}'`).toBeDefined();
      expect(fmt.adapter).toBe(d.name);
      expect(fmt.body).toBe(d.body);
    }
  });

  it('features-json documents the begin→start alias', () => {
    const json = generic.find((d) => d.name === 'features-json');
    const startField = json && json.fields.find((f) => f.name === 'start');
    expect((startField && startField.notes) || '').toMatch(/begin/);
  });

  it('the FeatureRecord requires exactly type/start/end', () => {
    const required = FEATURE_RECORD_FIELDS.filter((f) => f.required)
      .map((f) => f.name)
      .sort();
    expect(required).toEqual(['end', 'start', 'type']);
  });
});

describe('adapter reference — fixture drift (examples/csv)', () => {
  const csv = readFileSync(
    resolve(process.cwd(), 'examples/csv/hotspots.csv'),
    'utf8'
  );

  it('the fixture header columns are all documented feature fields', () => {
    const header = csv
      .split(/\r?\n/)[0]
      .split(',')
      .map((s) => s.trim())
      .sort();
    const documented = FEATURE_RECORD_FIELDS.map((f) => f.name).sort();
    // Every column present in the fixture is a documented field (order-agnostic).
    for (const col of header) {
      expect(documented, `undocumented column '${col}'`).toContain(col);
    }
  });

  it('the real features-csv adapter emits only documented fields', () => {
    const records = featuresCsv(csv) as Array<Record<string, unknown>>;
    const allowed = new Set(FEATURE_RECORD_FIELDS.map((f) => f.name));
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      for (const key of Object.keys(record)) {
        expect(allowed.has(key), `unexpected emitted field '${key}'`).toBe(true);
      }
    }
  });
});
