/**
 * Shared checks for the automated keyboard, zoom/reflow and
 * accessibility-tree pass of the WCAG audit (issue #382,
 * `docs/accessibility-audit.md`). They run in real Chromium (the `browser`
 * Vitest project) and stand in for the parts of the manual passes a script can
 * settle: what a Tab press reaches, whether focus shows and is covered, what
 * focusing or changing a control does, how the page lays out at 200% zoom,
 * at 320 CSS px and with WCAG text spacing, and the accessibility tree that
 * Chromium builds. They are not a screen-reader test: what a screen reader
 * announces still needs a person.
 */
import { cdp, userEvent } from 'vitest/browser';

// ───────────────────────────── elements ─────────────────────────────

/** The focused element, looking through open shadow roots. */
export function deepActive(): Element | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/** Parent across a shadow boundary (a shadow root's host). */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Whether `outer` contains `inner`, across shadow boundaries. */
export function deepContains(outer: Element, inner: Element | null): boolean {
  for (let el = inner; el; el = parentOf(el)) if (el === outer) return true;
  return false;
}

/** Every element under `root`, in document order, including shadow trees. */
export function deepElements(root: Element | Document): Element[] {
  const out: Element[] = [];
  const visit = (node: Element | Document | ShadowRoot) => {
    for (const child of node.children) {
      out.push(child);
      if (child.shadowRoot) visit(child.shadowRoot);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** A short, readable description: `button.pv-note "Notes about this view"`. */
export function describeEl(el: Element | null): string {
  if (!el) return '(nothing)';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const role = el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '';
  const label =
    el instanceof HTMLInputElement || el instanceof HTMLSelectElement
      ? [...(el.labels ?? [])].map((l) => l.textContent).join(' ')
      : '';
  const name = (el.getAttribute('aria-label') || label || el.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return `${tag}${id}${role}${name ? ` "${name}"` : ''}`;
}

// ───────────────────────────── keyboard ─────────────────────────────

export interface TabWalk {
  /** Every element focus landed on, in order, ending with `until`. */
  stops: Element[];
  /** Steps after which focus was on `<body>` or on nothing. */
  lost: number[];
}

/**
 * Focus `from`, then press Tab (Shift+Tab with `back`) until focus reaches
 * `until`. Throws if it has not after `max` presses: focus is trapped or
 * cycles. Calls `each` after every press, with focus on the new stop.
 */
export async function tabWalk(
  from: HTMLElement,
  until: Element,
  options: {
    back?: boolean;
    max?: number;
    each?: (el: Element, step: number) => void | Promise<void>;
  } = {}
): Promise<TabWalk> {
  const { back = false, max = 120, each } = options;
  from.focus();
  const stops: Element[] = [];
  const lost: number[] = [];
  for (let step = 1; step <= max; step++) {
    await userEvent.keyboard(back ? '{Shift>}{Tab}{/Shift}' : '{Tab}');
    // Let focus styles that are set from script land (CodeMirror adds
    // `cm-focused`, which draws its ring, on the next frame).
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = deepActive();
    if (!el || el === document.body || el === document.documentElement) {
      lost.push(step);
      continue;
    }
    stops.push(el);
    await each?.(el, step);
    if (el === until) return { stops, lost };
  }
  throw new Error(
    `Tab did not reach ${describeEl(until)} in ${max} presses; last stops:\n` +
      stops.slice(-8).map(describeEl).join('\n')
  );
}

// ─────────────────────────── focus visible ───────────────────────────

const LOOK = [
  'outline-style',
  'outline-width',
  'outline-color',
  'box-shadow',
  'background-color',
  'border-top-color',
  'border-bottom-color',
  'text-decoration-line',
] as const;

type Look = Record<(typeof LOOK)[number], string>;

function lookOf(el: Element): Look {
  const cs = getComputedStyle(el);
  return Object.fromEntries(LOOK.map((p) => [p, cs.getPropertyValue(p)])) as Look;
}

/**
 * How each element under `roots` looks now, for {@link focusIndicator}. Take
 * it while focus is outside them.
 */
export function snapshotLooks(roots: (Element | Document)[]): Map<Element, Look> {
  const map = new Map<Element, Look>();
  for (const root of roots) {
    for (const el of deepElements(root)) map.set(el, lookOf(el));
  }
  return map;
}

const transparent = (color: string) =>
  /^rgba\(.*,\s*0\)$/.test(color) || color === 'transparent';

/**
 * What shows that `el` has focus, or `null` if nothing does: a visible
 * outline on it, or a change of outline, shadow, background, border or
 * underline on it or one of its two nearest ancestors (CodeMirror draws its
 * ring on the editor around the focused content element) since `before`.
 */
export function focusIndicator(
  el: Element,
  before: Map<Element, Look>
): string | null {
  const now = lookOf(el);
  if (
    now['outline-style'] !== 'none' &&
    parseFloat(now['outline-width']) > 0 &&
    !transparent(now['outline-color'])
  ) {
    return `outline ${now['outline-style']} ${now['outline-width']}`;
  }
  for (let node: Element | null = el, up = 0; node && up < 3; up++) {
    const was = before.get(node);
    const is = lookOf(node);
    if (was) {
      for (const p of LOOK) {
        if (was[p] !== is[p] && !(p === 'outline-style' && is[p] === 'none')) {
          return `${p} changes${up ? ` on ancestor ${up}` : ''}`;
        }
      }
    }
    node = parentOf(node);
  }
  return null;
}

// ─────────────────────────── focus obscured ───────────────────────────

/** The topmost element at a viewport point, looking into shadow roots. */
function deepHit(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

/**
 * Whether `el` is at least partly visible: on screen, and on top somewhere
 * in its box, sampled every 2 px down three columns (2.4.11 fails only when
 * focus is *entirely* hidden). A hit on a descendant, or on the `<label>`
 * that wraps it, counts.
 */
export function partlyVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const left = Math.max(r.left, 0);
  const right = Math.min(r.right, innerWidth);
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, innerHeight);
  if (right - left < 1 || bottom - top < 1) return false;
  const ys: number[] = [];
  for (let y = top + 0.5; y < bottom; y += 2) ys.push(y);
  for (const fx of [0.15, 0.5, 0.85]) {
    for (const y of ys) {
      const hit = deepHit(left + (right - left) * fx, y);
      if (!hit) continue;
      if (deepContains(el, hit)) return true;
      if (hit.tagName === 'LABEL' && deepContains(hit, el)) return true;
    }
  }
  return false;
}

// ─────────────────────────── state (3.2.1, 3.2.2) ───────────────────────────

const STATE_ATTRS = [
  'aria-expanded',
  'aria-pressed',
  'aria-selected',
  'aria-checked',
  'hidden',
  'open',
];

/**
 * A summary of everything a control could open, toggle or move: the URL,
 * the open/expanded/pressed/selected/hidden state of every element that
 * carries one, form values, and how many elements there are. Two equal
 * summaries mean nothing opened, closed, submitted or navigated in between.
 */
export function stateOf(roots: (Element | Document)[]): string {
  const parts: string[] = [location.href];
  for (const root of roots) {
    const all = deepElements(root);
    parts.push(`elements:${all.length}`);
    all.forEach((el, i) => {
      const attrs = STATE_ATTRS.filter((a) => el.hasAttribute(a)).map(
        (a) => `${a}=${el.getAttribute(a)}`
      );
      if (el instanceof HTMLInputElement) {
        attrs.push(`value=${el.value}`, `checked=${el.checked}`);
      } else if (el instanceof HTMLSelectElement) {
        attrs.push(`value=${el.value}`);
      }
      if (attrs.length) parts.push(`${i}:${el.tagName}:${attrs.join(',')}`);
    });
  }
  return parts.join('\n');
}

/** The lines of `after` that differ from `before`, for a readable failure. */
export function stateDiff(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push(`${a[i] ?? '(none)'}  →  ${b[i] ?? '(none)'}`);
  }
  return out;
}

// ─────────────────────────── accessibility tree ───────────────────────────

export interface AxNode {
  role: string;
  name: string;
  depth: number;
  backendId?: number;
}

interface RawAxNode {
  nodeId: string;
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

interface FrameTree {
  frame: { id: string; url: string };
  childFrames?: FrameTree[];
}

/**
 * The accessibility tree Chromium builds for this test's frame, read over
 * the DevTools protocol (`Accessibility.getFullAXTree`), flattened in tree
 * order: the order a screen reader's browse mode reads. Ignored nodes are
 * skipped but their children kept; text runs (`InlineTextBox`) are dropped.
 */
export async function accessibilityTree(): Promise<AxNode[]> {
  // `CDPSession` is typed by the Playwright provider's augmentation, which
  // this project's types do not load; `send` is all this needs.
  const session = cdp() as unknown as {
    send(method: string, params?: object): Promise<unknown>;
  };
  const { frameTree } = (await session.send('Page.getFrameTree')) as {
    frameTree: FrameTree;
  };
  // The playground rewrites the hash, which the frame tree may not show yet.
  const here = location.href.split('#')[0];
  const find = (t: FrameTree): FrameTree | undefined =>
    t.frame.url.split('#')[0] === here
      ? t
      : t.childFrames?.map(find).find(Boolean);
  const frame = find(frameTree);
  if (!frame) throw new Error('test frame not found in the frame tree');
  const { nodes } = (await session.send('Accessibility.getFullAXTree', {
    frameId: frame.frame.id,
  })) as { nodes: RawAxNode[] };
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId || !byId.has(n.parentId));
  if (!root) throw new Error('no root in the accessibility tree');
  const out: AxNode[] = [];
  const walk = (n: RawAxNode, depth: number) => {
    const role = n.role?.value ?? '';
    const keep = !n.ignored && role !== 'InlineTextBox' && role !== 'none';
    if (keep) {
      out.push({
        role,
        name: (n.name?.value ?? '').replace(/\s+/g, ' ').trim(),
        depth,
        backendId: n.backendDOMNodeId,
      });
    }
    for (const id of n.childIds ?? []) {
      const child = byId.get(id);
      if (child) walk(child, keep ? depth + 1 : depth);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * `accessibilityTree()`, read again until `ready` accepts it. Chromium
 * updates the tree after the DOM, so on a busy machine (CI runs the unit and
 * browser projects side by side under coverage) a read straight after a
 * render can miss nodes the DOM already has. After `timeout` ms the last
 * tree is returned as it is, for the caller's assertions to report.
 */
export async function accessibilityTreeWith(
  ready: (tree: AxNode[]) => boolean,
  timeout = 10000
): Promise<AxNode[]> {
  const deadline = performance.now() + timeout;
  let tree = await accessibilityTree();
  while (!ready(tree) && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    tree = await accessibilityTree();
  }
  return tree;
}

/** The interactive and structural nodes of a tree, as `role "name"` lines. */
export function outline(
  tree: AxNode[],
  roles: string[] = [
    'banner',
    'main',
    'region',
    'navigation',
    'complementary',
    'contentinfo',
    'heading',
    'button',
    'link',
    'checkbox',
    'radio',
    'combobox',
    'textbox',
    'separator',
    'listbox',
    'option',
    'tooltip',
    'alert',
    'status',
  ]
): string[] {
  return tree
    .filter((n) => roles.includes(n.role))
    .map((n) => `${n.role}${n.name ? ` "${n.name}"` : ''}`);
}

// ─────────────────────────── layout ───────────────────────────

/**
 * WCAG 1.4.12's text-spacing values, as a bookmarklet applies them: line
 * height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing
 * 0.16em, all `!important`.
 */
export const TEXT_SPACING_CSS = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

/** Apply {@link TEXT_SPACING_CSS} to the document and every shadow root. */
export function applyTextSpacing(): () => void {
  const added: HTMLStyleElement[] = [];
  const add = (root: Document | ShadowRoot) => {
    const style = document.createElement('style');
    style.textContent = TEXT_SPACING_CSS;
    (root instanceof Document ? root.head : root).append(style);
    added.push(style);
  };
  add(document);
  for (const el of deepElements(document)) if (el.shadowRoot) add(el.shadowRoot);
  return () => added.forEach((s) => s.remove());
}

const ownText = (el: Element) =>
  [...el.childNodes].some(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== ''
  );

const rendered = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

export interface LayoutProblem {
  kind: 'clipped' | 'overlap' | 'off-page';
  what: string;
}

/**
 * Text that a layout hides or garbles under `roots`, skipping anything
 * inside an element `exempt` accepts:
 *  - `clipped`: an element that hides overflow (and does not scroll) holds
 *    text and its content is bigger than its box;
 *  - `overlap`: two text runs overlap by more than 2 px both ways;
 *  - `off-page`: text that starts at or past the right edge of the
 *    viewport, so it shows only by scrolling sideways. Text inside an
 *    element `scrolls` accepts (two-dimensional content with its own scroll
 *    box, such as a wide table, which 1.4.10 lets scroll) is still checked
 *    for the other two, but not for this.
 */
export function layoutProblems(
  roots: Element[],
  exempt: (el: Element) => boolean = () => false,
  options: { scrolls?: (el: Element) => boolean } = {}
): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const within = (test: (el: Element) => boolean) => (el: Element) => {
    for (let n: Element | null = el; n; n = parentOf(n)) if (test(n)) return true;
    return false;
  };
  const isExempt = within(exempt);
  const mayScroll = within(options.scrolls ?? (() => false));
  const textRects: { el: Element; r: Box }[] = [];
  const pageRight = document.documentElement.clientWidth;
  for (const root of roots) {
    for (const el of [root, ...deepElements(root)]) {
      if (!rendered(el) || isExempt(el)) continue;
      const cs = getComputedStyle(el);
      if (el.closest('[hidden]') || cs.display === 'none') continue;
      const hides = (o: string) => o === 'hidden' || o === 'clip';
      const visuallyHidden =
        el.getBoundingClientRect().width <= 1 || cs.clipPath !== 'none' || cs.clip.startsWith('rect');
      if (visuallyHidden) continue;
      if (
        (hides(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
        (hides(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)
      ) {
        if (el.textContent!.trim()) {
          problems.push({
            kind: 'clipped',
            what: `${describeEl(el)} (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`,
          });
        }
      }
      if (!ownText(el) || el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const clip = clipBox(el);
        // One box per line, cut to what the scroll and overflow boxes
        // around it let show: text scrolled out of view is not overlapping.
        for (const line of range.getClientRects()) {
          if (line.width < 1 || line.height < 1) continue;
          if (line.left >= pageRight && !mayScroll(el)) {
            problems.push({ kind: 'off-page', what: describeEl(el) });
          }
          const r = intersect(line, clip);
          if (r) textRects.push({ el, r });
        }
      }
    }
  }
  for (let i = 0; i < textRects.length; i++) {
    for (let j = i + 1; j < textRects.length; j++) {
      const a = textRects[i];
      const b = textRects[j];
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x > 2 && y > 2) {
        problems.push({
          kind: 'overlap',
          what: `${describeEl(a.el)} and ${describeEl(b.el)}`,
        });
      }
    }
  }
  return problems;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersect(a: Box, b: Box): Box | null {
  const r = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return r.right - r.left >= 1 && r.bottom - r.top >= 1 ? r : null;
}

/** The part of the page an element's content can show in: its clipping ancestors' boxes. */
function clipBox(el: Element): Box {
  let box: Box = {
    left: -Infinity,
    top: -Infinity,
    right: Infinity,
    bottom: Infinity,
  };
  for (let n = parentOf(el); n; n = parentOf(n)) {
    const cs = getComputedStyle(n);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      box = intersect(box, n.getBoundingClientRect()) ?? {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      };
    }
  }
  return box;
}

/**
 * Text drawn in SVG (`<text>`) under `roots` that is cut off or overlaps:
 *  - `clipped`: a text box that runs more than 1 px out of its `<svg>`
 *    (an `<svg>` clips what it draws past its edge);
 *  - `overlap`: two text boxes that overlap by more than 1 px both ways.
 * Text that is not drawn (`display: none`, `visibility: hidden`, zero
 * opacity on it or an ancestor, or an empty box) is skipped.
 */
export function svgTextProblems(roots: Element[]): LayoutProblem[] {
  const drawn = (el: Element) => {
    for (let n: Element | null = el; n; n = parentOf(n)) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (n.getAttribute('opacity') === '0') return false;
    }
    return true;
  };
  const texts = roots
    .flatMap((root) => deepElements(root))
    .filter((el): el is SVGTextElement => el instanceof SVGTextElement && el.textContent!.trim() !== '')
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width >= 1 && r.height >= 1 && drawn(el));
  /** `nightingale-navigation "40"`: the custom element that drew it, and the text. */
  const what = (el: Element) => {
    let host: Element | null = el;
    while (host && !host.localName.includes('-')) host = parentOf(host);
    return `${host?.localName ?? 'svg'} "${el.textContent!.trim()}"`;
  };
  const problems: LayoutProblem[] = [];
  for (const { el, r } of texts) {
    const svg = el.ownerSVGElement?.getBoundingClientRect();
    if (svg && (r.left < svg.left - 1 || r.right > svg.right + 1 || r.top < svg.top - 1 || r.bottom > svg.bottom + 1)) {
      problems.push({ kind: 'clipped', what: what(el) });
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].r;
      const b = texts[j].r;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 1 && y > 1) {
        problems.push({ kind: 'overlap', what: `${what(texts[i].el)} and ${what(texts[j].el)}` });
      }
    }
  }
  return problems;
}

/** How far the page scrolls sideways, in CSS px (0 = no horizontal scroll). */
export const sidewaysScroll = () =>
  Math.max(
    0,
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );

// ─────────────────────────── target size (2.5.8) ───────────────────────────

export interface TargetSize {
  what: string;
  width: number;
  height: number;
  /** At least 24×24 CSS px. */
  big: boolean;
  /**
   * For a smaller target: a 24 px circle on its centre intersects no other
   * target, and no other small target's circle (the spacing exception).
   */
  spaced: boolean;
}

/** Measure each target against 2.5.8: 24×24 px, or the spacing exception. */
export function targetSizes(targets: Element[]): TargetSize[] {
  const boxes = targets.map((el) => ({ el, r: el.getBoundingClientRect() }));
  const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2];
  const circleHitsRect = (c: number[], r: DOMRect) => {
    const dx = Math.max(r.left - c[0], 0, c[0] - r.right);
    const dy = Math.max(r.top - c[1], 0, c[1] - r.bottom);
    return dx * dx + dy * dy < 12 * 12;
  };
  return boxes.map(({ el, r }) => {
    const big = r.width >= 24 - 0.01 && r.height >= 24 - 0.01;
    const c = centre(r);
    const spaced =
      big ||
      boxes.every(({ el: other, r: o }) => {
        if (other === el || deepContains(other, el) || deepContains(el, other)) {
          return true;
        }
        if (circleHitsRect(c, o)) return false;
        const otherSmall = o.width < 24 || o.height < 24;
        if (!otherSmall) return true;
        const oc = centre(o);
        return Math.hypot(c[0] - oc[0], c[1] - oc[1]) >= 24;
      });
    return {
      what: describeEl(el),
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
      big,
      spaced,
    };
  });
}

// ─────────────────────────── character keys (2.1.4) ───────────────────────────

/** Every printable ASCII character but the space, as `userEvent.keyboard` text. */
export const PRINTABLE_KEYS = Array.from({ length: 94 }, (_, i) =>
  String.fromCharCode(33 + i)
)
  // `{` and `[` start key descriptors in userEvent.keyboard; double them.
  .map((c) => (c === '{' || c === '[' ? c + c : c))
  .join('');
