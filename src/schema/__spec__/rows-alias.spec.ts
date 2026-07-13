/**
 * `groups:` → `rows:` deprecated-alias tests.
 *
 * Four contracts, one per acceptance criterion on the rename:
 *
 *   1. Equivalence  — a `groups:` config and the same config spelled
 *      `rows:` normalize to the identical `NormalizedConfig`. This is
 *      the guarantee that makes the alias safe to keep for a cycle.
 *   2. Deprecation  — a legacy config warns exactly ONCE per process;
 *      a modern one never warns.
 *   3. Conflict     — setting both fields is a validation error with a
 *      single, actionable message (not the schema's raw `oneOf` dump).
 *   4. Extends      — a base authored with one spelling and a child
 *      with the other merge into one `rows:` list.
 *
 * The warning is guarded by module-level state (fire-once), so the
 * tests that assert on it re-import the module graph under
 * `vi.resetModules()` to get a fresh flag rather than depending on the
 * order the other tests in this file happen to run in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../load';
import { validateConfig } from '../validate';
import { normalizeConfig } from '../normalize';
import { mergeExtends } from '../extends';
import { createRegistry } from '../registry';
import { ConfigValidationError } from '../errors';
import {
  resolveRowsAlias,
  rowsAliasConflict,
  ROWS_ALIAS_CONFLICT_MESSAGE,
} from '../rows-alias';
import type { ProtvistaViewerConfig, TopLevelEntry } from '../types';

// ─────────────────────────────────────────────────────────────
// Fixtures — the same viewer, spelled both ways
// ─────────────────────────────────────────────────────────────

/** A config written against the deprecated field. Not a `ProtvistaViewerConfig`:
 *  the type requires `rows`. That is the point — only legacy authors and
 *  untyped JS callers can produce this shape. */
type LegacyConfig = Omit<ProtvistaViewerConfig, 'rows'> & {
  groups: TopLevelEntry[];
};

const sources = { features: 'https://example.org/features' };

const entries = (): TopLevelEntry[] => [
  {
    id: 'DOMAINS',
    tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
  },
  { id: 'signal', kind: 'features', data: 'features' },
];

const modernConfig = (): ProtvistaViewerConfig => ({
  sources,
  rows: entries(),
});

const legacyConfig = (): LegacyConfig => ({
  sources,
  groups: entries(),
});

/** Silence + capture `console.warn` for the duration of one test. */
function captureWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

// ─────────────────────────────────────────────────────────────
// 1. Equivalence
// ─────────────────────────────────────────────────────────────

describe('rows / groups equivalence', () => {
  it('loadConfig produces an identical NormalizedConfig from either spelling', async () => {
    const warn = captureWarn();

    const fromRows = await loadConfig(modernConfig());
    const fromGroups = await loadConfig(legacyConfig());

    expect(fromGroups).toEqual(fromRows);
    // Both spellings survive into the same rendered row list — the
    // group AND the standalone track, in declaration order.
    expect(fromRows.groups.map((g) => g.id)).toEqual(['DOMAINS', 'signal']);
    expect(fromRows.groups[1].standalone).toBe(true);

    warn.mockRestore();
  });

  it('normalizeConfig accepts a legacy config passed to it directly', () => {
    const warn = captureWarn();

    // An embedder can call `normalizeConfig` without going through
    // `loadConfig`, so the alias has to resolve here too.
    const fromGroups = normalizeConfig(
      legacyConfig() as unknown as ProtvistaViewerConfig
    );
    expect(fromGroups).toEqual(normalizeConfig(modernConfig()));

    warn.mockRestore();
  });

  it('validateConfig accepts either spelling', () => {
    const warn = captureWarn();

    expect(validateConfig(modernConfig(), createRegistry()).valid).toBe(true);
    expect(validateConfig(legacyConfig(), createRegistry()).valid).toBe(true);

    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────
// 2. resolveRowsAlias — the helper itself
// ─────────────────────────────────────────────────────────────

describe('resolveRowsAlias', () => {
  it('folds `groups` into `rows` and drops the old key', () => {
    const warn = captureWarn();

    // Cast as a legacy author's config arriving from untyped YAML — the
    // `LegacyConfig` shape is deliberately not a `ProtvistaViewerConfig`.
    const out = resolveRowsAlias(
      legacyConfig() as unknown as ProtvistaViewerConfig
    );
    expect(out.rows).toEqual(entries());
    expect('groups' in out).toBe(false);

    warn.mockRestore();
  });

  it('returns a `rows:` config untouched, by reference', () => {
    const input = modernConfig();
    // No clone for the common path — the alias costs modern configs
    // nothing.
    expect(resolveRowsAlias(input)).toBe(input);
  });

  it('passes non-object input through for the validator to reject', () => {
    expect(resolveRowsAlias(null)).toBeNull();
    expect(resolveRowsAlias('not a config')).toBe('not a config');
    expect(resolveRowsAlias([1, 2])).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Conflict — both fields set
// ─────────────────────────────────────────────────────────────

describe('rows + groups conflict', () => {
  const conflicting = () => ({ sources, rows: entries(), groups: entries() });

  it('validateConfig reports exactly one actionable issue', () => {
    const result = validateConfig(conflicting(), createRegistry());

    expect(result.valid).toBe(false);
    // Precisely one issue: the raw schema `oneOf` failure would also
    // fire here, and burying the real advice under it is the thing this
    // check exists to prevent.
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('rows-alias-conflict');
    expect(result.issues[0].message).toBe(ROWS_ALIAS_CONFLICT_MESSAGE);
    expect(result.issues[0].path).toBe('/groups');
  });

  it('loadConfig rejects with that same message', async () => {
    await expect(loadConfig(conflicting())).rejects.toThrow(
      ConfigValidationError
    );
    await expect(loadConfig(conflicting())).rejects.toThrow(
      /don't set both/
    );
  });

  it('resolveRowsAlias throws rather than silently picking one', () => {
    expect(() => resolveRowsAlias(conflicting())).toThrow(
      ConfigValidationError
    );
  });

  it('finds no conflict in input that cannot carry either field', () => {
    // `validateConfig` hands us whatever the caller passed, including
    // junk. The alias check has to fall through quietly and let the
    // structural pass produce the readable schema error — and, per
    // validateConfig's contract, without throwing.
    expect(rowsAliasConflict(null)).toBeUndefined();
    expect(rowsAliasConflict('nonsense')).toBeUndefined();
    expect(rowsAliasConflict([])).toBeUndefined();

    const result = validateConfig(null, createRegistry());
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('schema');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Extends across both spellings
// ─────────────────────────────────────────────────────────────

describe('extends merges across spellings', () => {
  const child = (rowsOrGroups: 'rows' | 'groups') =>
    ({
      extends: 'base',
      [rowsOrGroups]: [
        // Extends the base group by id …
        { id: 'DOMAINS', label: 'Overridden' },
        // … and appends a new standalone row.
        { id: 'variation', kind: 'variants', data: 'features' },
      ],
    }) as unknown as ProtvistaViewerConfig;

  const base = (rowsOrGroups: 'rows' | 'groups') =>
    ({
      sources,
      [rowsOrGroups]: [
        {
          id: 'DOMAINS',
          label: 'Base domains',
          tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
        },
      ],
    }) as unknown as ProtvistaViewerConfig;

  it.each([
    ['groups', 'rows'],
    ['rows', 'groups'],
    ['groups', 'groups'],
  ] as const)(
    'base authored with `%s:` + child authored with `%s:`',
    async (baseField, childField) => {
      const warn = captureWarn();

      const out = await mergeExtends(child(childField), {
        resolver: { base: base(baseField) },
      });

      // One canonical list, base order preserved, new id appended.
      expect(out.rows.map((r) => r.id)).toEqual(['DOMAINS', 'variation']);
      expect('groups' in out).toBe(false);

      // The base group was field-merged, not replaced: the child's
      // scalar override won and the base's `tracks:` survived.
      const domains = out.rows[0];
      expect(domains.label).toBe('Overridden');
      expect('tracks' in domains && domains.tracks).toHaveLength(1);

      warn.mockRestore();
    }
  );
});

// ─────────────────────────────────────────────────────────────
// 5. Deprecation warning — fires once per process
// ─────────────────────────────────────────────────────────────

describe('deprecation warning', () => {
  // The fire-once guard is module-level state. Reset the graph so each
  // test gets a fresh flag instead of inheriting whatever the tests
  // above tripped.
  beforeEach(() => {
    vi.resetModules();
  });

  it('warns exactly once no matter how many legacy configs are loaded', async () => {
    const warn = captureWarn();
    const { loadConfig: freshLoad } = await import('../load');

    await freshLoad(legacyConfig());
    await freshLoad(legacyConfig());
    await freshLoad(legacyConfig());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("'groups:' is deprecated");
    expect(warn.mock.calls[0][0]).toContain("rename it to 'rows:'");

    warn.mockRestore();
  });

  it('never warns for a `rows:` config', async () => {
    const warn = captureWarn();
    const { loadConfig: freshLoad } = await import('../load');

    await freshLoad(modernConfig());
    await freshLoad(modernConfig());

    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});
