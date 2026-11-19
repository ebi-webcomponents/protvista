/**
 * A residue the AlphaMissense CSV has no usable score for must not be drawn
 * in a pathogenicity colour. The adapter writes '-' for it, and the real
 * nightingale-colored-sequence draws any character missing from its `scale`
 * at 0 — the certainly-benign end of the ramp — so the `alphamissense-ramp`
 * theme gives '-' a transparent stop of its own.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// `vi.unmock` cannot lift a setup file's mock in browser mode, so each mock
// is replaced by the real module (as in `feature-render.browser.spec.ts`).
vi.mock('@nightingale-elements/nightingale-sequence', (real) => real());
vi.mock('@nightingale-elements/nightingale-colored-sequence', (real) => real());

import '@nightingale-elements/nightingale-colored-sequence';
import { alphamissensePathogenicityAdapter } from '../schema/adapters/alphamissense-pathogenicity-adapter.js';
import { colorScaleToAttrs } from '../renderer/render-helpers.js';

const SEQUENCE = 'MAK';
const AM_URL = 'https://alphafold.example/am.csv';
const HEADER = 'protein_variant,am_pathogenicity,am_class';
const CERTAINLY_BENIGN = 'rgb(33, 102, 172)'; // #2166ac
const CERTAINLY_PATHOGENIC = 'rgb(178, 24, 43)'; // #b2182b

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Alpha channel of a computed `rgb()` / `rgba()` colour. */
const alpha = (color: string) => {
  const parts = color.match(/[\d.]+/g) ?? [];
  return parts.length === 4 ? +parts[3] : 1;
};

async function render(rows: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response([HEADER, ...rows].join('\n')))
  );
  const seq = (await alphamissensePathogenicityAdapter(
    [{ sequence: SEQUENCE, amAnnotationsUrl: AM_URL }],
    { sequence: { sequence: SEQUENCE } }
  )) as string;
  const { scale, colorRange } = colorScaleToAttrs({
    theme: 'alphamissense-ramp',
  });
  const el = document.createElement('nightingale-colored-sequence') as
    HTMLElement & { sequence: string; updateComplete: Promise<unknown> };
  el.setAttribute('length', '3');
  el.setAttribute('display-start', '1');
  el.setAttribute('display-end', '3');
  el.setAttribute('height', '13');
  el.setAttribute('width', '600');
  el.setAttribute('scale', scale!);
  el.setAttribute('color-range', colorRange!);
  el.style.display = 'block';
  el.style.width = '600px';
  document.body.appendChild(el);
  el.sequence = seq;
  await el.updateComplete;
  await vi.waitFor(() => {
    if (!el.querySelector('rect.base_bg[data-pos="3"]')) throw new Error();
  });
  // The computed fill normalises whatever d3 wrote to `rgb()` / `rgba()`.
  const fills = [1, 2, 3].map((pos) =>
    getComputedStyle(
      el.querySelector(`rect.base_bg[data-pos="${pos}"]`)!
    ).fill
  );
  return { seq, fills };
}

describe('AlphaMissense residue with no score', () => {
  it('draws a position missing from the CSV transparent, not certainly benign', async () => {
    const { seq, fills } = await render(['M1A,0.05,LBen', 'K3R,0.9,LPath']);
    expect(seq).toBe('H-P');
    expect(fills[1]).not.toBe(CERTAINLY_BENIGN);
    expect(alpha(fills[1])).toBe(0);
    // A real score at either end of the ramp is still painted.
    expect(alpha(fills[0])).toBe(1);
    expect(fills[2]).toBe(CERTAINLY_PATHOGENIC);
  });

  it('draws a position whose only row is unparseable transparent', async () => {
    const { seq, fills } = await render([
      'M1A,0.05,LBen',
      'A2V,abc,Amb',
      'K3R,0.9,LPath',
    ]);
    expect(seq).toBe('H-P');
    expect(fills[1]).not.toBe(CERTAINLY_BENIGN);
    expect(alpha(fills[1])).toBe(0);
  });
});
