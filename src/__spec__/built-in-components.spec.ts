/**
 * `built-in-components` contract tests.
 *
 * Verifies the built-in constructor table and its registry seeder:
 * that `registerBuiltinComponents` seeds exactly the renderable set
 * through the public `registerComponent` path, that the two groups are
 * the expected disjoint 10 tags, and that the renderable names stay in
 * lockstep with the schema-layer `RENDERABLE_COMPONENT_NAMES`.
 *
 * The `@nightingale-elements/*` constructors are stubbed globally via
 * `nightingale-mocks.ts` (setupFiles), so importing the table here is
 * cheap.
 */

import { describe, it, expect } from 'vitest';
import {
  RENDERABLE_COMPONENTS,
  STRUCTURAL_COMPONENTS,
  registerBuiltinComponents,
} from '../built-in-components';
import { RENDERABLE_COMPONENT_NAMES } from '../schema/components';
import {
  createRegistry,
  RegistryCollisionError,
  type Registry,
} from '../schema/registry';

describe('built-in-components — table shape', () => {
  it('exposes 10 built-in tags split into 5 renderable + 5 structural', () => {
    expect(RENDERABLE_COMPONENTS).toHaveLength(5);
    expect(STRUCTURAL_COMPONENTS).toHaveLength(5);
  });

  it('has disjoint renderable and structural name sets', () => {
    const renderable = new Set(RENDERABLE_COMPONENTS.map(([n]) => n));
    const structural = STRUCTURAL_COMPONENTS.map(([n]) => n);
    for (const name of structural) {
      expect(renderable.has(name)).toBe(false);
    }
  });

  it('lists the expected structural chrome tags', () => {
    expect(STRUCTURAL_COMPONENTS.map(([n]) => n).sort()).toEqual([
      'nightingale-filter',
      'nightingale-manager',
      'nightingale-navigation',
      'nightingale-sequence',
      'protvista-uniprot-structure',
    ]);
  });

  it('pairs every name with a constructor', () => {
    for (const [name, ctor] of [
      ...RENDERABLE_COMPONENTS,
      ...STRUCTURAL_COMPONENTS,
    ]) {
      expect(name).toBeTypeOf('string');
      expect(ctor).toBeTypeOf('function');
    }
  });
});

describe('built-in-components — renderable/name drift guard', () => {
  it('RENDERABLE_COMPONENTS names match RENDERABLE_COMPONENT_NAMES exactly', () => {
    const fromTable = RENDERABLE_COMPONENTS.map(([n]) => n).sort();
    const fromSet = [...RENDERABLE_COMPONENT_NAMES].sort();
    expect(fromTable).toEqual(fromSet);
  });
});

describe('registerBuiltinComponents — seeding', () => {
  it('seeds every renderable component onto a fresh registry', () => {
    const r = createRegistry();
    registerBuiltinComponents(r);
    for (const [name, ctor] of RENDERABLE_COMPONENTS) {
      expect(r.hasComponent(name)).toBe(true);
      expect(r.getComponent(name)).toBe(ctor);
    }
    // Only the renderable set — structural chrome is registered
    // directly by the element, not through the registry.
    expect(r.listComponents()).toEqual(
      [...RENDERABLE_COMPONENTS.map(([n]) => n)].sort()
    );
  });

  it('routes each built-in through the public registerComponent path', () => {
    const calls: Array<[string, CustomElementConstructor]> = [];
    const fake = {
      registerComponent: (name: string, ctor: CustomElementConstructor) => {
        calls.push([name, ctor]);
      },
    } as unknown as Registry;
    registerBuiltinComponents(fake);
    expect(calls).toEqual(RENDERABLE_COMPONENTS.map(([n, c]) => [n, c]));
  });

  it('is not idempotent — a second seed collides (no override path)', () => {
    const r = createRegistry();
    registerBuiltinComponents(r);
    expect(() => registerBuiltinComponents(r)).toThrow(RegistryCollisionError);
  });
});
