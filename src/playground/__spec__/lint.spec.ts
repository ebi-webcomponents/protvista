/**
 * The playground's live-validation contract: a good config yields no
 * diagnostics; a syntactically broken one yields a single `syntax`
 * error; a semantically invalid one surfaces the validator's own issue
 * codes (so the editor and `src/schema/validate.ts` never drift).
 */
import { describe, it, expect } from 'vitest';
import { computeDiagnostics } from '../lint';

const VALID = `accession: P05067
rows:
  - id: MY_ANNOTATIONS
    tracks:
      - id: sites
        kind: features
        data:
          from: inline
          inlineData:
            - type: BINDING
              start: 45
              end: 52
`;

describe('computeDiagnostics', () => {
  it('reports nothing for a blank editor', async () => {
    expect(await computeDiagnostics('')).toEqual([]);
    expect(await computeDiagnostics('   \n  ')).toEqual([]);
  });

  it('reports nothing for a valid config', async () => {
    expect(await computeDiagnostics(VALID)).toEqual([]);
  });

  it('reports a single syntax error for malformed YAML at an in-range, non-zero offset', async () => {
    // First line parses; the error is the unterminated flow sequence on
    // line 2, so `offsetFromParseError` (js-yaml's `mark.position`) must
    // report a real offset past the first line — not a hardcoded 0.
    const text = 'good: 1\nbad: [unterminated';
    const diagnostics = await computeDiagnostics(text);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('syntax');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].from).toBeGreaterThan(0);
    expect(diagnostics[0].to).toBeGreaterThanOrEqual(diagnostics[0].from);
    expect(diagnostics[0].to).toBeLessThanOrEqual(text.length);
  });

  it('surfaces the validator code for an unknown track kind', async () => {
    const bad = `accession: P05067
rows:
  - id: MY_ROW
    tracks:
      - id: t
        kind: notakind
        data:
          from: inline
          inlineData: []
`;
    const diagnostics = await computeDiagnostics(bad);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.map((d) => d.code)).toContain('unknown-semantic-kind');
    // The offending path is carried through for the side error list.
    expect(diagnostics.some((d) => d.message.includes('notakind') || d.path)).toBe(
      true
    );
  });

  it('does not crash when an id contains regex metacharacters', async () => {
    // `id: "a(b"` is schema-valid, so the semantic pass runs and emits an
    // issue whose `path` carries the id. That id once reached `new RegExp`
    // in locate() unescaped — an unbalanced `(` threw SyntaxError and
    // rejected the whole promise. It must now be escaped, not throw.
    const bad = `rows:
  - id: MY_ROW
    tracks:
      - id: "a(b"
        kind: features
        data: nope
`;
    const diagnostics = await computeDiagnostics(bad);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.from).toBeGreaterThanOrEqual(0);
      expect(diagnostic.to).toBeLessThanOrEqual(bad.length);
    }
  });

  it('injects the supplied accession so a {accession}-only config validates', async () => {
    // A config that uses {accession} placeholders but declares no
    // accession of its own (like the canonical default config).
    const text = `sources:
  features: https://example.org/features/{accession}
rows:
  - id: DOMAINS
    tracks:
      - id: domain
        kind: features
        data: features
`;
    // No accession → the missing-accession rule fires.
    const without = await computeDiagnostics(text);
    expect(without.map((d) => d.code)).toContain('missing-accession');
    // With the playground's accession injected → clean.
    expect(await computeDiagnostics(text, 'P05067')).toEqual([]);
  });
});
