/**
 * Automated browser check (Chromium) of zoom, reflow, text spacing and
 * orientation for the WCAG audit (`docs/accessibility-audit.md`, issue
 * #382), on the playground page as it ships (`playground-astro-page.ts`)
 * with a real viewer in its preview: the Nightingale components are real
 * here, so the tracks, ruler and variant filter have their real sizes.
 *
 * Browser zoom is reproduced by the CSS viewport it leaves: 200% on a
 * 1280×720 window lays the page out at 640×360 CSS px, 200% on 1920×1080 at
 * 960×540, and 400% on 1280×1024 at 320×256 (WCAG 1.4.10's reference). Each
 * layout is checked after a fresh render (Run), as after a reload at that
 * zoom; what happens when the window narrows under a drawn viewer is a test
 * of its own. The track area itself (ruler, sequence, tracks) is
 * two-dimensional content, which 1.4.10 exempts, so it is left out of the
 * overflow and overlap checks; the labels and controls beside it are not.
 * The text Nightingale draws in SVG there (ruler numbers, sequence letters)
 * is checked on its own for being cut off or overlapping.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { page } from 'vitest/browser';

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
import { byId, closePlayground, openPlayground, preview } from './playground-page.js';
import { PAGE_CSS, PAGE_MARKUP, installPageStyles } from './playground-astro-page.js';
import {
  applyTextSpacing,
  deepElements,
  describeEl,
  layoutProblems,
  sidewaysScroll,
  svgTextProblems,
} from './a11y-checks.js';

/**
 * Its own sequence, a group with a long label, a skipped track (an ⓘ note),
 * and a variants track with the variant filter.
 */
const CONFIG = `sequence: MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV
rows:
  - id: lab
    label: Lab hits from the partner laboratory screen
    tracks:
      - id: a
        label: Domains
        kind: features
        data:
          from: inline
          format: csv
          inlineData: "type,start,end,description\\nDOMAIN,5,20,first domain"
      - id: b
        label: Regions
        kind: features
        data:
          from: inline
          format: csv
          inlineData: "type,start,end,description\\nREGION,25,34,a region"
  - id: partner
    label: Partner data
    kind: features
    data: https://example.org/{dataset}/hits.csv
  - id: vars
    label: Variants
    kind: variants
    data: https://example.org/variants.csv
    filterUI: nightingale-filter
`;
const VARIANTS = [
  'position,wildType,variant,description,consequence',
  '10,M,A,first,missense',
  '20,M,V,second,missense',
].join('\n');

let uninstall: () => void;

beforeAll(async () => {
  await page.viewport(1280, 720);
  uninstall = installPageStyles();
  await openPlayground({
    markup: PAGE_MARKUP,
    state: { config: CONFIG, accession: 'P05067' },
    respond: (url) => (url.endsWith('/variants.csv') ? new Response(VARIANTS) : undefined),
  });
  await drawn();
});

afterAll(async () => {
  closePlayground();
  uninstall();
  await page.viewport(1280, 720);
});

/** Wait until the preview's real ruler and variant filter have drawn. */
async function drawn(previous?: Element | null) {
  await vi.waitFor(
    () => {
      const viewer = preview();
      if (!viewer || viewer === previous) throw new Error('no new preview yet');
      if (!viewer.querySelector('nightingale-navigation svg .tick')) throw new Error('ruler not drawn');
      if (!viewer.querySelector('nightingale-filter input')) throw new Error('filter not drawn');
    },
    { timeout: 10000 }
  );
  await new Promise((r) => setTimeout(r, 300));
}

/** Resize the viewport and render the preview afresh at that size. */
async function layOut(width: number, height: number) {
  await page.viewport(width, height);
  const old = preview();
  byId('run').click();
  await drawn(old);
}

/**
 * The track area: two-dimensional content, exempt from reflow. Every track,
 * the ruler and the sequence sit in a `-track-content` cell. Not
 * `<nightingale-manager>`, which wraps the whole viewer (labels, controls
 * and the variant filter included), nor `<nightingale-filter>`, which sits
 * in the label column.
 */
const trackArea = (el: Element) => el.matches(`.${CSS_PREFIX}-track-content`);

/** Elements outside the track area that scroll sideways. */
const sidewaysScrollers = () =>
  deepElements(document)
    .filter((el) => {
      const cs = getComputedStyle(el);
      return (
        (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
        el.scrollWidth > el.clientWidth + 1 &&
        ![...el.children].some(() => false)
      );
    })
    .filter((el) => {
      // A box that scrolls only because the track area inside it is wider
      // than it is fine; anything else is not.
      const box = el.getBoundingClientRect();
      const wide = deepElements(el).filter(
        (child) => child.getClientRects().length && child.getBoundingClientRect().right > box.right + 1
      );
      return wide.some((child) => {
        for (let n: Element | null = child; n && n !== el; n = n.parentElement) if (trackArea(n)) return false;
        return true;
      });
    })
    .map(describeEl);

/** Every control a Tab can reach that is cut off or pushed off the page. */
const outOfReach = () => {
  const right = document.documentElement.scrollWidth + 1;
  return deepElements(document)
    .filter((el) => {
      const h = el as HTMLElement;
      return (
        h.tabIndex >= 0 &&
        !(h as HTMLButtonElement).disabled &&
        !el.closest('[hidden]') &&
        el.getClientRects().length > 0 &&
        !(el instanceof HTMLInputElement && el.type === 'file')
      );
    })
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 1 || r.height < 1 || r.left < -1 || r.right > right;
    })
    .map(describeEl);
};

/**
 * What runs out of the viewer's label column into the track area, where
 * the ruler and tracks paint over it: elements and text runs that end past
 * their label cell's right edge.
 */
const pastLabelColumn = () => {
  const out = new Set<string>();
  const cells = preview()!.querySelectorAll(
    `.${CSS_PREFIX}-group-label, .${CSS_PREFIX}-track-label, .${CSS_PREFIX}-nav-track-label`
  );
  for (const cell of cells) {
    if (!cell.getClientRects().length) continue;
    const edge = cell.getBoundingClientRect().right + 1;
    for (const el of deepElements(cell)) {
      if (el.closest('[hidden]') || !el.getClientRects().length) continue;
      if (el.matches('button, [role="button"]') && el.getBoundingClientRect().right > edge) {
        out.add(describeEl(el));
      }
    }
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent!.trim() || n.parentElement?.closest('[hidden]')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      if ([...range.getClientRects()].some((r) => r.width > 0 && r.right > edge)) {
        out.add(`text "${n.textContent!.trim().slice(0, 40)}"`);
      }
    }
  }
  return [...out];
};

const problems = () => layoutProblems([document.body], trackArea).map((p) => `${p.kind}: ${p.what}`);

/**
 * Text that Nightingale draws in SVG in the track area (the ruler's
 * numbers, the sequence's letters and numbers, the variant track's
 * amino-acid axis) that is cut off at its SVG's edge or overlaps other text.
 */
const trackText = () =>
  svgTextProblems([...preview()!.querySelectorAll(`.${CSS_PREFIX}-track-content`)]).map(
    (p) => `${p.kind}: ${p.what}`
  );

/**
 * `nightingale-variation-canvas` 5.11 right-aligns the letters of its left
 * amino-acid axis so close to its SVG's left edge that the widest letters
 * run past it and lose their first 1–4 px. This happens at 100%
 * as at 200% (it is in CSS px), and wider letter spacing cuts more letters.
 * Whether that loses content is for a person to judge (the audit's manual
 * pass "Variant axis letters"); every other cut or overlap fails.
 */
const AXIS_LETTER = /^clipped: nightingale-variation-canvas "[A-Z]"$/;

/** The ruler and sequence drew text, so {@link trackText} checked something. */
const drewTrackText = () => {
  const count = (sel: string) =>
    [...preview()!.querySelectorAll(`${sel} text`)].filter((t) => t.getClientRects().length).length;
  expect(count('nightingale-navigation')).toBeGreaterThan(0);
  expect(count('nightingale-sequence')).toBeGreaterThan(0);
};

describe('zoom to 200% (1.4.4)', () => {
  it.each([
    [640, 360, '1280×720'],
    [960, 540, '1920×1080'],
  ])('at %i×%i CSS px (%s at 200%%) no text is clipped or overlaps and every control is in reach', async (w, h) => {
    await layOut(w, h);
    expect(problems()).toEqual([]);
    drewTrackText();
    expect(trackText().filter((p) => !AXIS_LETTER.test(p))).toEqual([]);
    expect(pastLabelColumn()).toEqual([]);
    expect(outOfReach()).toEqual([]);
    expect(sidewaysScroll()).toBe(0);
    expect(sidewaysScrollers()).toEqual([]);
  });
});

describe('reflow at 320 CSS px (1.4.10)', () => {
  it('the page scrolls only vertically; only the track area may be wider', async () => {
    await layOut(320, 256);
    expect(sidewaysScroll()).toBe(0);
    expect(sidewaysScrollers()).toEqual([]);
    expect(problems()).toEqual([]);
    expect(outOfReach()).toEqual([]);
  });

  // Issue to file: R. The label column is `--protvista-label-width`, 20vw by
  // default: 64 px at 320 CSS px. The Customize button (about 90 px), the
  // variant filter, and any word longer than the column run past it, under
  // the ruler and tracks,
  // which paint over them. When the column has a usable minimum width or
  // its contents wrap inside it, expect an empty list here.
  it('the Customize button, the variant filter and long words run out of the 64 px label column (issue to file: R)', async () => {
    await layOut(320, 256);
    const column = preview()!.querySelector(`.${CSS_PREFIX}-nav-track-label`)!;
    expect(Math.round(column.getBoundingClientRect().width)).toBe(64);
    const past = pastLabelColumn();
    expect(past).toContain('button "Customize"');
    expect(past).toContainEqual(expect.stringMatching(/^text "Lab hits from the partner laboratory/));
    // So do the variant filter's headings and class names.
    expect(past).toContain('text "Likely pathogenic or pathogenic"');
    expect(past).toContain('text "Filter Consequence"');
    // Where the button runs past the column, the ruler is on top.
    const button = preview()!.querySelector<HTMLElement>(`.${CSS_PREFIX}-customize-toggle`)!;
    const b = button.getBoundingClientRect();
    const hit = document.elementFromPoint(b.right - 4, b.top + b.height / 2);
    expect(button.contains(hit)).toBe(false);
  });

  // Issue to file: Q. The viewer sizes its track area when it draws and does
  // not shrink it when its container narrows later, as browser zoom and a
  // narrowed window do: the ruler and tracks run past the right edge and the
  // preview scrolls sideways until the viewer is drawn again. Widening is
  // followed. The track area is exempt from 1.4.10, so this is not a
  // failure, but zooming in after the page loads hides the end of the
  // tracks. When the viewer follows its container, expect no overflow here.
  it('a viewer drawn wide keeps its track width when the window narrows (issue to file: Q)', async () => {
    await layOut(1280, 720);
    await page.viewport(320, 256);
    await new Promise((r) => setTimeout(r, 1500));
    const box = byId('preview');
    const nav = preview()!.querySelector('nightingale-navigation')!;
    expect(nav.getBoundingClientRect().right).toBeGreaterThan(box.getBoundingClientRect().right + 1);
    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth + 1);
    // Drawn again at this width, it fits.
    await layOut(320, 256);
    expect(nav.isConnected).toBe(false);
    const fresh = preview()!.querySelector('nightingale-navigation')!;
    expect(fresh.getBoundingClientRect().right).toBeLessThanOrEqual(byId('preview').getBoundingClientRect().right);
  });
});

describe('text spacing (1.4.12)', () => {
  it('with line height 1.5, paragraph spacing 2, letter 0.12 and word 0.16, nothing is clipped or overlaps', async () => {
    await page.viewport(1280, 720);
    const undo = applyTextSpacing();
    try {
      await layOut(1280, 720);
      // The viewer re-rendered: apply the spacing to any new shadow roots.
      undo();
      const again = applyTextSpacing();
      await new Promise((r) => setTimeout(r, 300));
      try {
        expect(problems()).toEqual([]);
        // The ruler numbers and sequence letters, with the spacing applied
        // (Chromium applies letter-spacing to SVG text).
        drewTrackText();
        const ruler = preview()!.querySelector('nightingale-navigation text')!;
        expect(getComputedStyle(ruler).letterSpacing).not.toBe('normal');
        expect(trackText().filter((p) => !AXIS_LETTER.test(p))).toEqual([]);
        expect(pastLabelColumn()).toEqual([]);
        expect(outOfReach()).toEqual([]);
        expect(sidewaysScroll()).toBe(0);
      } finally {
        again();
      }
    } finally {
      undo();
    }
  });
});

describe('SVG text in the tracks (1.4.4, 1.4.12)', () => {
  // Not a pinned failure: see AXIS_LETTER. When Nightingale keeps its axis
  // letters inside the SVG, expect an empty list here.
  it('the variant track cuts the left edge of its widest axis letters, at 100% too, and more with text spacing', async () => {
    /** The axis letters cut at the SVG's left edge, and by how much (px). */
    const axisCuts = () =>
      [...preview()!.querySelectorAll<SVGTextElement>('nightingale-variation-canvas text')]
        .filter((t) => /^[A-Z]$/.test(t.textContent!.trim()) && t.getClientRects().length)
        .map((t) => ({
          letter: t.textContent!.trim(),
          px: t.ownerSVGElement!.getBoundingClientRect().left - t.getBoundingClientRect().left,
        }))
        .filter((c) => c.px > 1);
    await layOut(1280, 720);
    const cut = trackText();
    expect(cut.every((p) => AXIS_LETTER.test(p)), cut.join('\n')).toBe(true);
    const plain = axisCuts();
    expect(plain.map((c) => c.letter)).toEqual(expect.arrayContaining(['M', 'W']));
    const undo = applyTextSpacing();
    try {
      await layOut(1280, 720);
      undo();
      const again = applyTextSpacing();
      await new Promise((r) => setTimeout(r, 300));
      try {
        const spaced = axisCuts();
        expect(spaced.length).toBeGreaterThan(plain.length);
        // Never more than 4 px of any letter.
        expect(Math.max(...spaced.map((c) => c.px))).toBeLessThanOrEqual(4);
      } finally {
        again();
      }
    } finally {
      undo();
    }
  });
});

describe('orientation (1.3.4)', () => {
  it('works in portrait and in landscape, and nothing locks or depends on orientation', async () => {
    const lock = vi.fn(async () => undefined);
    if (screen.orientation) {
      Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: lock });
    }
    for (const [w, h] of [
      [360, 640],
      [640, 360],
    ]) {
      await layOut(w, h);
      expect(sidewaysScroll(), `${w}×${h}`).toBe(0);
      expect(problems(), `${w}×${h}`).toEqual([]);
      expect(outOfReach(), `${w}×${h}`).toEqual([]);
      const column = preview()!.querySelector(`.${CSS_PREFIX}-nav-track-label`)!;
      if (w < h) {
        // Issue to file: R, as at 320 px: the 20vw label column is 72 px
        // wide in portrait, and the Customize button runs out of it. That
        // is the width (1.4.10), not the orientation.
        expect(Math.round(column.getBoundingClientRect().width)).toBe(72);
        expect(pastLabelColumn()).toContain('button "Customize"');
      } else {
        expect(pastLabelColumn(), `${w}×${h}`).toEqual([]);
      }
    }
    expect(lock).not.toHaveBeenCalled();
    // No stylesheet on the page (the playground's, the viewer's and the
    // Nightingale components' own) has an orientation media query.
    const mediaTexts: string[] = [];
    const collect = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) mediaTexts.push(rule.conditionText);
        if ('cssRules' in rule) collect((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) collect(sheet.cssRules);
    for (const el of deepElements(document)) {
      for (const sheet of el.shadowRoot?.adoptedStyleSheets ?? []) collect(sheet.cssRules);
    }
    expect(mediaTexts.length).toBeGreaterThan(0);
    expect(mediaTexts.filter((t) => /orientation/.test(t))).toEqual([]);
    expect(PAGE_CSS).not.toMatch(/orientation/);
  });
});
