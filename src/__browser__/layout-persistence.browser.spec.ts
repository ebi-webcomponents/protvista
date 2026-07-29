/**
 * End-to-end coverage for layout persistence on `<protvista-uniprot>`:
 * localStorage round-trip (keyed per-config), the shareable `?layout=` URL
 * and its precedence over localStorage, the `no-persist-layout` opt-out, and
 * reset clearing both stores. A fresh mount of the element stands in for a
 * page reload — `_init()` runs `_restoreLayout()` on connect.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import '../protvista-uniprot';
import type { LayoutPatch } from '../schema/types';
import {
  STORAGE_PREFIX,
  LAYOUT_PARAM,
  encodeLayout,
} from '../layout-persistence';
import { CSS_PREFIX } from '../styles/css-prefix';
import { mount } from './mount';

const CONFIG = {
  rows: [
    {
      id: 'DOMAINS',
      label: 'Domains',
      tracks: [
        { id: 'domain', kind: 'features', data: 'https://example.org/a.json' },
        { id: 'region', kind: 'features', data: 'https://example.org/b.json' },
      ],
    },
    { id: 'sites', label: 'Sites', kind: 'features', data: 'https://example.org/c.json' },
  ],
};

type Viewer = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  noPersistLayout?: boolean;
  getLayout(): LayoutPatch;
  getConfig(): { rows: Array<{ id: string; hidden?: boolean }> } | undefined;
  setConfig(config: unknown): Promise<void>;
  setRowOrder(order: string[]): void;
  setRowVisibility(rowId: string, visible: boolean): void;
  resetLayout(): void;
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'MSEQENCE' } }
        : [{ type: 'DOMAIN', start: 1, end: 5 }];
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as unknown as Response;
    })
  );
}

/** Mount a viewer and wait until its config has loaded (the toggle is up). */
async function mountViewer(props: Partial<Viewer> = {}): Promise<Viewer> {
  const el = mount<Viewer>('protvista-uniprot', {
    viewerConfig: CONFIG,
    accession: 'P05067',
    ...props,
  });
  await vi.waitFor(() => {
    if (!el.querySelector(`.${CSS_PREFIX}-customize-toggle`)) {
      throw new Error('not ready');
    }
  });
  return el;
}

/** All ProtVista layout entries currently in localStorage. */
const storedEntries = () =>
  Object.keys(localStorage).filter((k) => k.startsWith(`${STORAGE_PREFIX}:`));

const urlLayout = () =>
  new URLSearchParams(window.location.search).get(LAYOUT_PARAM);

function clearLayoutStorage() {
  for (const k of storedEntries()) localStorage.removeItem(k);
}

let originalHref: string;

beforeEach(() => {
  stubFetch();
  originalHref = window.location.href;
  clearLayoutStorage();
});

afterEach(() => {
  window.history.replaceState(window.history.state, '', originalHref);
  clearLayoutStorage();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('layout persistence — save', () => {
  it('writes the patch to localStorage and the ?layout= URL on change', async () => {
    const el = await mountViewer();
    expect(storedEntries()).toHaveLength(0);
    expect(urlLayout()).toBeNull();

    el.setRowVisibility('DOMAINS', false);

    const keys = storedEntries();
    expect(keys).toHaveLength(1);
    expect(localStorage.getItem(keys[0])).toBeTruthy();
    expect(urlLayout()).toBeTruthy();
  });
});

describe('layout persistence — restore', () => {
  it('restores a saved patch on a fresh mount (from localStorage)', async () => {
    const el1 = await mountViewer();
    el1.setRowVisibility('DOMAINS', false);
    // Clear the URL so this exercises the localStorage path specifically.
    window.history.replaceState(window.history.state, '', originalHref);
    expect(urlLayout()).toBeNull();

    const el2 = await mountViewer();
    expect(el2.getLayout().hidden).toEqual({
      rows: { DOMAINS: true },
      tracks: {},
    });
  });

  it('lets the ?layout= URL win over localStorage', async () => {
    const el1 = await mountViewer();
    el1.setRowVisibility('DOMAINS', false); // localStorage: hidden DOMAINS

    // A different layout in the URL should take precedence.
    const urlToken = encodeLayout({
      order: ['sites', 'DOMAINS'],
      tracks: {},
      hidden: { rows: {}, tracks: {} },
    });
    const url = new URL(originalHref);
    url.searchParams.set(LAYOUT_PARAM, urlToken);
    window.history.replaceState(window.history.state, '', url);

    const el2 = await mountViewer();
    expect(el2.getLayout()).toEqual({
      order: ['sites', 'DOMAINS'],
      tracks: {},
      hidden: { rows: {}, tracks: {} },
    });
  });
});

describe('layout persistence — reset', () => {
  it('clears localStorage and the URL when reset to default', async () => {
    const el = await mountViewer();
    el.setRowVisibility('DOMAINS', false);
    expect(storedEntries()).toHaveLength(1);
    expect(urlLayout()).toBeTruthy();

    el.resetLayout();
    expect(storedEntries()).toHaveLength(0);
    expect(urlLayout()).toBeNull();
  });
});

describe('layout persistence — no-persist-layout opt-out', () => {
  it('neither restores nor writes when opted out', async () => {
    // Pre-seed both stores with a non-default layout.
    const el1 = await mountViewer();
    el1.setRowVisibility('DOMAINS', false);
    const seededKey = storedEntries()[0];
    expect(seededKey).toBeTruthy();

    // A viewer with the opt-out attribute ignores the seeded layout…
    const el2 = await mountViewer({ noPersistLayout: true });
    expect(el2.getLayout()).toEqual({
      order: null,
      tracks: {},
      hidden: { rows: {}, tracks: {} },
    });

    // …and does not write when the user changes the layout.
    const before = localStorage.getItem(seededKey);
    el2.setRowVisibility('sites', false);
    expect(localStorage.getItem(seededKey)).toBe(before);
    expect(el2.getLayout().hidden).toEqual({
      rows: { sites: true },
      tracks: {},
    }); // in-memory only
  });
});

// The config is the source of truth: an arranged view has to round-trip out
// through getConfig() (mounted through the real load pipeline, so the authored
// source is retained) and back through setConfig().
describe('getConfig / setConfig — config as source of truth', () => {
  it('getConfig() returns the arranged config after a runtime edit', async () => {
    const el = await mountViewer();
    el.setRowOrder(['sites', 'DOMAINS']);
    el.setRowVisibility('DOMAINS', false);

    const cfg = el.getConfig();
    expect(cfg).toBeDefined();
    expect(cfg!.rows.map((r) => r.id)).toEqual(['sites', 'DOMAINS']);
    expect(cfg!.rows.find((r) => r.id === 'DOMAINS')!.hidden).toBe(true);
    expect(cfg!.rows.find((r) => r.id === 'sites')!.hidden).toBeUndefined();
  });

  it('setConfig() swaps the configuration and resolves', async () => {
    const el = await mountViewer();
    await el.setConfig({
      rows: [
        {
          id: 'only',
          label: 'Only',
          kind: 'features',
          data: 'https://example.org/d.json',
        },
      ],
    });
    await vi.waitFor(() => {
      if (!el.querySelector(`.${CSS_PREFIX}-customize-toggle`)) {
        throw new Error('not ready');
      }
    });
    expect(el.getConfig()!.rows.map((r) => r.id)).toEqual(['only']);
  });
});

// Private-mode / quota: every localStorage access is wrapped so a throwing
// Storage degrades gracefully instead of breaking an edit or the mount.
describe('layout persistence — localStorage failures', () => {
  it('still mirrors the layout to the URL when setItem throws', async () => {
    const el = await mountViewer();
    const realSetItem = Storage.prototype.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
      if (k.startsWith(STORAGE_PREFIX)) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      realSetItem(k, v);
    });

    // The edit must not throw, must write nothing to storage, yet must still
    // update the shareable URL.
    expect(() => el.setRowVisibility('DOMAINS', false)).not.toThrow();
    expect(storedEntries()).toHaveLength(0);
    expect(urlLayout()).toBeTruthy();
  });

  it('falls back to the authored default when getItem throws on mount', async () => {
    const realGetItem = Storage.prototype.getItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => {
      if (k.startsWith(STORAGE_PREFIX)) {
        throw new DOMException('access denied', 'SecurityError');
      }
      return realGetItem(k);
    });

    // Mount must complete and land on the authored default rather than erroring.
    const el = await mountViewer();
    expect(el.getLayout()).toEqual({
      order: null,
      tracks: {},
      hidden: { rows: {}, tracks: {} },
    });
  });
});
