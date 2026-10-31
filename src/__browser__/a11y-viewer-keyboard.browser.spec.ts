/**
 * Automated browser check (Chromium) of the viewer for the WCAG audit
 * (`docs/accessibility-audit.md`, issue #382): keyboard order and traps,
 * focus visibility and obscuring, what focus and pointer presses do,
 * single-character keys, target sizes, and the reading order of the
 * accessibility tree Chromium builds.
 *
 * Unlike most browser specs, the Nightingale components the viewer draws
 * with are real here (manager, navigation, sequence, feature and variant
 * tracks, the variant filter), so their own tab stops are in the walk. The
 * 3D structure viewer (Mol*, WebGL) stays stubbed: its keyboard behaviour is
 * assessed from its code in the audit, not here.
 *
 * Where the viewer fails a criterion today, the test pins the current
 * behaviour and names the audit's issue letter, so CI stays green and a fix
 * shows up as a test to update.
 *
 * Network-free: a `sequence:` config with inline CSV, a variants file the
 * `fetch` stub answers, one URL that answers 500 (a ⚠ badge and Retry) and
 * one with an undefined variable, which is never fetched (an ⓘ note).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { page, userEvent } from 'vitest/browser';

// `vi.unmock` cannot lift a setup file's mock in browser mode, so each mock
// is replaced by the real module (as in `variants-colour.browser.spec.ts`).
vi.mock('@nightingale-elements/nightingale-manager', (real) => real());
vi.mock('@nightingale-elements/nightingale-navigation', (real) => real());
vi.mock('@nightingale-elements/nightingale-sequence', (real) => real());
vi.mock('@nightingale-elements/nightingale-track-canvas', (real) => real());
vi.mock('@nightingale-elements/nightingale-filter', (real) => real());
vi.mock('@nightingale-elements/nightingale-linegraph-track', (real) => real());
vi.mock(
  '@nightingale-elements/nightingale-variation-canvas',
  async (real) => ({
    ...(await real<object>()),
    AminoAcid: { Empty: '-' },
    ClinicalSignificance: {},
  })
);

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { track, unmountAll } from './mount.js';
import {
  PRINTABLE_KEYS,
  accessibilityTreeWith,
  deepActive,
  deepElements,
  deepContains,
  describeEl,
  focusIndicator,
  outline,
  partlyVisible,
  snapshotLooks,
  stateDiff,
  stateOf,
  tabWalk,
  targetSizes,
} from './a11y-checks.js';

const P = CSS_PREFIX;
const SEQUENCE = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV';
const VARIANTS = [
  'position,wildType,variant,description,consequence',
  '10,M,A,first,missense',
  '20,M,V,second,missense',
].join('\n');
const inline = (rows: string) => ({
  from: 'inline',
  format: 'csv',
  inlineData: `type,start,end,description\n${rows}`,
});

/**
 * Two feature groups (one with a failing track, so its header carries a ⚠
 * badge and Retry), a standalone track that is skipped (an ⓘ note in the top
 * bar), and a variants track with the variant filter.
 */
const CONFIG = {
  sequence: SEQUENCE,
  rows: [
    {
      id: 'lab',
      label: 'Lab hits',
      tracks: [
        { id: 'a', label: 'Domains', kind: 'features', data: inline('DOMAIN,5,20,first domain') },
        { id: 'b', label: 'Regions', kind: 'features', data: inline('REGION,25,34,a region') },
      ],
    },
    {
      id: 'broken',
      label: 'Partly broken',
      tracks: [
        { id: 'x', kind: 'features', data: 'https://example.org/fail.json' },
        { id: 'y', kind: 'features', data: inline('DOMAIN,1,4,small') },
      ],
    },
    {
      id: 'partner',
      label: 'Partner data',
      kind: 'features',
      data: 'https://example.org/{dataset}/hits.csv',
    },
    {
      id: 'vars',
      label: 'Variants',
      kind: 'variants',
      data: './variants.csv',
      filterUI: 'nightingale-filter',
    },
  ],
};

type Viewer = HTMLElement & {
  viewerConfig?: unknown;
  openGroups: string[];
  updateComplete: Promise<unknown>;
};

let viewer: Viewer;
let before: HTMLButtonElement;
let after: HTMLButtonElement;
let failedFetches = 0;

const q = <T extends Element = HTMLElement>(sel: string) =>
  viewer.querySelector<T>(sel)!;
const settle = async () => {
  await viewer.updateComplete;
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
};

beforeEach(async () => {
  await page.viewport(1280, 720);
  failedFetches = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/variants.csv')) return new Response(VARIANTS);
      if (url.includes('/fail.json')) {
        failedFetches += 1;
        return new Response('Server error', { status: 500 });
      }
      return new Response('Not Found', { status: 404 });
    })
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  before = track(Object.assign(document.createElement('button'), { textContent: 'Before the viewer' }));
  viewer = document.createElement('protvista-uniprot') as unknown as Viewer;
  viewer.viewerConfig = CONFIG;
  track(viewer);
  after = track(Object.assign(document.createElement('button'), { textContent: 'After the viewer' }));
  await vi.waitFor(
    () => {
      if (!viewer.querySelector('nightingale-filter input[type="checkbox"]')) {
        throw new Error('the variant filter has not rendered');
      }
      if (!viewer.querySelector(`.${P}-error-badge`)) throw new Error('no ⚠ badge yet');
      if (!viewer.querySelector(`.${P}-nav-track-label .${P}-note`)) throw new Error('no ⓘ yet');
      if (!viewer.querySelector('nightingale-navigation svg .tick')) {
        throw new Error('the ruler has not drawn');
      }
    },
    { timeout: 10000 }
  );
  await settle();
  // Nightingale keeps adding SVG elements (ruler ticks, sequence letters)
  // for a moment after its first paint. Wait until the count holds, so the
  // element count in `stateOf` compares like with like.
  let count = -1;
  await vi.waitFor(
    () => {
      const now = deepElements(viewer).length;
      if (now !== count) {
        count = now;
        throw new Error('still drawing');
      }
    },
    { timeout: 5000, interval: 250 }
  );
});

afterEach(async () => {
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await page.viewport(1280, 720);
});

/** The tab stops between the two sentinel buttons, described. */
const described = (stops: Element[]) =>
  stops
    .filter((s) => s !== before && s !== after)
    .map((s) => describeEl(s).replace(/#\S+?(?=[ [])/, ''));

/** The tab stops the viewer has today, in order (collapsed groups). */
const EXPECTED_STOPS = [
  /^button "Customize"$/,
  /^button "Notes about this view \(1\)"$/,
  /^div\[role=button\] "Lab hits"$/,
  /^div\[role=button\] "Partly broken/,
  /^button "Some tracks in this group failed to load"$/,
  /^button "Retry loading/,
  // nightingale-filter 5.11: each class is a focusable <label> and then its
  // checkbox, so every filter takes two Tab presses (#424).
  ...[
    'Likely pathogenic or pathogenic',
    'Predicted consequence',
    'Likely benign or benign',
    'Uncertain significance',
    'UniProt reviewed',
    'ClinVar',
    'Large scale studies',
  ].flatMap((name) => [
    new RegExp(`^label "${name}"$`),
    new RegExp(`^input "${name}"$`),
  ]),
];

/** Whether `b` comes after `a` in reading order on screen. */
function followsVisually(a: Element, b: Element): boolean {
  if (deepContains(a, b)) return true;
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  if (rb.top >= ra.bottom - 4) return true; // a later line
  const sameLine = rb.top < ra.bottom && ra.top < rb.bottom;
  return sameLine && rb.left >= ra.left - 1;
}

describe('viewer: keyboard order and traps (2.1.2, 2.4.3)', () => {
  it('Tab reaches every control once, in reading order, and leaves the viewer', async () => {
    const walk = await tabWalk(before, after);
    const names = described(walk.stops);
    expect(names.length, names.join('\n')).toBe(EXPECTED_STOPS.length);
    names.forEach((name, i) => expect(name).toMatch(EXPECTED_STOPS[i]));
    expect(walk.lost).toEqual([]);
    expect(new Set(walk.stops).size).toBe(walk.stops.length);

    const inner = walk.stops.slice(0, -1);
    const outOfOrder = inner
      .slice(1)
      .filter((el, i) => !followsVisually(inner[i], el))
      .map((el) => describeEl(el));
    expect(outOfOrder).toEqual([]);
  });

  it('Shift+Tab walks the same stops backwards and leaves the viewer', async () => {
    const forward = described((await tabWalk(before, after)).stops);
    const back = await tabWalk(after, before, { back: true });
    expect(described(back.stops)).toEqual([...forward].reverse());
    expect(back.lost).toEqual([]);
  });

  it('in Customize mode, Tab reaches every control and leaves the viewer', async () => {
    q(`.${P}-customize-toggle`).focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(q(`.${P}-customize-toggle`).getAttribute('aria-pressed')).toBe('true');
    const looks = snapshotLooks([viewer]);
    const noRing: string[] = [];
    const hidden: string[] = [];
    const walk = await tabWalk(before, after, {
      max: 200,
      each: (el) => {
        if (el === after) return;
        if (!focusIndicator(el, looks)) noRing.push(describeEl(el));
        if (!partlyVisible(el)) hidden.push(describeEl(el));
      },
    });
    expect(walk.lost).toEqual([]);
    expect(hidden).toEqual([]);
    const stops = walk.stops.filter((s) => s !== after);
    // Every control Customize mode shows is reached: each enabled, drawn
    // element in the viewer that takes Tab focus. A disabled control (the
    // first row's "Move up", Reset before any change, the switch of a track
    // with no data) is rightly not a stop.
    const focusable = deepElements(viewer).filter((el) => {
      const h = el as HTMLElement & { disabled?: boolean };
      return h.tabIndex >= 0 && !h.disabled && !el.closest('[hidden]') && el.getClientRects().length > 0;
    });
    const missed = focusable.filter((el) => !stops.includes(el)).map(describeEl);
    expect(missed).toEqual([]);
    // Each kind of Customize control is among them.
    const kinds = {
      switch: '[role="switch"]',
      move: `.${P}-row-control--move`,
      collapse: `.${P}-row-collapse`,
      done: `.${P}-customize-action`,
    };
    for (const [kind, selector] of Object.entries(kinds)) {
      expect(
        stops.some((el) => el.matches(selector)),
        `${kind}: ${stops.map(describeEl).join('\n')}`
      ).toBe(true);
    }
    // Only the variant filter's labels (#424).
    expect(noRing.filter((n) => !n.startsWith('label "'))).toEqual([]);
  });

  it('Tab leaves an open ⓘ note, closing it, and Escape returns focus to its button', async () => {
    const note = q(`.${P}-nav-track-label .${P}-note`);
    note.focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    const popover = viewer.querySelector<HTMLElement>(`#${note.id}-pop`)!;
    expect(popover.hidden).toBe(false);
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(popover.hidden).toBe(true);
    expect(document.activeElement).toBe(note);

    await userEvent.keyboard('{Enter}');
    await settle();
    expect(popover.hidden).toBe(false);
    await userEvent.keyboard('{Tab}');
    await settle();
    expect(popover.hidden).toBe(true);
    expect(deepContains(viewer, document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(note);
  });

  it('the feature tooltip takes focus on a click; Tab moves on, Escape drops focus to the page (#416)', async () => {
    q(`.${P}-group-label[data-group-toggle="lab"]`).click();
    await settle();
    const canvas = await domainsTrack();
    await clickFeature(canvas, 12);
    const tooltip = await vi.waitFor(() => {
      const t = viewer.querySelector<HTMLElement>('[role="tooltip"]');
      if (!t || t.hidden) throw new Error('no tooltip');
      return t;
    });
    expect(document.activeElement).toBe(tooltip);
    expect(tooltip.textContent).toContain('first domain');
    await userEvent.keyboard('{Tab}');
    expect(tooltip.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).not.toBe(document.body);

    await clickFeature(canvas, 12);
    await vi.waitFor(() => expect(tooltip.hidden).toBe(false));
    await userEvent.keyboard('{Escape}');
    expect(tooltip.hidden).toBe(true);
    // Issue #416. Escape closes the tooltip but hands focus back to
    // nothing: it was opened by a click on a canvas, which takes no focus,
    // and `popover.ts` does not restore focus to the page body, so focus
    // falls there when the tooltip hides. The next Tab starts again at the
    // viewer's first control, not near the feature. When the tooltip returns
    // focus to the feature or its track, expect that here.
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard('{Tab}');
    expect(describeEl(deepActive())).toBe('button "Customize"');
  });
});

/**
 * A locator for `el`. Vitest cannot build a selector for some of the
 * viewer's elements (the group header among them), so tag the element.
 */
let testIds = 0;
function byTestId(el: Element) {
  if (!el.getAttribute('data-testid')) {
    el.setAttribute('data-testid', `a11y-${(testIds += 1)}`);
  }
  return page.getByTestId(el.getAttribute('data-testid')!);
}

type TrackCanvas = HTMLElement & { getXFromSeqPosition(n: number): number };

/**
 * The expanded "Lab hits" group's Domains track (`lab` › `a`), once it is
 * drawn with its features laid out. Not the first canvas in the viewer:
 * that is the group's collapsed (aggregate) track, which expanding hides.
 */
async function domainsTrack(): Promise<TrackCanvas> {
  return vi.waitFor(() => {
    const c = viewer.querySelector<TrackCanvas>('nightingale-track-canvas[id$="lab-a"]');
    const ready =
      c?.getXFromSeqPosition &&
      c.getClientRects().length > 0 &&
      (c as unknown as { fragmentCollection?: unknown }).fragmentCollection;
    if (!ready) {
      const ids = [...viewer.querySelectorAll('nightingale-track-canvas')].map((t) => t.id);
      throw new Error(`the Domains track is not ready (${ids.join(', ')})`);
    }
    return c;
  });
}

/** Click residue `at` of a real feature track, as a visitor would. */
async function clickFeature(
  canvas: HTMLElement & { getXFromSeqPosition(n: number): number },
  at: number
) {
  // Rest the pointer on the feature until the track reports it under the
  // pointer: on a fresh page the track can take a moment to place its
  // features where `getXFromSeqPosition` says.
  let nudge = 0;
  const position = await vi.waitFor(
    async () => {
      const box = canvas.getBoundingClientRect();
      const at_ = {
        x: Math.round(canvas.getXFromSeqPosition(at + 0.5)) + (nudge++ % 2),
        y: Math.round(box.height / 2),
      };
      let over = false;
      const seen = (e: Event) => {
        const d = (e as CustomEvent<{ eventType?: string; feature?: unknown }>).detail;
        if (d?.feature && d.eventType !== 'mouseout') over = true;
      };
      canvas.addEventListener('change', seen);
      await userEvent.hover(canvas, { position: at_ });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      canvas.removeEventListener('change', seen);
      if (!over) throw new Error(`no feature under the pointer at residue ${at}`);
      return at_;
    },
    { timeout: 5000, interval: 100 }
  );
  await userEvent.click(canvas, { position });
}

describe('viewer: focus visible and not obscured (2.4.7, 2.4.11)', () => {
  it('every stop but the variant filter labels shows focus (#424)', async () => {
    const looks = snapshotLooks([viewer]);
    const rings: string[] = [];
    const none: string[] = [];
    await tabWalk(before, after, {
      each: (el) => {
        if (el === after) return;
        const how = focusIndicator(el, looks);
        (how ? rings : none).push(describeEl(el));
      },
    });
    expect(rings.length).toBeGreaterThan(0);
    // nightingale-filter 5.11 sets `outline: none` on its focusable labels.
    expect(none).toEqual([
      'label "Likely pathogenic or pathogenic"',
      'label "Predicted consequence"',
      'label "Likely benign or benign"',
      'label "Uncertain significance"',
      'label "UniProt reviewed"',
      'label "ClinVar"',
      'label "Large scale studies"',
    ]);
  });

  it('focus is never entirely hidden in a short window, and an open note closes before it could cover the next stop', async () => {
    await page.viewport(1280, 400);
    await settle();
    const hidden: string[] = [];
    await tabWalk(before, after, {
      each: (el) => {
        if (!partlyVisible(el)) hidden.push(describeEl(el));
      },
    });
    expect(hidden).toEqual([]);

    // A note opens over the controls below its button. While it is open,
    // its button (which has focus) shows; Tab on from it closes it (focus
    // leaving the note closes it, `_onNoteFocusOut`), so the next stop is
    // never drawn under it. The note's own placement over other controls
    // is not what is measured here: it can never be over the focused one.
    const note = q(`.${P}-nav-track-label .${P}-note`);
    note.focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    const popover = viewer.querySelector<HTMLElement>(`#${note.id}-pop`)!;
    expect(popover.hidden).toBe(false);
    expect(partlyVisible(note)).toBe(true);
    await userEvent.keyboard('{Tab}');
    await settle();
    expect(document.activeElement).not.toBe(note);
    expect(popover.hidden).toBe(true);
    expect(partlyVisible(document.activeElement!)).toBe(true);
  });
});

describe('viewer: focus and input change nothing by themselves (3.2.1)', () => {
  it('moving focus through every control opens, toggles and moves nothing', async () => {
    const start = stateOf([viewer]);
    const changes: string[] = [];
    await tabWalk(before, after, {
      each: (el) => {
        const diff = stateDiff(start, stateOf([viewer]));
        if (diff.length) changes.push(`${describeEl(el)}: ${diff.join('; ')}`);
      },
    });
    await tabWalk(after, before, { back: true });
    expect(changes).toEqual([]);
    expect(stateOf([viewer])).toBe(start);
  });
});

describe('viewer: single-character keys (2.1.4)', () => {
  // About 600 key presses over the DevTools protocol: slow in CI, which runs
  // this under coverage beside the unit suite.
  it('no printable key does anything, on any control or on the page', async () => {
    const start = stateOf([viewer]);
    const changed: string[] = [];
    const targets: (HTMLElement | null)[] = [
      null, // focus on <body>
      q(`.${P}-customize-toggle`),
      q(`.${P}-group-label[data-group-toggle="lab"]`),
      q(`.${P}-nav-track-label .${P}-note`),
      q(`.${P}-error-badge`),
      q('nightingale-filter label'),
    ];
    for (const target of targets) {
      if (target) target.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
      // The pointer rests over the tracks, where a canvas listening for keys
      // would take them. (The Mol* 3D view is stubbed in this file: its
      // single-key shortcuts are assessed from its code, issue #431.)
      await userEvent.hover(q('nightingale-navigation'));
      await userEvent.keyboard(PRINTABLE_KEYS);
      await settle();
      const diff = stateDiff(start, stateOf([viewer]));
      if (diff.length) changed.push(`${describeEl(target)}: ${diff.join('; ')}`);
    }
    expect(changed).toEqual([]);
  }, 60_000);
});

describe('viewer: pointer cancellation (2.5.2)', () => {
  /**
   * Press on `el`, move off it and release on the sentinel button: nothing
   * may change. Then a plain click must change something, so the check is
   * not vacuous.
   */
  async function pressAndMoveOff(el: HTMLElement, position?: { x: number; y: number }) {
    const start = stateOf([viewer]);
    const fetches = failedFetches;
    await userEvent.dragAndDrop(byTestId(el), byTestId(after), position ? { sourcePosition: position } : {});
    await settle();
    expect(stateDiff(start, stateOf([viewer])), describeEl(el)).toEqual([]);
    expect(failedFetches).toBe(fetches);
  }

  // Five press-drag-release and click rounds, then a retried fetch: slow in
  // CI, which runs this under coverage beside the unit suite.
  it('releasing off a control does not activate it; a click does', async () => {
    // Selectors, not elements: a re-render can replace a control.
    const controls = [
      `.${P}-customize-toggle`,
      `.${P}-nav-track-label .${P}-note`,
      `.${P}-group-label[data-group-toggle="lab"]`,
      `.${P}-error-badge`,
      'nightingale-filter input[type="checkbox"]',
    ];
    for (const selector of controls) {
      await pressAndMoveOff(q(selector));
      const start = stateOf([viewer]);
      await userEvent.click(q(selector));
      await settle();
      expect(stateOf([viewer]), `a click on ${selector}`).not.toBe(start);
      // Undo, so the next control starts from the same state.
      if (viewer.querySelector(`[id$="-pop"]:not([hidden])`)) {
        await userEvent.keyboard('{Escape}');
      } else {
        await userEvent.click(q(selector));
      }
      await settle();
    }

    const retry = q(`.${P}-error-retry`);
    await pressAndMoveOff(retry);
    const fetches = failedFetches;
    await userEvent.click(retry);
    await vi.waitFor(() => expect(failedFetches).toBeGreaterThan(fetches));
  }, 60_000);

  it('pressing on a feature and releasing off it opens no tooltip; a click does', async () => {
    q(`.${P}-group-label[data-group-toggle="lab"]`).click();
    await settle();
    const canvas = await domainsTrack();
    const box = canvas.getBoundingClientRect();
    await userEvent.dragAndDrop(byTestId(canvas), byTestId(after), {
      sourcePosition: { x: Math.round(canvas.getXFromSeqPosition(12.5)), y: Math.round(box.height / 2) },
    });
    await settle();
    const tooltip = viewer.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.hidden).toBe(true);
    await clickFeature(canvas, 12);
    await vi.waitFor(() => expect(tooltip.hidden).toBe(false));
  });

  // Issue #430. An open ⓘ/⚠ popover closes on the *down* event of a
  // press anywhere else (`_onNoteOutside`, a capture `pointerdown` listener),
  // so pressing outside and moving off before releasing still closes it.
  // When it closes on `click` instead, flip the last expectation.
  it('an open note closes on the press itself, not on release (#430)', async () => {
    const note = q(`.${P}-nav-track-label .${P}-note`);
    await userEvent.click(note);
    await settle();
    const popover = viewer.querySelector<HTMLElement>(`#${note.id}-pop`)!;
    expect(popover.hidden).toBe(false);
    const customize = q(`.${P}-customize-toggle`);
    await userEvent.dragAndDrop(byTestId(customize), byTestId(after));
    await settle();
    expect(customize.getAttribute('aria-pressed')).toBe('false');
    expect(popover.hidden).toBe(true);
  });
});

describe('viewer: target size (2.5.8)', () => {
  it('every control is at least 24×24 px or has 24 px of clear space', async () => {
    const targets = [
      q(`.${P}-customize-toggle`),
      q(`.${P}-nav-track-label .${P}-note`),
      q(`.${P}-group-label[data-group-toggle="lab"]`),
      q(`.${P}-group-label[data-group-toggle="broken"]`),
      q(`.${P}-error-badge`),
      q(`.${P}-error-retry`),
      ...viewer.querySelectorAll<HTMLElement>('nightingale-filter input[type="checkbox"]'),
      // Each filter's <label> is a tab stop of its own (#424).
      ...viewer.querySelectorAll<HTMLElement>('nightingale-filter label'),
    ];
    const sizes = targetSizes(targets);
    const failing = sizes.filter((s) => !s.big && !s.spaced);
    expect(failing).toEqual([]);
    // The variant filter's checkboxes are the browser's 13 px default, and
    // pass only by spacing: their rows are 24 px apart.
    const boxes = sizes.filter((s) => s.what.startsWith('input'));
    expect(boxes.every((s) => !s.big && s.spaced)).toBe(true);
  });

  it('in Customize mode, every control is at least 24×24 px or has 24 px of clear space', async () => {
    q(`.${P}-customize-toggle`).focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    const targets = deepElements(viewer).filter((el) => {
      const h = el as HTMLElement & { disabled?: boolean };
      return (
        (h.tabIndex >= 0 || el.matches('button')) &&
        !el.closest('[hidden]') &&
        !el.closest('nightingale-filter') &&
        el.getClientRects().length > 0
      );
    });
    const sizes = targetSizes(targets);
    const failing = sizes.filter((s) => !s.big && !s.spaced);
    expect(failing).toEqual([]);
    // The Customize controls were measured: Show switches, move and
    // collapse buttons, and Done.
    for (const selector of ['[role="switch"]', `.${P}-row-control--move`, `.${P}-row-collapse`, `.${P}-customize-action`]) {
      expect(targets.some((el) => el.matches(selector)), selector).toBe(true);
    }
  });
});

describe('viewer: reading order in the accessibility tree (1.3.2)', () => {
  it('reads the top bar, then each group header before its controls, then the filter', async () => {
    const expected = [
      /^button "Before the viewer"$/,
      /^button "Customize"$/,
      /^button "Notes about this view \(1\)"$/,
      /^button "Lab hits"$/,
      /^button "Partly broken/,
      /^heading "Filter Consequence"$/,
      /^checkbox "Likely pathogenic or pathogenic"$/,
      /^heading "Filter Provenance"$/,
      /^button "After the viewer"$/,
    ];
    const lines = outline(
      await accessibilityTreeWith((tree) => {
        const read = outline(tree);
        return expected.every((re) => read.some((l) => re.test(l)));
      })
    );
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    const order = expected.map(at);
    expect(order.every((i) => i >= 0), lines.join('\n')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The ⚠ badge and Retry sit inside the "Partly broken" button
    // (`nested-interactive`, issue #417), so they come straight after it.
    const broken = at(/^button "Partly broken/);
    expect(lines[broken + 1]).toMatch(/^button "Some tracks in this group failed to load"$/);
    expect(lines[broken + 2]).toMatch(/^button "Retry loading/);
    // Track contents are not in the tree at all (#416).
    expect(lines.some((l) => /first domain|a region/.test(l))).toBe(false);
  });

  it('an opened note is read straight after its button', async () => {
    const note = q(`.${P}-nav-track-label .${P}-note`);
    await userEvent.click(note);
    await settle();
    const tree = await accessibilityTreeWith((t) => t.some((n) => n.name.includes('Partner data')));
    const i = tree.findIndex((n) => n.role === 'button' && /^Notes about this view/.test(n.name));
    const next = tree.slice(i + 1).find((n) => n.role !== 'StaticText' && n.role !== 'generic');
    expect(next, tree.slice(i, i + 6).map((n) => `${n.role} ${n.name}`).join('\n')).toBeDefined();
    const text = tree
      .slice(i + 1, i + 8)
      .map((n) => n.name)
      .join(' ');
    expect(text).toContain('Partner data');
  });
});
