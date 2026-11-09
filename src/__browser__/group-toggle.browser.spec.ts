/**
 * Real-DOM accessibility + interaction coverage for the group
 * expand/collapse toggle on `<protvista-uniprot>` — the current proxy for
 * the not-yet-built track show/hide UI (issue #199).
 *
 * The toggle is a native `<button>` with a live `aria-expanded`. It does not
 * wrap the label's links, the ⚠ badge or Retry (issue #417), so axe's
 * `nested-interactive` rule passes. Enter, Space and a click still
 * expand and collapse the group.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { mount, unmountAll } from './mount.js';
import { expectNoA11yViolations } from './axe.js';

const TOGGLE = `.${CSS_PREFIX}-group-toggle[data-group-toggle="g"]`;

/** A valid config: one group with two feature tracks (collapsible). */
const CONFIG = {
  rows: [
    {
      id: 'g',
      label: 'Domains & sites',
      tracks: [
        { id: 't1', kind: 'features', data: 'https://example.org/a.json' },
        { id: 't2', kind: 'features', data: 'https://example.org/b.json' },
      ],
    },
  ],
};

type El = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  openGroups: string[];
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'MSEQENCE' } }
        : // The default `features-json` adapter expects a top-level array.
          [{ type: 'DOMAIN', start: 1, end: 5 }];
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    })
  );
}

async function mountWithGroup(): Promise<{ el: El; toggle: HTMLElement }> {
  stubFetch();
  const el = mount<El>('protvista-uniprot', {
    viewerConfig: CONFIG,
    accession: 'P05067',
  });
  const toggle = await vi.waitFor(() => {
    const t = el.querySelector<HTMLElement>(TOGGLE);
    if (!t) throw new Error('group toggle not ready');
    return t;
  });
  return { el, toggle };
}

afterEach(() => {
  // Unmount before restoring `fetch`: hooks run last-registered-first,
  // so mount.js's own teardown would otherwise leave live components
  // able to reach the real network.
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('group toggle — accessibility semantics', () => {
  it('exposes button semantics with a collapsed initial state', async () => {
    const { toggle } = await mountWithGroup();
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Domains & sites');
    // The name is on the button. The visible text is not inside it, so a
    // link or a badge cannot nest there.
    expect(toggle.querySelector('a, button')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { el } = await mountWithGroup();
    await expectNoA11yViolations(el.querySelector(`#${CSS_PREFIX}-group_g`)!);
  });

  it('has no nested-interactive violation when a collapsed group carries a ⚠ badge', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/b.json')) {
          return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
        }
        const body = url.includes('/proteins/api/proteins/')
          ? { sequence: { sequence: 'MSEQENCE' } }
          : [{ type: 'DOMAIN', start: 1, end: 5 }];
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      })
    );
    const el = mount<El>('protvista-uniprot', {
      viewerConfig: CONFIG,
      accession: 'P05067',
    });
    const group = await vi.waitFor(() => {
      const g = el.querySelector<HTMLElement>(`#${CSS_PREFIX}-group_g`);
      const toggle = g?.querySelector<HTMLElement>(TOGGLE);
      if (!toggle || !g.querySelector(`.${CSS_PREFIX}-error-badge`)) {
        throw new Error('badge not beside the toggle yet');
      }
      return g;
    });
    const toggle = group.querySelector(TOGGLE)!;
    expect(toggle.contains(group.querySelector(`.${CSS_PREFIX}-error-badge`))).toBe(false);
    expect(toggle.contains(group.querySelector(`.${CSS_PREFIX}-error-retry`))).toBe(false);
    await expectNoA11yViolations(group);
  });
});

describe('group toggle — keyboard operability', () => {
  it('Enter expands and Space collapses the group', async () => {
    const { el, toggle } = await mountWithGroup();

    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    // Enter expands.
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      if (!el.openGroups.includes('g')) throw new Error('not expanded');
    });
    expect(el.querySelector(TOGGLE)!.getAttribute('aria-expanded')).toBe('true');

    // Space collapses again.
    el.querySelector<HTMLElement>(TOGGLE)!.focus();
    await userEvent.keyboard(' ');
    await vi.waitFor(() => {
      if (el.openGroups.includes('g')) throw new Error('still expanded');
    });
    expect(el.querySelector(TOGGLE)!.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('group toggle — pointer parity', () => {
  it('a mouse click still toggles the group', async () => {
    const { el, toggle } = await mountWithGroup();
    expect(el.openGroups).not.toContain('g');

    await userEvent.click(toggle);
    await vi.waitFor(() => {
      if (!el.openGroups.includes('g')) throw new Error('not expanded');
    });
    expect(el.querySelector(TOGGLE)!.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('group toggle — controls inside the label', () => {
  afterEach(() => history.replaceState(null, '', location.pathname));

  it('lets Enter on a link in the label follow it, without toggling', async () => {
    stubFetch();
    const el = mount<El>('protvista-uniprot', {
      viewerConfig: {
        rows: [{ ...CONFIG.rows[0], label: 'Domains, see [the guide](#pv-guide)' }],
      },
      accession: 'P05067',
    });
    const link = await vi.waitFor(() => {
      const a = el.querySelector<HTMLAnchorElement>(`.${CSS_PREFIX}-group-label a`);
      if (!a) throw new Error('link not ready');
      return a;
    });
    const toggle = el.querySelector<HTMLElement>(TOGGLE)!;
    expect(toggle.contains(link)).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    link.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => expect(location.hash).toBe('#pv-guide'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.openGroups).not.toContain('g');

    // The link is painted above the collapse button, so a click follows it
    // and does not expand the group.
    history.replaceState(null, '', location.pathname);
    await userEvent.click(link);
    await vi.waitFor(() => expect(location.hash).toBe('#pv-guide'));
    expect(el.openGroups).not.toContain('g');
  });
});
