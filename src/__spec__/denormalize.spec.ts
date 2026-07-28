/**
 * Writing a customized layout back into authored config
 * (`src/schema/denormalize.ts`).
 *
 * This is the round-trip that justifies making the config the source of
 * truth: a user imports data, arranges it, exports the config, and loading
 * that config back must reproduce what they arranged. So the central test
 * here is exactly that loop — arrange, export, re-load, compare — rather than
 * a field-by-field check of the writer.
 */
import { describe, it, expect } from 'vitest';
import { applyLayoutToConfig, configToYaml } from '../schema/denormalize';
import { loadConfigWithSource } from '../schema/load';
import {
  moveRow,
  moveTrack,
  sameArrangement,
  setRowHidden,
  setTrackHidden,
} from '../layout';
import type { GroupConfig, ProtvistaViewerConfig } from '../schema/types';

const authored: ProtvistaViewerConfig = {
  version: '1.0',
  accession: 'P05067',
  sources: { features: 'https://example.test/features/{accession}' },
  rows: [
    {
      id: 'domains',
      label: 'Domains',
      tracks: [
        { id: 'domain', kind: 'features', filter: 'DOMAIN', data: 'features' },
        { id: 'region', kind: 'features', filter: 'REGION', data: 'features' },
      ],
    },
    {
      id: 'ptm',
      tracks: [
        { id: 'glyco', kind: 'features', filter: 'CARBOHYD', data: 'features' },
      ],
    },
    // A standalone track: a top-level entry with no `tracks:`.
    { id: 'solo', kind: 'features', data: 'features' },
  ],
} as unknown as ProtvistaViewerConfig;

const load = () => loadConfigWithSource(structuredClone(authored));
const ids = (c: ProtvistaViewerConfig) => c.rows.map((r) => r.id);
const groupAt = (c: ProtvistaViewerConfig, i: number) =>
  c.rows[i] as GroupConfig;

describe('applyLayoutToConfig', () => {
  it('writes a row reorder into rows:', async () => {
    const { config, authored: src } = await load();
    const out = applyLayoutToConfig(src, moveRow(config.rows, 'solo', 0));
    expect(ids(out)).toEqual(['solo', 'domains', 'ptm']);
  });

  it('writes a track reorder into that group’s tracks:', async () => {
    const { config, authored: src } = await load();
    const out = applyLayoutToConfig(
      src,
      moveTrack(config.rows, 'domains', 'region', 0)
    );
    expect(groupAt(out, 0).tracks.map((t) => t.id)).toEqual([
      'region',
      'domain',
    ]);
  });

  it('writes a hide as hidden: true on the row', async () => {
    const { config, authored: src } = await load();
    const out = applyLayoutToConfig(src, setRowHidden(config.rows, 'ptm', true));
    expect(out.rows[1].hidden).toBe(true);
  });

  it('writes a track hide onto that track', async () => {
    const { config, authored: src } = await load();
    const out = applyLayoutToConfig(
      src,
      setTrackHidden(config.rows, 'domains', 'domain', true)
    );
    expect(groupAt(out, 0).tracks[0].hidden).toBe(true);
  });

  // Visible is the default, so a revealed row should read as if it had never
  // been hidden rather than carrying an explicit `hidden: false`.
  it('drops the field entirely when a row is revealed', async () => {
    const withHidden = structuredClone(authored);
    (withHidden.rows[1] as GroupConfig).hidden = true;
    const { config, authored: src } = await loadConfigWithSource(withHidden);
    const out = applyLayoutToConfig(src, setRowHidden(config.rows, 'ptm', false));
    expect('hidden' in out.rows[1]).toBe(false);
  });

  it('records a standalone row once, on its own entry', async () => {
    const { config, authored: src } = await load();
    const out = applyLayoutToConfig(src, setRowHidden(config.rows, 'solo', true));
    expect(out.rows[2].hidden).toBe(true);
  });

  it('leaves every other authored field untouched', async () => {
    const { config, authored: src } = await load();
    const out = applyLayoutToConfig(src, moveRow(config.rows, 'solo', 0));
    expect(out.accession).toBe('P05067');
    expect(out.sources).toEqual(authored.sources);
    expect(groupAt(out, 1).label).toBe('Domains');
  });

  it('does not mutate the authored config it was given', async () => {
    const { config, authored: src } = await load();
    applyLayoutToConfig(src, setRowHidden(moveRow(config.rows, 'solo', 0), 'ptm', true));
    expect(ids(src)).toEqual(['domains', 'ptm', 'solo']);
    expect('hidden' in src.rows[1]).toBe(false);
  });

  it('keeps a row the arrangement never mentions rather than dropping it', async () => {
    const { config, authored: src } = await load();
    const out = applyLayoutToConfig(src, config.rows.slice(0, 1));
    expect(ids(out)).toEqual(['domains', 'ptm', 'solo']);
  });
});

describe('arrange → export → re-load round-trip', () => {
  it('reproduces the arrangement exactly', async () => {
    const { config, authored: src } = await load();

    let arranged = moveRow(config.rows, 'solo', 0);
    arranged = moveTrack(arranged, 'domains', 'region', 0);
    arranged = setTrackHidden(arranged, 'domains', 'domain', true);
    arranged = setRowHidden(arranged, 'ptm', true);

    const exported = applyLayoutToConfig(src, arranged);
    const reloaded = await loadConfigWithSource(exported);

    expect(sameArrangement(reloaded.config.rows, arranged)).toBe(true);
  });

  it('survives a YAML export and re-parse', async () => {
    const { config, authored: src } = await load();
    const arranged = moveRow(config.rows, 'solo', 0);

    const yaml = await configToYaml(applyLayoutToConfig(src, arranged));
    const reloaded = await loadConfigWithSource(yaml);

    expect(sameArrangement(reloaded.config.rows, arranged)).toBe(true);
  });
});

describe('configToYaml', () => {
  it('emits parseable YAML that keeps authored key order', async () => {
    const yaml = await configToYaml(authored);
    expect(yaml).toContain('accession: P05067');
    expect(yaml.indexOf('id: domains')).toBeLessThan(yaml.indexOf('id: ptm'));
  });
});
