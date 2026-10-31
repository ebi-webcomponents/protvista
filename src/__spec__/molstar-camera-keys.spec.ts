// @vitest-environment node

/**
 * Pins issue to file P of the WCAG audit (`docs/accessibility-audit.md`,
 * 2.1.4 Character key shortcuts): the Mol* 3D view inside
 * `nightingale-structure` binds I, O and T to spin, rock and reset the
 * camera, with no modifier key, and ProtVista cannot turn them off.
 *
 * The browser specs stub `nightingale-structure` (Mol* needs WebGL and
 * structure data), so this reads the installed bundle instead: its plugin
 * spec includes the `CameraControls` behaviour, and that behaviour's key
 * bindings are single letters. A Nightingale or Mol* upgrade that drops the
 * behaviour, adds a modifier or changes the keys fails here; then re-check
 * 2.1.4 and update issue P and this test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the repo root, so resolve paths from cwd.
const bundle = readFileSync(
  resolve(
    process.cwd(),
    'node_modules/@nightingale-elements/nightingale-structure/dist/index.js'
  ),
  'utf8'
);

describe('Mol* camera keys in nightingale-structure (issue to file: P)', () => {
  it('the viewer includes the CameraControls behaviour', () => {
    expect(bundle).toMatch(/\.Behavior\([\w$.]*\bCamera\.CameraControls\)/);
  });

  it('binds I, O and T with no modifier', () => {
    // Mol*'s `Binding([Trigger(key, modifiers?)])`, minified: a trigger
    // with one argument has no modifier.
    const keys = Object.fromEntries(
      [
        ...bundle.matchAll(
          /\bkey(SpinAnimation|RockAnimation|ResetView):[\w$]+\(\[[\w$]+\(("[^"]*")(,[^)]*)?\)\]/g
        ),
      ].map((m) => [m[1], { key: JSON.parse(m[2]) as string, modifier: m[3] ?? null }])
    );
    expect(keys).toEqual({
      SpinAnimation: { key: 'I', modifier: null },
      RockAnimation: { key: 'O', modifier: null },
      ResetView: { key: 'T', modifier: null },
    });
  });
});
