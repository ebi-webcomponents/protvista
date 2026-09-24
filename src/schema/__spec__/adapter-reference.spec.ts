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
 *     `REQUIRED_COLUMNS`, and ext/body match `DATA_FORMATS`;
 *   - fixture drift: the shipped `examples/csv` payload matches the doc,
 *     and the real adapter emits only documented fields.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ADAPTER_REFERENCE,
  FEATURE_RECORD_FIELDS,
  type KindAdapterDoc,
} from '../adapters/adapter-reference.js';
import { BUILTIN_ADAPTERS } from '../adapters/index.js';
import {
  POINT_COLUMNS,
  VARIATION_COLUMNS,
} from '../adapters/dsv.js';
import {
  DATA_FORMATS,
  DATA_FORMAT_NAMES,
  formatForPath,
} from '../file-formats.js';
import { SHAPES, SHAPE_NAMES } from '../shapes.js';
import { createRegistry } from '../registry.js';
import { validateConfig } from '../validate.js';
import { runPipeline } from '../adapters/pipeline.js';

/** The reading a `kind: features` track gives `examples/csv/hotspots.csv`. */
const featuresCsv = (body: string) =>
  runPipeline('feature', 'csv', body, { source: './hotspots.csv' });

const kindEntries = ADAPTER_REFERENCE.filter(
  (d): d is KindAdapterDoc => d.tier === 'domain'
);

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

  it('covers every kind that has a provider adapter, exactly once', () => {
    // A shape-only kind (`linegraph`) has no provider transform to document
    // — its contract is the shape, rendered in the shapes section.
    const documentedKinds = kindEntries.map((d) => d.kind).sort();
    const withAdapters = registry
      .listSemanticKinds()
      .filter((k) => registry.getSemanticKind(k)?.adapter !== undefined);
    expect(documentedKinds).toEqual(withAdapters);
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

describe('the reference documents the vocabulary authors actually write', () => {
  const registry = createRegistry();

  it('every shape is documented with the fields its parser requires', () => {
    // The reference renders from SHAPES, so this pins the shapes themselves
    // against the parsers that enforce them.
    expect(SHAPE_NAMES.sort()).toEqual(['feature', 'point', 'variation']);
    expect(SHAPES.feature.requiredFields).toEqual(['type', 'start', 'end']);
    expect(SHAPES.point.requiredFields).toEqual([...POINT_COLUMNS]);
    expect(SHAPES.variation.requiredFields).toEqual([...VARIATION_COLUMNS]);
  });

  it('every shape is drawn by at least one kind', () => {
    // A documented shape no kind draws would be a section of the reference
    // nobody can reach.
    for (const shape of SHAPE_NAMES) {
      const kinds = registry
        .listSemanticKinds()
        .filter((k) => registry.getSemanticKind(k)?.shape === shape);
      expect(kinds.length, `no kind draws ${shape}`).toBeGreaterThan(0);
    }
  });

  it('every format maps to an extension the resolver recognises', () => {
    for (const name of DATA_FORMAT_NAMES) {
      const fmt = DATA_FORMATS[name];
      const resolved = formatForPath(`./x${fmt.ext}`);
      expect(resolved, `${name} has no extension the resolver reads`).toBeDefined();
      expect(resolved?.body).toBe(fmt.body);
    }
  });

  it('every kind either declares a shape or is named for its provider', () => {
    // The vocabulary rule, enforced: a kind may keep a plain domain word
    // (`features`, `variants`) only if an author can bring their own data to
    // it. A kind with no shape must say whose feed it is.
    //
    // Only this direction is asserted. The converse — a shaped kind must have
    // a plain name — is not the rule: `interpro-features` draws ordinary
    // feature records *and* carries a provider prefix, because its default
    // feed is InterPro's and the plain word `features` already means
    // UniProt's. A prefix names the default feed; a shape is the promise
    // about your data, and they are independent.
    const PROVIDERS = ['alphafold-', 'alphamissense-', 'interpro-', 'uniprot-'];
    for (const kind of registry.listSemanticKinds()) {
      if (registry.getSemanticKind(kind)?.shape !== undefined) continue;
      expect(
        PROVIDERS.some((prefix) => kind.startsWith(prefix)),
        `kind '${kind}' accepts no author data, so its name must carry its provider`
      ).toBe(true);
    }
  });

  it('every kind that declares a shape actually reads an author file', () => {
    // The half the naming rule promises and nothing checked: a shape is what
    // tells an author their file will work, so a kind that declares one must
    // resolve a plain `./x.csv` end to end. CSV is a container format and can
    // carry all three shapes, so it is the one source every shaped kind must
    // accept. A kind given a shape whose resolution path does not reach it
    // would otherwise read as bring-your-own-data and fail at load time.
    const shaped = registry
      .listSemanticKinds()
      .filter((k) => registry.getSemanticKind(k)?.shape !== undefined);
    expect(shaped.length).toBeGreaterThan(5);

    for (const kind of shaped) {
      const result = validateConfig(
        {
          accession: 'P05067',
          rows: [{ id: 'G', tracks: [{ id: 't', kind, data: './mine.csv' }] }],
        },
        createRegistry()
      );
      expect(
        result.issues.map((i) => i.code),
        `kind '${kind}' declares a shape but rejects './mine.csv'`
      ).toEqual([]);
    }
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
