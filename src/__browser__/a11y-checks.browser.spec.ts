/**
 * Positive controls for the shared checks in `a11y-checks.ts`. The audit's
 * browser specs mostly assert that a check finds nothing (`toEqual([])`),
 * which a broken check would also return; these fixtures have known
 * problems, so each check must report them, and known-good twins, which it
 * must not.
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  layoutProblems,
  partlyVisible,
  stateDiff,
  stateOf,
  svgTextProblems,
  targetSizes,
} from './a11y-checks.js';

const mounted: HTMLElement[] = [];
afterEach(() => {
  mounted.splice(0).forEach((e) => e.remove());
});

/** A fixed-size box at the top left, holding `html`. */
function fixture(html: string): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText = 'position: absolute; left: 0; top: 0; width: 300px; height: 200px; font: 16px sans-serif;';
  // Fixture markup written in this file, never outside input.
  // eslint-disable-next-line no-unsanitized/property
  box.innerHTML = html;
  document.body.append(box);
  mounted.push(box);
  return box;
}

const kinds = (
  box: Element,
  exempt?: (el: Element) => boolean,
  options?: { scrolls?: (el: Element) => boolean }
) =>
  layoutProblems([box], exempt, options)
    .map((p) => p.kind)
    .sort();

describe('layoutProblems', () => {
  it('reports clipped text, overlapping text and text past the right edge', () => {
    const box = fixture(`
      <div style="width: 40px; height: 20px; overflow: hidden; white-space: nowrap">Clipped text that is too long</div>
      <span style="position: absolute; left: 0; top: 50px">First</span>
      <span style="position: absolute; left: 0; top: 50px">Second</span>
      <span style="position: fixed; left: ${document.documentElement.clientWidth + 20}px; top: 100px; white-space: nowrap">Off the page</span>
    `);
    expect(kinds(box)).toEqual(['clipped', 'off-page', 'overlap']);
  });

  it('reports nothing for the same text laid out well', () => {
    const box = fixture(`
      <div style="width: 120px; overflow: hidden">Wrapping text that fits</div>
      <span style="position: absolute; left: 0; top: 150px">First</span>
      <span style="position: absolute; left: 150px; top: 150px">Second</span>
    `);
    expect(kinds(box)).toEqual([]);
  });

  it('skips what `exempt` accepts, and only off-page for what `scrolls` accepts', () => {
    // A scroll box whose content is wider than the page: an overlapping
    // pair in view, and a run that shows only when the box scrolls.
    const box = fixture(`
      <div class="scroller" style="width: 100px; overflow-x: auto">
        <div style="width: ${document.documentElement.clientWidth * 2}px; position: relative; height: 40px">
          <span style="position: absolute; left: 0; top: 0">One</span>
          <span style="position: absolute; left: 0; top: 0">Two</span>
          <span style="position: absolute; left: ${document.documentElement.clientWidth + 20}px; top: 0">Far</span>
        </div>
      </div>
    `);
    const scroller = box.querySelector<HTMLElement>('.scroller')!;
    expect(kinds(box)).toEqual(['off-page', 'overlap']);
    expect(kinds(box, (el) => el === scroller)).toEqual([]);
    expect(kinds(box, undefined, { scrolls: (el) => el === scroller })).toEqual(['overlap']);
  });
});

describe('svgTextProblems', () => {
  it('reports SVG text cut off at its SVG edge and overlapping text, and skips text not drawn', () => {
    const box = fixture(`
      <svg width="100" height="40" style="font: 12px sans-serif">
        <text x="-6" y="15">WW</text>
        <text x="40" y="15">One</text>
        <text x="42" y="16">Two</text>
        <text x="70" y="35" style="display: none">Hidden</text>
        <text x="70" y="35" opacity="0">Faded</text>
      </svg>
    `);
    expect(svgTextProblems([box]).map((p) => p.kind).sort()).toEqual(['clipped', 'overlap']);
  });

  it('reports nothing for text inside its SVG and apart', () => {
    const box = fixture(`
      <svg width="100" height="40" style="font: 12px sans-serif">
        <text x="2" y="15">One</text>
        <text x="50" y="15">Two</text>
      </svg>
    `);
    expect(svgTextProblems([box])).toEqual([]);
  });
});

describe('stateOf and stateDiff', () => {
  it('see an expanded, checked or added element, and nothing when nothing changes', () => {
    const box = fixture(`<button aria-expanded="false">Toggle</button><input type="checkbox" />`);
    const start = stateOf([box]);
    expect(stateDiff(start, stateOf([box]))).toEqual([]);
    box.querySelector('button')!.setAttribute('aria-expanded', 'true');
    expect(stateDiff(start, stateOf([box])).join('\n')).toMatch(/aria-expanded=false\s+→\s+.*aria-expanded=true/);
    box.querySelector('input')!.checked = true;
    expect(stateDiff(start, stateOf([box])).join('\n')).toMatch(/checked=true/);
    box.append(document.createElement('p'));
    expect(stateDiff(start, stateOf([box])).join('\n')).toMatch(/elements:\d+\s+→\s+elements:/);
  });
});

describe('targetSizes', () => {
  it('fails a small target crowded by another and passes a big or spaced one', () => {
    const box = fixture(`
      <button class="a" style="position: absolute; left: 0; top: 0; width: 10px; height: 10px; padding: 0"></button>
      <button class="b" style="position: absolute; left: 12px; top: 0; width: 10px; height: 10px; padding: 0"></button>
      <button class="c" style="position: absolute; left: 100px; top: 0; width: 10px; height: 10px; padding: 0"></button>
      <button class="d" style="position: absolute; left: 0; top: 100px; width: 30px; height: 30px; padding: 0"></button>
    `);
    const sizes = targetSizes([...box.querySelectorAll('button')]);
    expect(sizes.map((s) => [s.big, s.spaced])).toEqual([
      [false, false],
      [false, false],
      [false, true],
      [true, true],
    ]);
  });
});

describe('partlyVisible', () => {
  it('is false for an element entirely under another, true when part shows', () => {
    const box = fixture(`
      <button class="under" style="position: absolute; left: 0; top: 0; width: 40px; height: 20px">A</button>
      <div class="cover" style="position: absolute; left: 0; top: 0; width: 50px; height: 30px; background: white"></div>
    `);
    const under = box.querySelector<HTMLElement>('.under')!;
    expect(partlyVisible(under)).toBe(false);
    box.querySelector<HTMLElement>('.cover')!.style.width = '20px';
    expect(partlyVisible(under)).toBe(true);
  });
});
