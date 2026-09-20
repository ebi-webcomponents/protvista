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
import {
  REQUIRED_COLUMNS,
  POINT_COLUMNS,
  VARIATION_COLUMNS,
} from '../adapters/dsv.js';
import {
  DATA_FILE_FORMATS,
  KIND_ADAPTER_VARIANTS,
  BYO_KIND_BASE_ADAPTERS,
  GENERIC_FILE_ADAPTERS,
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

/**
 * `specs/config-approach.md` restates the `KnownAdapterName` and
 * `KnownComponentName` unions as a TypeScript block. That copy is the only
 * one nothing pins — `types.ts` is checked by `tsc` (the entries of
 * `BUILTIN_ADAPTERS` are typed `KnownAdapterName`), `ADAPTER_REFERENCE` by
 * the coverage test above, and `docs/adapter-reference.md` by byte identity
 * in `adapter-reference-publishing.spec.ts`. Pin it here rather than let the
 * normative spec fall behind the code it specifies.
 */
describe('spec drift — specs/config-approach.md unions', () => {
  const spec = readFileSync(
    resolve(process.cwd(), 'specs/config-approach.md'),
    'utf8'
  );

  /** The quoted string literals of a `type <Name> =` block in the spec. */
  const unionMembers = (typeName: string): string[] => {
    // Terminate on the closing `';` of the last member rather than the
    // first bare `;` — the tier comments inside the block contain prose.
    const block = new RegExp(`type ${typeName} =([\\s\\S]*?';)`).exec(spec);
    expect(block, `no '${typeName}' block in specs/config-approach.md`).not.toBe(
      null
    );
    return [...(block as RegExpExecArray)[1].matchAll(/'([a-z0-9-]+)'/g)]
      .map((m) => m[1])
      .sort();
  };

  it('KnownAdapterName lists exactly the registered built-in adapters', () => {
    expect(
      unionMembers('KnownAdapterName'),
      'specs/config-approach.md drifted from BUILTIN_ADAPTERS — update the union in the spec'
    ).toEqual(BUILTIN_ADAPTERS.map(([name]) => name).sort());
  });

  it('KnownComponentName lists exactly the documented components', () => {
    const components = [
      ...new Set(kindEntries.map((d) => d.component as string)),
    ].sort();
    // The spec's component union is a superset check: every component a
    // built-in kind resolves to must be named there.
    for (const c of components) {
      expect(
        unionMembers('KnownComponentName'),
        `component '${c}' is missing from the spec's KnownComponentName`
      ).toContain(c);
    }
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

describe('adapter reference — per-kind adapter families', () => {
  it('documents every family member the resolver can select', () => {
    // A family member may be documented in any of three tiers:
    //   - `generic`     — the `features` family's members, which a bare
    //                     `./x.csv` also selects on a kindless track;
    //   - `byod-format` — reachable only through a kind;
    //   - `byod-kind`   — a BYO kind's own canonical adapter, which doubles
    //                     as the JSON member of families sharing its shape
    //                     (`linegraph` is `kind: linegraph`'s adapter *and*
    //                     what `./counts.json` means on `kind: variant-counts`).
    // Either way the reference must know the name, and where it pins an
    // extension that extension must be the one that reaches it.
    for (const [base, byExt] of Object.entries(KIND_ADAPTER_VARIANTS)) {
      for (const [ext, name] of Object.entries(byExt)) {
        const doc = ADAPTER_REFERENCE.find((d) => d.name === name);
        expect(
          doc,
          `family member '${name}' (${base} + ${ext}) is undocumented`
        ).toBeDefined();
        if (doc && doc.tier === 'byod-kind') continue;
        expect(
          doc && 'ext' in doc ? doc.ext : undefined,
          `'${name}' is documented under a different extension`
        ).toBe(ext);
      }
    }
  });

  it('byod-kind entries are exactly the bring-your-own-data kind bases', () => {
    // Pins the two lists that decide BYO-ness — the reference tier and
    // `BYO_KIND_BASE_ADAPTERS`, which gates the `hasData` empty-state check
    // and the `from: inline` adapter run — against each other.
    const documented = ADAPTER_REFERENCE.filter((d) => d.tier === 'byod-kind')
      .map((d) => d.name)
      .sort();
    expect(documented).toEqual([...BYO_KIND_BASE_ADAPTERS].sort());
  });

  it('documents exactly the family members no bare extension selects', () => {
    // `byod-format` covers every family member documented nowhere else —
    // not a `generic` adapter (which a bare extension also selects) and not
    // a `byod-kind` one (which a kind resolves to directly).
    const documentedElsewhere = new Set(
      ADAPTER_REFERENCE.filter(
        (d) => d.tier === 'generic' || d.tier === 'byod-kind'
      ).map((d) => d.name)
    );
    const documented = byodFormat.map((d) => `${d.ext}:${d.name}`).sort();
    const wired = [
      ...new Set(
        Object.values(KIND_ADAPTER_VARIANTS).flatMap((byExt) =>
          Object.entries(byExt)
            .filter(
              ([, name]) =>
                !GENERIC_FILE_ADAPTERS.has(name) &&
                !documentedElsewhere.has(name)
            )
            .map(([ext, name]) => `${ext}:${name}`)
        )
      ),
    ].sort();
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

  it('documented header columns match the parser’s own', () => {
    // Each family's delimited members declare that family's columns; the
    // JSON member has records, not a header, and declares none.
    const expected: Record<string, readonly string[]> = {
      linegraph: [...POINT_COLUMNS],
      variation: [...VARIATION_COLUMNS],
    };
    expect(byodFormat.length).toBeGreaterThan(0);
    for (const d of byodFormat) {
      if (d.body === 'json') {
        expect(d.headerColumns, `${d.name} is JSON, not a header format`).toBeUndefined();
        continue;
      }
      expect(expected[d.family], `no columns known for family '${d.family}'`).toBeDefined();
      expect(d.headerColumns).toEqual(expected[d.family]);
    }
  });

  it('every documented family is one the resolver actually wires', () => {
    const wiredNames = new Set(
      Object.values(KIND_ADAPTER_VARIANTS).flatMap((byExt) =>
        Object.values(byExt)
      )
    );
    for (const d of byodFormat) {
      expect(
        wiredNames.has(d.name as never),
        `'${d.name}' is documented but no kind's family selects it`
      ).toBe(true);
    }
  });

  it('every kind either declares a family or is named for its provider', () => {
    // The vocabulary rule, enforced: a kind may keep a plain domain word
    // (`features`, `variants`) only if an author can bring their own data to
    // it. A kind with no family must say whose feed it is, so nobody reads
    // `alphafold-confidence` as "any confidence score".
    const registry = createRegistry();
    const PROVIDERS = ['alphafold-', 'alphamissense-', 'interpro-', 'uniprot-'];
    for (const kind of registry.listSemanticKinds()) {
      const base = registry.getSemanticKind(kind)?.adapter;
      const hasFamily =
        base !== undefined && KIND_ADAPTER_VARIANTS[base] !== undefined;
      if (hasFamily) continue;
      expect(
        PROVIDERS.some((p) => kind.startsWith(p)),
        `kind '${kind}' has no bring-your-own-data family, so its name must ` +
          `carry its provider (one of ${PROVIDERS.join(', ')})`
      ).toBe(true);
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
