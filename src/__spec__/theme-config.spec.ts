/**
 * Config-driven theming: a top-level `theme:` block is applied by the
 * component as inline `--protvista-*` custom properties on the host at
 * mount (see `applyTheme` in protvista-uniprot.ts).
 *
 * The config carries inline track data (no network) and `loadEntry` is
 * stubbed to a never-resolving promise, so `_init()` reaches `applyTheme`
 * (which runs before the fire-and-forget sequence fetch) and resolves
 * without touching the network.
 */
import { describe, it, expect } from 'vitest';
// Registers the <protvista-uniprot> element (side-effect import).
import '../protvista-uniprot.js';

type TestableElement = HTMLElement & {
  viewerConfig?: unknown;
  loadEntry: (...args: unknown[]) => Promise<unknown>;
  _init: () => Promise<void>;
  applyTheme: (theme: unknown) => void;
};

const mount = (config: unknown): TestableElement => {
  const el = document.createElement('protvista-uniprot') as TestableElement;
  // Avoid the background sequence fetch — applyTheme runs before it.
  el.loadEntry = () => new Promise(() => {});
  el.viewerConfig = config;
  return el;
};

const inlineTrack = {
  id: 'X',
  tracks: [
    { id: 't', kind: 'features', data: { from: 'inline', inlineData: [] } },
  ],
};

describe('config theme → chrome tokens on the host', () => {
  it('maps theme.labelColor + accentColor to inline --protvista-* properties', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#e8f5e9', accentColor: '#008000' },
      rows: [inlineTrack],
    });
    await el._init();
    // labelColor drives BOTH the group and track label backgrounds.
    expect(el.style.getPropertyValue('--protvista-group-label-bg')).toBe('#e8f5e9');
    expect(el.style.getPropertyValue('--protvista-track-label-bg')).toBe('#e8f5e9');
    expect(el.style.getPropertyValue('--protvista-color-accent')).toBe('#008000');
  });

  it('applies only the fields present (accentColor alone)', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { accentColor: '#008000' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(el.style.getPropertyValue('--protvista-color-accent')).toBe('#008000');
    expect(el.style.getPropertyValue('--protvista-group-label-bg')).toBe('');
  });

  it('leaves the tokens untouched when the config has no theme', async () => {
    const el = mount({ accession: 'P05067', rows: [inlineTrack] });
    await el._init();
    expect(el.style.getPropertyValue('--protvista-group-label-bg')).toBe('');
    expect(el.style.getPropertyValue('--protvista-color-accent')).toBe('');
  });

  it('clears previously-set tokens on re-apply with a narrowed or removed theme', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#e8f5e9', accentColor: '#008000' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(el.style.getPropertyValue('--protvista-group-label-bg')).toBe('#e8f5e9');

    // Narrow the theme (drop labelColor): the stale label tokens must clear.
    el.applyTheme({ accentColor: '#123456' });
    expect(el.style.getPropertyValue('--protvista-group-label-bg')).toBe('');
    expect(el.style.getPropertyValue('--protvista-track-label-bg')).toBe('');
    expect(el.style.getPropertyValue('--protvista-color-accent')).toBe('#123456');

    // Remove the theme entirely: all managed tokens clear.
    el.applyTheme(undefined);
    expect(el.style.getPropertyValue('--protvista-color-accent')).toBe('');
  });
});
