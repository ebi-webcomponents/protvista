/**
 * Registry-driven component registration (audit B18).
 *
 * Verifies that `<protvista-uniprot>` defines custom-element tags from
 * the registry rather than a hand-rolled list:
 *
 *   (a) the structural chrome + the components a config references are
 *       defined after registration — the 10 built-in tags, no regression;
 *   (b) a consumer-registered component is picked up when its kind /
 *       component appears in the config, without the embedder touching
 *       `customElements.define` — and an *unreferenced* consumer
 *       component is left undefined (the walk is config-driven).
 *
 * The `@nightingale-elements/*` constructors are stubbed globally via
 * `nightingale-mocks.ts`. We drive the private registration methods
 * directly (mirroring `set-track-data-integration.spec.ts` calling
 * `_loadData`) to avoid the `_init` → `loadEntry` → real-fetch path.
 *
 * jsdom shares one `customElements` registry across the file and cannot
 * un-define a tag, so assertions use globally-unique consumer tag names
 * where isolation matters.
 */

import { describe, it, expect } from 'vitest';
import '../protvista-uniprot.js';
import { loadConfig } from '../schema/load.js';
import type { Registry } from '../schema/registry.js';
import type { NormalizedConfig, NormalizedTrack } from '../schema/normalize.js';
import type { SemanticKindDefinition } from '../schema/types.js';

type RegistrationHarness = HTMLElement & {
  registry: Registry;
  registerComponent(name: string, ctor: CustomElementConstructor): void;
  registerSemanticKind(name: string, def: SemanticKindDefinition): void;
  registerStructuralComponents(): void;
  registerConfigComponents(config: NormalizedConfig): void;
};

const el = () =>
  document.createElement('protvista-uniprot') as unknown as RegistrationHarness;

const track = (id: string, component: string): NormalizedTrack => ({
  id,
  label: id,
  component,
  rendering: {},
  data: [],
});

const configWith = (
  groupComponent: string,
  trackComponents: string[]
): NormalizedConfig => ({
  version: '1.0',
  sources: {},
  defaults: { rendering: {} },
  rows: [
    {
      id: 'G',
      label: 'G',
      component: groupComponent,
      rendering: {},
      tracks: trackComponents.map((c, i) => track(`t${i}`, c)),
    },
  ],
});

describe('component registration — built-in walk (no regression)', () => {
  it('defines the 5 structural chrome tags', () => {
    el().registerStructuralComponents();
    for (const name of [
      'nightingale-manager',
      'nightingale-navigation',
      'nightingale-sequence',
      'nightingale-filter',
      'protvista-uniprot-structure',
    ]) {
      expect(customElements.get(name)).toBeTypeOf('function');
    }
  });

  it('defines every renderable component the config references', () => {
    // A config exercising all five renderable components.
    const config = configWith('nightingale-track-canvas', [
      'nightingale-colored-sequence',
      'nightingale-variation-canvas',
      'nightingale-linegraph-track',
      'nightingale-sequence-heatmap',
    ]);
    el().registerConfigComponents(config);
    for (const name of [
      'nightingale-track-canvas',
      'nightingale-colored-sequence',
      'nightingale-variation-canvas',
      'nightingale-linegraph-track',
      'nightingale-sequence-heatmap',
    ]) {
      expect(customElements.get(name)).toBeTypeOf('function');
    }
  });
});

describe('component registration — consumer components', () => {
  it('picks up a consumer component referenced via a semantic kind (through normalize)', async () => {
    const element = el();
    // Unique tag so the assertion is isolation-proof.
    const tag = 'consumer-track-via-kind';
    element.registerComponent(tag, class extends HTMLElement {});
    element.registerSemanticKind('consumer-kind', {
      component: tag,
      adapter: 'features-json',
    });

    expect(customElements.get(tag)).toBeUndefined(); // not yet defined

    // Run the real pipeline against the element's own registry so the
    // `kind:` actually resolves to `tag` (normalize does `t.component ??
    // kindDef.component`) — that resolved name is what the walk sees.
    const normalized = await loadConfig(
      {
        sources: { s: 'https://example.org/x' },
        rows: [{ id: 'G', tracks: [{ id: 't', kind: 'consumer-kind', data: 's' }] }],
      },
      { registry: element.registry }
    );
    // Sanity: the kind resolved to the consumer component.
    expect(normalized.rows[0].tracks[0].component).toBe(tag);

    element.registerConfigComponents(normalized);

    expect(customElements.get(tag)).toBeTypeOf('function');
  });

  it('leaves a registered-but-unreferenced consumer component undefined', () => {
    const element = el();
    const tag = 'consumer-track-unreferenced';
    element.registerComponent(tag, class extends HTMLElement {});

    // Config references only built-ins, never `tag`.
    element.registerConfigComponents(
      configWith('nightingale-track-canvas', ['nightingale-track-canvas'])
    );

    expect(customElements.get(tag)).toBeUndefined();
  });
});
