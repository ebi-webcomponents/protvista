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
  type KindAdapterDoc,
  type ByodFormatAdapterDoc,
} from '../adapters/adapter-reference.js';
import { BUILTIN_ADAPTERS } from '../adapters/index.js';
import { REQUIRED_COLUMNS, POINT_COLUMNS } from '../adapters/dsv.js';
import {
  DATA_FILE_FORMATS,
  BYO_ADAPTER_VARIANTS,
  TEXT_BODY_ADAPTERS,
} from '../file-formats.js';
import { featuresCsv } from '../adapters/features-csv.js';
import { createRegistry } from '../registry.js';

const generic = ADAPTER_REFERENCE.filter(
  (d): d is GenericAdapterDoc => d.tier === 'generic'
);
// Both kind-addressed tiers. `byod-kind` entries carry the same kind /
// adapter / component columns as `domain` ones — they differ only in who
// authors the payload — so the registry invariants below must cover both,
// or moving an entry between tiers would silently drop its linkage check.
const kindEntries = ADAPTER_REFERENCE.filter(
  (d): d is KindAdapterDoc => d.tier === 'domain' || d.tier === 'byod-kind'
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

describe('adapter reference — kind linkage', () => {
  const registry = createRegistry();

  it('covers every built-in semantic kind exactly once', () => {
    const documentedKinds = kindEntries.map((d) => d.kind).sort();
    expect(documentedKinds).toEqual(registry.listSemanticKinds());
  });

  it('each kind entry matches the registry adapter + component for its kind', () => {
    for (const d of kindEntries) {
      const def = registry.getSemanticKind(d.kind);
      expect(def, `kind '${d.kind}' is not a built-in`).toBeDefined();
      expect(def && def.adapter).toBe(d.name);
      expect(def && def.component).toBe(d.component);
    }
  });
});

const byodFormat = ADAPTER_REFERENCE.filter(
  (d): d is ByodFormatAdapterDoc => d.tier === 'byod-format'
);

describe('adapter reference — delimited kind variants', () => {
  it('documents exactly the variants the resolver can select', () => {
    const documented = byodFormat.map((d) => `${d.of}${d.ext}:${d.name}`).sort();
    const wired = Object.entries(BYO_ADAPTER_VARIANTS)
      .flatMap(([base, byExt]) =>
        Object.entries(byExt).map(([ext, name]) => `${base}${ext}:${name}`)
      )
      .sort();
    expect(documented).toEqual(wired);
  });

  it('each variant ext/body matches DATA_FILE_FORMATS and the fetch decision', () => {
    for (const d of byodFormat) {
      const fmt = DATA_FILE_FORMATS[d.ext];
      expect(fmt, `no DATA_FILE_FORMATS entry for '${d.ext}'`).toBeDefined();
      // The variant takes its body type from the extension it parses, and the
      // loader must agree — a text body fetched as JSON never reaches the
      // parser at all.
      expect(d.body).toBe(fmt.body);
      expect(TEXT_BODY_ADAPTERS.has(d.name)).toBe(d.body === 'text');
    }
  });

  it('documented header columns match the parser POINT_COLUMNS', () => {
    expect(byodFormat.length).toBeGreaterThan(0);
    for (const d of byodFormat) {
      expect(d.headerColumns).toEqual([...POINT_COLUMNS]);
    }
  });

  it('every variant names a documented byod-kind base adapter', () => {
    const byodKindNames = ADAPTER_REFERENCE.filter(
      (d) => d.tier === 'byod-kind'
    ).map((d) => d.name);
    for (const d of byodFormat) {
      expect(byodKindNames).toContain(d.of);
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
