/**
 * Guards the preset seeds: every config offered by the picker must load
 * cleanly (parse → validate → normalize) against its accession, so a
 * broken seed can never reach the playground UI.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../schema/load';
import { createRegistry } from '../../schema/registry';
import {
  ALL_PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
  isDevPreset,
} from '../presets';

describe('presets', () => {
  it('exposes the default preset', () => {
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it('flags dev presets and not consumer presets', () => {
    expect(isDevPreset('dev-multimer')).toBe(true);
    expect(isDevPreset('uniprot-default')).toBe(false);
    expect(isDevPreset('nope')).toBe(false);
  });

  it.each(ALL_PRESETS.map((p) => [p.id, p] as const))(
    'preset "%s" loads without error',
    async (_id, preset) => {
      await expect(
        loadConfig(preset.config, {
          accession: preset.accession,
          registry: createRegistry(),
        })
      ).resolves.toBeDefined();
    }
  );

  it('file-backed presets point at the served sample data, not a bare page-relative file', () => {
    for (const id of ['csv', 'json']) {
      const preset = getPreset(id);
      expect(preset).toBeDefined();
      // Repointed to the served /protvista/sample-data/ path so it loads.
      expect(preset!.config).toContain('/protvista/sample-data/hotspots.');
      expect(preset!.config).not.toMatch(/data:\s*\.\/hotspots\./);
    }
  });
});
