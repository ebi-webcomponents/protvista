/**
 * End-to-end coverage for layout persistence on `<protvista-uniprot>`:
 * localStorage round-trip (keyed per-config), the shareable `?layout=` URL
 * and its precedence over localStorage, the `no-persist-layout` opt-out, and
 * reset clearing both stores. A fresh mount of the element stands in for a
 * page reload — `_init()` runs `_restoreLayout()` on connect.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import '../protvista-uniprot';
import type { ViewerLayout } from '../schema/types';
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
  getLayout(): ViewerLayout;
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

/** Mount a viewer and wait until its config has loaded (toolbar present). */
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
  it('writes the overlay to localStorage and the ?layout= URL on change', async () => {
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
  it('restores a saved overlay on a fresh mount (from localStorage)', async () => {
    const el1 = await mountViewer();
    el1.setRowVisibility('DOMAINS', false);
    // Clear the URL so this exercises the localStorage path specifically.
    window.history.replaceState(window.history.state, '', originalHref);
    expect(urlLayout()).toBeNull();

    const el2 = await mountViewer();
    expect(el2.getLayout().hidden).toEqual({ DOMAINS: true });
  });

  it('lets the ?layout= URL win over localStorage', async () => {
    const el1 = await mountViewer();
    el1.setRowVisibility('DOMAINS', false); // localStorage: hidden DOMAINS

    // A different layout in the URL should take precedence.
    const urlToken = encodeLayout({ order: ['sites', 'DOMAINS'], hidden: {} });
    const url = new URL(originalHref);
    url.searchParams.set(LAYOUT_PARAM, urlToken);
    window.history.replaceState(window.history.state, '', url);

    const el2 = await mountViewer();
    expect(el2.getLayout()).toEqual({ order: ['sites', 'DOMAINS'], hidden: {} });
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
    expect(el2.getLayout()).toEqual({ order: null, hidden: {} });

    // …and does not write when the user changes the layout.
    const before = localStorage.getItem(seededKey);
    el2.setRowVisibility('sites', false);
    expect(localStorage.getItem(seededKey)).toBe(before);
    expect(el2.getLayout().hidden).toEqual({ sites: true }); // in-memory only
  });
});
