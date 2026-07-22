/**
 * Guards the preset seeds: every config offered by the picker must load
 * cleanly (parse → validate → normalize) against its accession, so a
 * broken seed can never reach the playground UI.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../schema/load';
import { createRegistry } from '../../schema/registry';
import { PRESETS, DEFAULT_PRESET_ID, getPreset } from '../presets';

describe('presets', () => {
  it('exposes the default preset', () => {
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))(
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
      // Repointed so the file actually loads next to playground.html.
      expect(preset!.config).toContain('./sample-data/hotspots.');
      expect(preset!.config).not.toMatch(/data:\s*\.\/hotspots\./);
    }
  });
});
