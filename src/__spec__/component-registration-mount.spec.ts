/**
 * Registry-driven registration — the *wiring* (audit B18).
 *
 * `component-registration.spec.ts` drives the registration methods
 * directly and proves they do the right thing. This file proves the
 * element actually calls them, over the real
 * `connectedCallback → _init()` lifecycle:
 *
 *   - `connectedCallback` → `registerStructuralComponents()`
 *   - `_init()`           → `registerConfigComponents(normalized)`
 *
 * Without these, deleting either call site leaves the whole suite green
 * — the unit-level file would still pass, because it never asks who
 * calls the methods.
 *
 * Why a separate file: `customElements` is global and cannot un-define a
 * tag, so "was this tag defined by the mount?" is only answerable in a
 * registry no other test has already populated. Vitest gives each spec
 * file its own jsdom environment, so the assertions here are
 * order-independent — which they would not be if they shared a file with
 * tests that define the same tags directly.
 *
 * The `@nightingale-elements/*` constructors are stubbed globally via
 * `nightingale-mocks.ts` (setupFiles).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Registers <protvista-uniprot> only — the Nightingale tags are defined
// by the element at runtime, which is exactly what's under test here.
import '../protvista-uniprot.js';
import type { NormalizedConfig } from '../schema/normalize.js';
import type { SemanticKindDefinition } from '../schema/types.js';

// `CSS.escape` (missing from this jsdom, needed by the mount lifecycle) is
// polyfilled globally in `setup.ts`.

type El = HTMLElement & {
  config?: NormalizedConfig;
  viewerConfig?: unknown;
  accession?: string;
  registerComponent(name: string, ctor: CustomElementConstructor): void;
  registerSemanticKind(name: string, def: SemanticKindDefinition): void;
};

// The four `nightingale-*` tags have no self-registering path, so they are
// undefined until `registerStructuralComponents()` runs. `protvista-uniprot-
// structure` is different: its real module self-registers via `@customElement`
// at import time, so it is only undefined-on-import (and thus able to detect
// the deletion) because `nightingale-mocks.ts` stubs that module with a
// decorator-free class. If that stub changes, the guard below would break and
// the structural mutation would go undetected for this one tag.
const STRUCTURAL_TAGS = [
  'nightingale-manager',
  'nightingale-navigation',
  'nightingale-sequence',
  'nightingale-filter',
  'protvista-uniprot-structure',
];

/** Enough of the UniProt Proteins API for `_init()` to get past the fetch. */
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            sequence: { sequence: 'MSEQENCE' },
            features: [],
          }),
        }) as unknown as Response
    )
  );
}

const appended: HTMLElement[] = [];

/** Create (but do not connect) an element, so registrations can land first. */
function makeEl(): El {
  return document.createElement('protvista-uniprot') as unknown as El;
}

function connect(el: El): El {
  document.body.append(el);
  appended.push(el);
  return el;
}

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('connectedCallback defines the structural chrome', () => {
  // A specificity guard, not a mutation-killer: it asserts nothing defined
  // these tags *before* a connect. It relies on running before the connect
  // test below — jsdom cannot un-define a tag, so once that test connects an
  // element the tags stay defined for the rest of the file. Vitest runs tests
  // in declaration order by default; do not enable `sequence.shuffle` for this
  // file, and keep this test first.
  it('leaves the chrome tags undefined until an element connects', () => {
    for (const tag of STRUCTURAL_TAGS) {
      expect(customElements.get(tag)).toBeUndefined();
    }
  });

  it('defines every chrome tag once connected', () => {
    stubFetch();
    connect(makeEl());

    for (const tag of STRUCTURAL_TAGS) {
      expect(customElements.get(tag)).toBeTypeOf('function');
    }
  });
});

describe('_init defines the components the config references', () => {
  it('defines a consumer component reached through a semantic kind', async () => {
    stubFetch();

    const tag = 'mount-consumer-track';
    const el = makeEl();
    // Registration has to happen before the element connects — the
    // lifecycle kicks off `_init()` synchronously from
    // `connectedCallback`.
    el.registerComponent(tag, class extends HTMLElement {});
    el.registerSemanticKind('mount-consumer-kind', {
      component: tag,
      adapter: 'features-json',
    });
    el.accession = 'P05067';
    el.viewerConfig = {
      sources: { s: 'https://example.org/x' },
      rows: [
        { id: 'G', tracks: [{ id: 't', kind: 'mount-consumer-kind', data: 's' }] },
      ],
    };

    expect(customElements.get(tag)).toBeUndefined();

    connect(el);

    // The tag is defined by the registration walk in `_init`, after
    // `loadConfig` resolves the kind to `tag`.
    await vi.waitFor(() => {
      if (!customElements.get(tag)) throw new Error('tag not defined yet');
    });

    // Sanity: it really was the kind that resolved to this component,
    // so the walk read a normalized config rather than a literal.
    expect(el.config?.rows[0].tracks[0].component).toBe(tag);
  });

  it('defines the built-in renderable component a config references', async () => {
    stubFetch();

    const el = makeEl();
    el.accession = 'P05067';
    el.viewerConfig = {
      sources: { s: 'https://example.org/x' },
      rows: [{ id: 'G', tracks: [{ id: 't', kind: 'features', data: 's' }] }],
    };

    expect(customElements.get('nightingale-track-canvas')).toBeUndefined();

    connect(el);

    await vi.waitFor(() => {
      if (!customElements.get('nightingale-track-canvas')) {
        throw new Error('tag not defined yet');
      }
    });
  });

  it('leaves an unreferenced renderable built-in undefined after mount', async () => {
    // A specificity guard, not a mutation-killer: it does not fail on either
    // deletion. It proves the walk is config-driven, not a blanket "define
    // everything" — a component no entry resolves to stays undefined. This is
    // the behavioural difference from the old `registerWebComponents()`.
    stubFetch();

    const el = makeEl();
    el.accession = 'P05067';
    el.viewerConfig = {
      sources: { s: 'https://example.org/x' },
      rows: [{ id: 'G', tracks: [{ id: 't', kind: 'features', data: 's' }] }],
    };
    connect(el);

    // `el.config` is a sufficient anchor: `_init` assigns it and runs the
    // registration walk in the same synchronous block (no `await` between
    // `this.config = normalized` and `registerConfigComponents`), so once
    // config is observable the walk has already completed. Anchoring on a
    // specific defined tag instead would couple this guard to the walk's
    // output and make it fail-by-timeout on a deleted call site — which is
    // the mutation-killers' job, not this guard's.
    await vi.waitFor(() => {
      if (!el.config) throw new Error('config not resolved yet');
    });

    expect(customElements.get('nightingale-sequence-heatmap')).toBeUndefined();
  });
});
