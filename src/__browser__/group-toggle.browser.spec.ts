/**
 * Real-DOM accessibility + interaction coverage for the group
 * expand/collapse toggle on `<protvista-uniprot>` — the current proxy for
 * the not-yet-built track show/hide UI (issue #199).
 *
 * The toggle used to be a bare `<div @click>`: operable by mouse only.
 * This spec pins the accessibility fix — `role="button"`, `tabindex="0"`,
 * a live `aria-expanded`, and Enter/Space keyboard operation — so it
 * can't regress, and checks axe is clean over the group.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../protvista-uniprot';
import { CSS_PREFIX } from '../styles/css-prefix';
import { mount } from './mount';
import { expectNoA11yViolations } from './axe';

const TOGGLE = `.${CSS_PREFIX}-group-label[data-group-toggle="g"]`;

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('group toggle — accessibility semantics', () => {
  it('exposes button semantics with a collapsed initial state', async () => {
    const { toggle } = await mountWithGroup();
    expect(toggle.getAttribute('role')).toBe('button');
    expect(toggle.getAttribute('tabindex')).toBe('0');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('has no axe violations', async () => {
    const { el } = await mountWithGroup();
    await expectNoA11yViolations(el.querySelector(`#${CSS_PREFIX}-group_g`)!);
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
