/**
 * Byte-identity guard + generator for the reference outputs, mirroring
 * `schema-publishing.spec.ts` / `scripts/sync-schema.mjs`.
 *
 * Normal run: asserts the checked-in `docs/adapter-reference.md` and
 * `public/schema/v1/feature-record.schema.json` are byte-identical to what
 * the renderer produces from `ADAPTER_REFERENCE`. A drift fails with a
 * "run `yarn adapters:sync`" message.
 *
 * With `UPDATE_ADAPTER_REFERENCE=1` (the `yarn adapters:sync` script), it
 * writes those files instead of asserting — this is the generator. Using
 * the TS-capable test runner sidesteps the need for a TS loader in a
 * plain-Node script.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  renderReferenceMarkdown,
  renderFeatureRecordSchemaJson,
  ADAPTER_REFERENCE_MD_PATH,
  FEATURE_RECORD_SCHEMA_PATH,
  FEATURE_RECORD_SCHEMA_ID,
} from '../adapters/render-adapter-reference.js';

const mdPath = resolve(process.cwd(), ADAPTER_REFERENCE_MD_PATH);
const schemaPath = resolve(process.cwd(), FEATURE_RECORD_SCHEMA_PATH);
const UPDATE = Boolean(process.env.UPDATE_ADAPTER_REFERENCE);

describe('adapter reference — generated outputs', () => {
  const markdown = renderReferenceMarkdown();
  const schemaJson = renderFeatureRecordSchemaJson();

  if (UPDATE) {
    it('regenerates the checked-in outputs (UPDATE_ADAPTER_REFERENCE)', () => {
      writeFileSync(mdPath, markdown);
      writeFileSync(schemaPath, schemaJson);
    });
    return;
  }

  it('docs/adapter-reference.md is byte-identical to the renderer', () => {
    const onDisk = readFileSync(mdPath, 'utf8');
    expect(
      onDisk,
      'docs/adapter-reference.md drifted from the source table — run `yarn adapters:sync`'
    ).toBe(markdown);
  });

  it('public/schema/v1/feature-record.schema.json is byte-identical to the renderer', () => {
    const onDisk = readFileSync(schemaPath, 'utf8');
    expect(
      onDisk,
      'public/schema/v1/feature-record.schema.json drifted — run `yarn adapters:sync`'
    ).toBe(schemaJson);
  });

  it('the served fragment declares the canonical Pages $id', () => {
    expect(FEATURE_RECORD_SCHEMA_ID).toBe(
      'https://ebi-webcomponents.github.io/protvista/schema/v1/feature-record.schema.json'
    );
  });
});
