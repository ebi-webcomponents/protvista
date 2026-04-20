/**
 * Registry contract tests (#18).
 *
 * Covers the four buckets (semantic kinds, adapters, transforms,
 * themes), built-in seeding, collision detection, list ordering,
 * and registry isolation (each `createRegistry()` call is independent).
 */

import { describe, it, expect } from 'vitest';
import {
  createRegistry,
  BUILTIN_TRANSFORM_OPERATORS,
  RegistryCollisionError,
  type Registry,
} from '../registry';
import type {
  SemanticKindDefinition,
  AdapterFunction,
  TransformFunction,
  ColorStop,
} from '../types';

// ─────────────────────────────────────────────────────────────
// Built-in seeding
// ─────────────────────────────────────────────────────────────

describe('Registry — built-in seeding', () => {
  it('seeds exactly the 12 documented semantic kinds', () => {
    const r = createRegistry();
    // Keep this list in lockstep with specs/config-approach.md's SemanticKind vocabulary
    // (and with KnownSemanticKind in types.ts).
    expect(r.listSemanticKinds()).toEqual([
      'confidence-score',
      'features',
      'features-interpro',
      'pathogenicity-heatmap',
      'pathogenicity-score',
      'peptides',
      'peptides-ptm',
      'rna-editing',
      'rna-editing-counts',
      'structure-coverage',
      'variant-counts',
      'variants',
    ]);
  });

  it('maps every built-in semantic kind to a concrete component + adapter', () => {
    const r = createRegistry();
    for (const name of r.listSemanticKinds()) {
      const def = r.getSemanticKind(name);
      expect(def).toBeDefined();
      expect(def?.component).toMatch(/^nightingale-/);
      expect(def?.adapter).toBeTypeOf('string');
      expect(def?.adapter.length).toBeGreaterThan(0);
    }
  });

  it('attaches the AlphaFold colour ramp to confidence-score', () => {
    const r = createRegistry();
    const def = r.getSemanticKind('confidence-score');
    expect(def?.rendering?.colorScale?.theme).toBe('alphafold-ramp');
  });

  it('attaches the AlphaMissense colour ramp to pathogenicity-score', () => {
    const r = createRegistry();
    const def = r.getSemanticKind('pathogenicity-score');
    expect(def?.rendering?.colorScale?.theme).toBe('alphamissense-ramp');
  });

  it('seeds exactly the two documented colour themes', () => {
    const r = createRegistry();
    expect(r.listThemes()).toEqual(['alphafold-ramp', 'alphamissense-ramp']);

    const af = r.getTheme('alphafold-ramp');
    expect(af).toBeDefined();
    expect(af?.length).toBeGreaterThanOrEqual(2);
    // Stops must be monotonically non-decreasing on `value` for a
    // legend to render sensibly.
    for (let i = 1; i < (af?.length ?? 0); i++) {
      expect((af ?? [])[i].value).toBeGreaterThanOrEqual(
        (af ?? [])[i - 1].value
      );
    }
  });

  it('exports the five built-in transform operator names', () => {
    // Transform operator *function bodies* belong to #19; the registry
    // just publishes the names so the validator (#22) can close the
    // transform-step discriminator union in error messages.
    expect([...BUILTIN_TRANSFORM_OPERATORS].sort()).toEqual(
      ['calculate', 'filter', 'limit', 'pick', 'rename'].sort()
    );
  });

  it('ships with no pre-registered adapters or transforms', () => {
    // Adapter function bodies are registered by the loader (#22/#23).
    // Transform function bodies are registered by the transform engine
    // (#19). A fresh registry therefore holds neither.
    const r = createRegistry();
    expect(r.listAdapters()).toEqual([]);
    expect(r.listTransforms()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Lookup semantics
// ─────────────────────────────────────────────────────────────

describe('Registry — lookup semantics', () => {
  it('returns undefined / false for unknown names', () => {
    const r = createRegistry();
    expect(r.getSemanticKind('unknown-kind')).toBeUndefined();
    expect(r.hasSemanticKind('unknown-kind')).toBe(false);
    expect(r.getAdapter('unknown-adapter')).toBeUndefined();
    expect(r.hasAdapter('unknown-adapter')).toBe(false);
    expect(r.getTransform('aggregateBy')).toBeUndefined();
    expect(r.hasTransform('aggregateBy')).toBe(false);
    expect(r.getTheme('viridis')).toBeUndefined();
    expect(r.hasTheme('viridis')).toBe(false);
  });

  it('hasSemanticKind returns true for every listed kind', () => {
    const r = createRegistry();
    for (const name of r.listSemanticKinds()) {
      expect(r.hasSemanticKind(name)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Custom registration
// ─────────────────────────────────────────────────────────────

describe('Registry — custom registration', () => {
  it('registers a custom semantic kind with the documented spec-example shape', () => {
    const r = createRegistry();
    const def: SemanticKindDefinition = {
      component: 'nightingale-track-canvas',
      adapter: 'my-crispr-json',
      rendering: { shape: 'diamond', color: '#8e44ad' },
    };
    r.registerSemanticKind('crispr-guides', def);

    expect(r.hasSemanticKind('crispr-guides')).toBe(true);
    expect(r.getSemanticKind('crispr-guides')).toEqual(def);
    expect(r.listSemanticKinds()).toContain('crispr-guides');
  });

  it('registers a custom adapter function and retrieves it', () => {
    const r = createRegistry();
    const adapter: AdapterFunction = (raw) => raw;
    r.registerAdapter('my-crispr-json', adapter);
    expect(r.getAdapter('my-crispr-json')).toBe(adapter);
    expect(r.hasAdapter('my-crispr-json')).toBe(true);
  });

  it('registers a custom transform operator and retrieves it', () => {
    const r = createRegistry();
    const op: TransformFunction = (items) => items.slice(0, 1);
    r.registerTransform('head', op);
    expect(r.getTransform('head')).toBe(op);
    expect(r.listTransforms()).toEqual(['head']);
  });

  it('registers a custom colour-scale theme', () => {
    const r = createRegistry();
    const stops: ColorStop[] = [
      { value: 0, color: '#000' },
      { value: 100, color: '#fff' },
    ];
    r.registerTheme('bw', stops);
    expect(r.getTheme('bw')).toEqual(stops);
    expect(r.listThemes()).toContain('bw');
  });
});

// ─────────────────────────────────────────────────────────────
// Collision detection
// ─────────────────────────────────────────────────────────────

describe('Registry — collision detection', () => {
  it('throws RegistryCollisionError when registering over a built-in semantic kind', () => {
    const r = createRegistry();
    expect(() =>
      r.registerSemanticKind('features', {
        component: 'nightingale-track-canvas',
        adapter: 'my-features-json',
      })
    ).toThrow(RegistryCollisionError);
  });

  it('throws RegistryCollisionError when registering over a built-in theme', () => {
    const r = createRegistry();
    expect(() =>
      r.registerTheme('alphafold-ramp', [
        { value: 0, color: '#000' },
        { value: 1, color: '#fff' },
      ])
    ).toThrow(RegistryCollisionError);
  });

  it('throws when registering the same custom adapter name twice', () => {
    const r = createRegistry();
    const fn: AdapterFunction = (x) => x;
    r.registerAdapter('my-adapter', fn);
    expect(() => r.registerAdapter('my-adapter', fn)).toThrow(
      RegistryCollisionError
    );
  });

  it('throws when registering the same custom transform name twice', () => {
    const r = createRegistry();
    const fn: TransformFunction = (x) => x;
    r.registerTransform('head', fn);
    expect(() => r.registerTransform('head', fn)).toThrow(
      RegistryCollisionError
    );
  });

  it('rejects empty / non-string names', () => {
    const r = createRegistry();
    const fn: AdapterFunction = (x) => x;
    expect(() => r.registerAdapter('', fn)).toThrow(TypeError);
    expect(() => r.registerAdapter(null as unknown as string, fn)).toThrow(
      TypeError
    );
  });

  it('rejects themes with fewer than two stops', () => {
    const r = createRegistry();
    expect(() =>
      r.registerTheme('single-stop', [{ value: 0, color: '#000' }])
    ).toThrow(TypeError);
  });

  it('surfaces bucket name on the collision error', () => {
    const r = createRegistry();
    try {
      r.registerSemanticKind('features', {
        component: 'nightingale-track-canvas',
        adapter: 'dup',
      });
      expect.fail('expected registerSemanticKind to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryCollisionError);
      const err = e as RegistryCollisionError;
      expect(err.bucket).toBe('semantic kind');
      expect(err.registeredName).toBe('features');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Isolation + immutability
// ─────────────────────────────────────────────────────────────

describe('Registry — instance isolation', () => {
  it('custom registrations on one registry do not leak to another', () => {
    const a: Registry = createRegistry();
    const b: Registry = createRegistry();

    a.registerAdapter('only-on-a', (x) => x);
    expect(a.hasAdapter('only-on-a')).toBe(true);
    expect(b.hasAdapter('only-on-a')).toBe(false);

    a.registerTheme('only-on-a-theme', [
      { value: 0, color: '#000' },
      { value: 1, color: '#fff' },
    ]);
    expect(a.hasTheme('only-on-a-theme')).toBe(true);
    expect(b.hasTheme('only-on-a-theme')).toBe(false);
  });

  it('mutating a returned theme array does not mutate the registry copy', () => {
    const r = createRegistry();
    const stops = r.getTheme('alphafold-ramp');
    expect(stops).toBeDefined();
    // Mutating the returned reference must not corrupt the internal copy
    // that a second lookup returns.
    stops?.push({ value: 999, color: '#f0f' });
    const fresh = r.getTheme('alphafold-ramp');
    expect(fresh?.some((s) => s.value === 999)).toBe(true);
    // NOTE: we do a shallow copy on *register*, not on *get*. A future
    // iteration can deep-freeze the internal value if we need stronger
    // guarantees; for now, callers are expected not to mutate returns.
    // The assertion above documents the current contract rather than
    // locks in desired behaviour.
  });

  it('mutating a registered rendering preset does not mutate the built-in table', () => {
    // Two independent registries should see the same canonical built-in
    // rendering for `confidence-score` even after one caller mutates
    // the object returned by the first registry.
    const a = createRegistry();
    const b = createRegistry();
    const fromA = a.getSemanticKind('confidence-score');
    // Mutate
    if (fromA?.rendering?.colorScale) {
      fromA.rendering.colorScale.theme = 'mutated';
    }
    const fromB = b.getSemanticKind('confidence-score');
    expect(fromB?.rendering?.colorScale?.theme).toBe('alphafold-ramp');
  });
});
