/**
 * The colour the real `<nightingale-colored-sequence>` paints for each
 * category letter of the two built-in score themes, zoomed in (one rect per
 * residue) and zoomed out (one gradient stop per residue).
 *
 * Evidence for the colour-blind section of `docs/accessibility-audit.md`:
 * `scripts/accessibility/palette_audit.py` reproduces the AlphaMissense table
 * from the same lookup rule, and this spec confirms the rule in Chromium.
 *
 * nightingale-colored-sequence 5.11 upper-cases the keys of `scale` when it
 * parses it (so a later key overwrites an earlier one that differs only in
 * case) and upper-cases each residue letter when it looks it up. The
 * AlphaMissense buckets use `H`/`h`, `L`/`l` and `P`/`p` for different
 * scores, so three of them are drawn in another bucket's colour. The
 * AlphaMissense test records today's colours, defect included; when that
 * is fixed, update the expected table and the audit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// `vi.unmock` cannot lift a setup file's mock in browser mode, so each mock
// is replaced by the real module (as in `alphamissense-no-score.browser.spec.ts`).
vi.mock('@nightingale-elements/nightingale-sequence', (real) => real());
vi.mock('@nightingale-elements/nightingale-colored-sequence', (real) => real());

import '@nightingale-elements/nightingale-colored-sequence';
import { colorScaleToAttrs } from '../renderer/render-helpers.js';

afterEach(() => {
  document.body.innerHTML = '';
});

type ColoredSequence = HTMLElement & {
  sequence: string;
  updateComplete: Promise<unknown>;
};

const toHex = (rgb: string) => {
  const parts = (rgb.match(/[\d.]+/g) ?? []).map(Number);
  if (parts.length === 4 && parts[3] === 0) return 'transparent';
  return `#${parts
    .slice(0, 3)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
};

async function draw(theme: string, sequence: string, width: number) {
  const { scale, colorRange } = colorScaleToAttrs({ theme });
  const el = document.createElement(
    'nightingale-colored-sequence'
  ) as ColoredSequence;
  el.setAttribute('length', String(sequence.length));
  el.setAttribute('display-start', '1');
  el.setAttribute('display-end', String(sequence.length));
  el.setAttribute('height', '13');
  el.setAttribute('width', String(width));
  el.setAttribute('scale', scale!);
  el.setAttribute('color-range', colorRange!);
  el.style.display = 'block';
  el.style.width = `${width}px`;
  document.body.appendChild(el);
  el.sequence = sequence;
  await el.updateComplete;
  return el;
}

/** Letter → colour, read from the per-residue rects (zoomed in). */
async function residueColours(theme: string, letters: string) {
  const el = await draw(theme, letters, letters.length * 40);
  await vi.waitFor(() => {
    if (!el.querySelector(`rect.base_bg[data-pos="${letters.length}"]`)) {
      throw new Error('not drawn');
    }
  });
  return Object.fromEntries(
    [...letters].map((letter, i) => [
      letter,
      toHex(
        getComputedStyle(
          el.querySelector(`rect.base_bg[data-pos="${i + 1}"]`)!
        ).fill
      ),
    ])
  );
}

/** Letter → colour, read from the gradient stops (zoomed out). */
async function gradientColours(theme: string, letters: string) {
  const el = await draw(theme, letters, letters.length * 2);
  await vi.waitFor(() => {
    if (el.querySelectorAll('stop').length !== letters.length) {
      throw new Error('not drawn');
    }
  });
  const stops = [...el.querySelectorAll('stop')];
  return Object.fromEntries(
    [...letters].map((letter, i) => [
      letter,
      toHex(
        getComputedStyle(stops[i]).getPropertyValue('stop-color') ||
          stops[i].getAttribute('stop-color')!
      ),
    ])
  );
}

describe('score colours as nightingale-colored-sequence draws them', () => {
  it('draws each AlphaFold pLDDT category in its own colour', async () => {
    const expected = {
      D: '#ff7d45', // very low (< 50)
      L: '#ffdb13', // low (50–70)
      M: '#65cbf3', // confident (70–90)
      H: '#0053d6', // very high (> 90)
    };
    expect(await residueColours('alphafold-ramp', 'DLMH')).toEqual(expected);
    expect(await gradientColours('alphafold-ramp', 'DLMH')).toEqual(expected);
  });

  it('records the AlphaMissense bucket colours, three of them wrong (#382 audit)', async () => {
    // Every letter the pathogenicity adapter writes, and its placeholder.
    const expected = {
      H: '#e99e7c', // 0–0.1132: intended #4290bf, drawn as `h`
      V: '#8cbcd4', // 0.1132–0.2264
      L: '#edcdba', // 0.2264–0.3395: intended #c3d6e0, drawn as `l`
      A: '#e2e2e2', // 0.3395–0.4527
      l: '#edcdba', // 0.4527–0.5895
      h: '#e99e7c', // 0.5895–0.7264
      p: '#b2182b', // 0.7264–0.8632: intended #d15e4b, drawn as `P`
      P: '#b2182b', // 0.8632–1
      '-': 'transparent', // no score
    };
    const letters = Object.keys(expected).join('');
    expect(await residueColours('alphamissense-ramp', letters)).toEqual(
      expected
    );
    expect(await gradientColours('alphamissense-ramp', letters)).toEqual(
      expected
    );
  });
});
