/**
 * Locks in the public theming surface introduced by the styling
 * modernisation: the design-token registry, the light-DOM default
 * block, the datatable's `::part` attributes, and the drift guards that
 * keep the datatable `:host` defaults and `docs/theming.md` in lock-step
 * with the registry (which calls itself the single source of truth).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TOKENS,
  tokenDefaults,
  tokenRef,
  inheritsFromGlobal,
} from '../tokens.js';
import { installTokenDefaults } from '../inject.js';
import viewerStyles from '../protvista-styles.js';
import configPanelStyles from '../config-panel-styles.js';
import {
  ProtvistaUniprotDatatable,
  type ColumnConfig,
} from '../../protvista-uniprot-datatable.js';

/**
 * Resolve a registry default to the literal it ultimately renders as: a
 * bare `var(--protvista-global)` reference resolves to that global
 * token's own default. Used to compare registry defaults against the CSS
 * that actually ships.
 */
function resolveDefault(def: string): string {
  const m = def.match(/^var\((--protvista-[a-z0-9-]+)\)$/);
  if (!m) return def;
  return TOKENS.find((t) => t.name === m[1])?.default ?? def;
}

describe('design-token registry', () => {
  it('every token is well-formed and uniquely named', () => {
    const names = new Set<string>();
    for (const t of TOKENS) {
      expect(t.name).toMatch(/^--protvista-[a-z0-9-]+$/);
      expect(t.default.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(['color', 'length', 'font', 'shadow']).toContain(t.type);
      expect(names.has(t.name), `duplicate token ${t.name}`).toBe(false);
      names.add(t.name);
    }
  });

  it('token references only point at other declared tokens', () => {
    const names = new Set(TOKENS.map((t) => t.name));
    for (const t of TOKENS) {
      const refs = [...t.default.matchAll(/var\((--[a-z0-9-]+)/g)].map(
        (m) => m[1]
      );
      for (const ref of refs) {
        expect(names.has(ref), `${t.name} references unknown ${ref}`).toBe(
          true
        );
      }
    }
  });
});

describe('light-DOM token defaults', () => {
  it('emits a declaration for every literal-default non-datatable token', () => {
    const css = tokenDefaults();
    for (const t of TOKENS) {
      if (t.group === 'datatable') {
        // Datatable declares its own :host defaults (with aliases).
        expect(css).not.toContain(`${t.name}:`);
      } else if (inheritsFromGlobal(t)) {
        // Declaring these here would substitute the global token at the
        // root — see `tokenRef`. They are read with their chain instead.
        expect(css, `${t.name} must not be declared at the root`).not.toContain(
          `${t.name}:`
        );
      } else {
        expect(css).toContain(`${t.name}: ${t.default};`);
      }
    }
  });

  it('reads an inheriting token with its full default chain', () => {
    // The point of the chain: `var()` substitution happens at the element
    // that uses the value, so both the component token and the global it
    // defaults from are picked up wherever the consumer declared them.
    expect(tokenRef('--protvista-track-label-color')).toBe(
      'var(--protvista-track-label-color, var(--protvista-color-text, #222222))'
    );
    // A literal-default token is just itself plus that literal.
    expect(tokenRef('--protvista-color-text')).toBe(
      'var(--protvista-color-text, #222222)'
    );
    expect(() => tokenRef('--protvista-not-a-token')).toThrow();
  });

  it('never reads an inheriting token bare in the shipped CSS', () => {
    // A bare `var(--inheriting-token)` in a rule has no default at all
    // now that the root block omits it — this is the drift guard that
    // keeps a new rule from reintroducing one.
    const css = [viewerStyles, configPanelStyles].map(String).join('\n');
    for (const t of TOKENS.filter(inheritsFromGlobal)) {
      expect(css, `${t.name} read without its default chain`).not.toContain(
        `var(${t.name})`
      );
    }
  });

  it('installs defaults on :where(:root) so ancestor overrides win', () => {
    installTokenDefaults();
    const node = document.head.querySelector(
      'style[data-protvista-style="tokens"]'
    );
    // Declaring on :root (not the host tags) is load-bearing: a value set
    // directly on the host would shadow a consumer's `:root { … }`
    // override. :where() keeps it at specificity 0 so the override wins.
    expect(node?.textContent).toContain(':where(:root)');
    expect(node?.textContent).toContain('--protvista-color-accent: #0053d6;');
  });
});

describe('datatable defaults stay in sync with the registry', () => {
  const raw = (ProtvistaUniprotDatatable as unknown as { styles: unknown })
    .styles;
  const cssText = Array.isArray(raw) ? raw.map(String).join('\n') : String(raw);
  const datatableTokens = TOKENS.filter((t) => t.group === 'datatable');

  it('ships every datatable token with its registry default value', () => {
    for (const t of datatableTokens) {
      expect(cssText, `${t.name} absent from datatable CSS`).toContain(t.name);
      const lit = resolveDefault(t.default);
      expect(cssText, `${t.name} default (${lit}) drifted from registry`).toContain(
        lit
      );
    }
  });

  it('references no datatable custom property missing from the registry', () => {
    const referenced = new Set(
      [...cssText.matchAll(/(--protvista-datatable-[a-z-]+)/g)].map((m) => m[1])
    );
    const known = new Set(datatableTokens.map((t) => t.name));
    for (const name of referenced) {
      expect(known.has(name), `${name} used but not in registry`).toBe(true);
    }
  });

  it('declares no token on :host, so an override from above can reach it', () => {
    // A declaration *on* an element beats a value *inherited* into it,
    // whatever the specificity — so declaring these on `:host` made them
    // reachable only by an inline style or `!important`, against what
    // docs/theming.md promises. Every read carries its chain instead.
    expect(cssText).not.toMatch(/--protvista-[a-z0-9-]+\s*:/);
  });

  it('still honours a --protvista-dt-* override, after the current name', () => {
    // The back-compat aliases: tried after the token itself and before
    // the registry default, so an old override keeps working and a new
    // one wins over it.
    expect(cssText).toContain(
      'var(--protvista-datatable-border, var(--protvista-dt-border, #e0e0e0))'
    );
    expect(cssText).toContain(
      'var(--protvista-datatable-accent, var(--protvista-dt-primary, var(--protvista-color-accent, #0053d6)))'
    );
  });
});

describe('theming docs stay in sync with the registry', () => {
  // Vitest runs from the repo root, so resolve the docs path from cwd.
  const docs = readFileSync(
    join(process.cwd(), 'docs/src/content/docs/theming.md'),
    'utf8'
  );

  it('documents every token name and its default value', () => {
    for (const t of TOKENS) {
      expect(docs, `${t.name} missing from docs`).toContain(t.name);
      expect(docs, `default for ${t.name} missing from docs`).toContain(
        t.default
      );
    }
  });
});

describe('datatable ::part surface', () => {
  let el: HTMLElement & {
    columns: ReadonlyArray<ColumnConfig<{ id: string }>>;
    data: ReadonlyArray<{ id: string }>;
    selectedId?: string;
    updateComplete: Promise<unknown>;
  };

  beforeEach(async () => {
    el = document.createElement('protvista-uniprot-datatable') as never;
    el.columns = [{ key: 'id', label: 'ID', filterable: true }];
    el.data = [{ id: '1' }, { id: '2' }];
    document.body.append(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
  });

  const parts = () =>
    [...el.shadowRoot!.querySelectorAll('[part]')].flatMap((n) =>
      (n.getAttribute('part') || '').split(/\s+/)
    );

  it('exposes the documented structural parts', () => {
    const found = new Set(parts());
    for (const p of [
      'scroll-container',
      'table',
      'header',
      'header-cell',
      'filter-select',
      'row',
      'cell',
    ]) {
      expect(found.has(p), `missing part="${p}"`).toBe(true);
    }
  });

  it('marks the selected row with the row-active part', async () => {
    el.selectedId = '1';
    await el.updateComplete;
    const active = el.shadowRoot!.querySelector('tr.active');
    expect(active?.getAttribute('part')).toContain('row-active');
  });
});

describe('runtime theming (the no-code substrate)', () => {
  it('every registry token is a valid, runtime-settable custom property', () => {
    // A no-code panel drives theming by writing each token via
    // style.setProperty; this proves every registry name is a
    // syntactically valid custom property that round-trips.
    const el = document.createElement('div');
    for (const t of TOKENS) {
      el.style.setProperty(t.name, 'rgb(1, 2, 3)');
      expect(
        el.style.getPropertyValue(t.name),
        `${t.name} is not a settable custom property`
      ).toBe('rgb(1, 2, 3)');
      el.style.removeProperty(t.name);
    }
  });
});
