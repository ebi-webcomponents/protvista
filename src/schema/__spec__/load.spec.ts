/**
 * Loader contract tests.
 *
 * Covers:
 *   - all three input forms (object, JSON string, YAML string);
 *   - content-based format detection;
 *   - explicit `format` override;
 *   - successful round-trip to `NormalizedConfig`;
 *   - `ConfigValidationError` on semantic failure (with issues);
 *   - `SyntaxError` propagation from the underlying parser;
 *   - rejection of `!!js/function` (constraint C4);
 *   - rejection of a document with no content.
 *
 * YAML tests rely on `js-yaml` being installed. They are `it.runIf`-
 * gated on its presence so the file still collects on a fresh
 * install where the package tree is incomplete; normal CI always
 * has it resolved.
 */

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../load.js';
import { ConfigValidationError } from '../errors.js';
import { createRegistry } from '../registry.js';

const minimalValidObject = () => ({
  rows: [
    {
      id: 'DOMAINS',
      tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
    },
  ],
  sources: { features: 'https://example.org/features' },
});

const minimalValidJson = () => JSON.stringify(minimalValidObject());

const minimalValidYaml = () => `
rows:
  - id: DOMAINS
    tracks:
      - id: domain
        kind: features
        data: features
sources:
  features: https://example.org/features
`.trim();

// ─────────────────────────────────────────────────────────────
// Object input
// ─────────────────────────────────────────────────────────────

describe('loadConfig — object input', () => {
  it('accepts an object and returns a NormalizedConfig', async () => {
    const normalized = await loadConfig(minimalValidObject());
    expect(normalized.version).toBe('1.0');
    expect(normalized.rows).toHaveLength(1);
    expect(normalized.rows[0].id).toBe('DOMAINS');
    expect(normalized.rows[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });

  it('uses a caller-provided registry', async () => {
    const registry = createRegistry();
    const normalized = await loadConfig(minimalValidObject(), { registry });
    expect(normalized.rows[0].tracks[0].kind).toBe('features');
  });

  it('throws ConfigValidationError on invalid input', async () => {
    const bad = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'not-a-kind', data: 'missingKey' }],
        },
      ],
    };
    await expect(loadConfig(bad)).rejects.toThrow(ConfigValidationError);
  });

  it('ConfigValidationError carries an `issues[]` array', async () => {
    const bad = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'not-a-kind', data: 'missingKey' }],
        },
      ],
    };
    try {
      await loadConfig(bad);
      throw new Error('expected loadConfig to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const cve = err as ConfigValidationError;
      expect(cve.issues.length).toBeGreaterThan(0);
      expect(cve.issues.some((i) => i.code === 'unknown-semantic-kind')).toBe(
        true
      );
      expect(cve.issues.some((i) => i.code === 'unknown-source-key')).toBe(
        true
      );
    }
  });

  it('error message lists every issue', async () => {
    const bad = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'not-a-kind', data: 'missingKey' }],
        },
      ],
    };
    try {
      await loadConfig(bad);
    } catch (err) {
      const cve = err as ConfigValidationError;
      expect(cve.message).toMatch(/Config validation failed \(\d+ issues?\)/);
      expect(cve.message).toContain('unknown-semantic-kind');
      expect(cve.message).toContain('unknown-source-key');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// JSON string input
// ─────────────────────────────────────────────────────────────

describe('loadConfig — JSON string input', () => {
  it('parses a valid JSON string', async () => {
    const normalized = await loadConfig(minimalValidJson());
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });

  it('propagates SyntaxError from malformed JSON', async () => {
    await expect(loadConfig('{ not json }')).rejects.toThrow(SyntaxError);
  });

  it('detects JSON from leading `{`', async () => {
    const normalized = await loadConfig(`   ${minimalValidJson()}`);
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });

  it('respects explicit format: "json"', async () => {
    const normalized = await loadConfig(minimalValidJson(), { format: 'json' });
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });
});

// ─────────────────────────────────────────────────────────────
// YAML string input
// ─────────────────────────────────────────────────────────────

describe('loadConfig — YAML string input', () => {
  it('parses a valid YAML string', async () => {
    const normalized = await loadConfig(minimalValidYaml());
    expect(normalized.rows[0].id).toBe('DOMAINS');
    expect(normalized.sources.features).toBe(
      'https://example.org/features'
    );
  });

  it('detects YAML when the leading char is not { or [', async () => {
    // Same content as the JSON test but lacks braces → YAML path.
    const normalized = await loadConfig(minimalValidYaml());
    expect(normalized.rows[0].tracks[0].kind).toBe('features');
  });

  it('respects explicit format: "yaml"', async () => {
    const normalized = await loadConfig(minimalValidYaml(), {
      format: 'yaml',
    });
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });

  it('YAML round-trips: JSON → YAML → JSON has identical normalized output', async () => {
    const fromJson = await loadConfig(minimalValidJson());
    const fromYaml = await loadConfig(minimalValidYaml());
    expect(fromYaml).toEqual(fromJson);
  });

  // Constraint C4: `CORE_SCHEMA` carries no `!!js/*` tags, so a config
  // cannot construct arbitrary JS objects. This is a security boundary,
  // so assert it rather than trusting the schema argument stays put.
  it('rejects the `!!js/function` tag', async () => {
    await expect(
      loadConfig("rows: !!js/function 'function () { return 1; }'")
    ).rejects.toThrow();
  });

  // A document with no content is version-dependent in js-yaml (4.x
  // returns undefined/null, 5.x throws), so `parseYaml` pins it.
  it('rejects a blank document', async () => {
    await expect(loadConfig('')).rejects.toThrow(SyntaxError);
  });

  it('rejects a whitespace-only document', async () => {
    await expect(loadConfig('   \n\n  ')).rejects.toThrow(SyntaxError);
  });

  it('rejects a comments-only document', async () => {
    await expect(
      loadConfig('# just a comment\n# and another')
    ).rejects.toThrow(SyntaxError);
  });

  it('treats a bare `---` as a document, not as empty', async () => {
    // Parses to `null`, which is a valid parse but an invalid config —
    // so it must fail validation, not YAML syntax.
    await expect(loadConfig('---')).rejects.toThrow(ConfigValidationError);
  });
});

// ─────────────────────────────────────────────────────────────
// Invalid input types
// ─────────────────────────────────────────────────────────────

describe('loadConfig — invalid input type', () => {
  it('throws TypeError on number input', async () => {
    await expect(loadConfig(42 as unknown)).rejects.toThrow(TypeError);
  });

  it('throws TypeError on null input', async () => {
    await expect(loadConfig(null as unknown)).rejects.toThrow(TypeError);
  });
});
