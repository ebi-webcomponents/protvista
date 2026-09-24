/**
 * Pure, deterministic renderers for the per-adapter reference.
 *
 * `renderReferenceMarkdown()` produces `docs/adapter-reference.md` and
 * `renderFeatureRecordSchema()` produces the object serialised to
 * `public/schema/v1/feature-record.schema.json`. Both are driven solely by
 * `ADAPTER_REFERENCE` (no clock, no environment), so the byte-identity
 * spec can re-render them and compare to the checked-in files. Regenerate
 * with `pnpm adapters:sync`.
 */

import {
  ADAPTER_REFERENCE,
  FEATURE_RECORD_FIELDS,
  type AdapterDoc,
  type DomainAdapterDoc,
  type KindAdapterDoc,
  type FieldDoc,
} from './adapter-reference.js';
import { DATA_FORMATS, DATA_FORMAT_NAMES } from '../file-formats.js';
import { SHAPES, SHAPE_NAMES } from '../shapes.js';
import { createRegistry } from '../registry.js';
import type { ShapeName } from '../types.js';

const PAGES_BASE = 'https://ebi-webcomponents.github.io/protvista';
const GITHUB_BLOB = 'https://github.com/ebi-webcomponents/protvista/blob/next';
const GITHUB_TREE = 'https://github.com/ebi-webcomponents/protvista/tree/next';

export const FEATURE_RECORD_SCHEMA_ID = `${PAGES_BASE}/schema/v1/feature-record.schema.json`;

/** Filenames produced by the generator, relative to the repo root. */
export const FEATURE_RECORD_SCHEMA_PATH = 'public/schema/v1/feature-record.schema.json';
// The Starlight docs page (Astro content collection). Base-prefixed in-site
// links (`/protvista/...`) and absolute GitHub/hosted URLs are emitted so the
// page renders correctly under the site base with no relative-path breakage.
export const ADAPTER_REFERENCE_MD_PATH =
  'docs/src/content/docs/adapter-reference.md';

const isDomain = (d: AdapterDoc): d is DomainAdapterDoc => d.tier === 'domain';

/** Escape a value for use inside a Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function fieldTable(fields: readonly FieldDoc[]): string {
  const header = '| Field | Type | Required | Notes |\n|---|---|---|---|';
  const rows = fields.map(
    (f) =>
      `| \`${f.name}\` | ${f.type} | ${f.required ? 'Yes' : 'No'} | ${cell(
        f.notes ?? ''
      )} |`
  );
  return [header, ...rows].join('\n');
}

/** Field docs per shape; the feature record is the one with prose notes. */
const SHAPE_FIELDS: Record<ShapeName, readonly FieldDoc[]> = {
  feature: FEATURE_RECORD_FIELDS,
  point: [
    {
      name: 'position',
      type: 'number',
      required: true,
      notes: '1-based residue position.',
    },
    {
      name: 'value',
      type: 'number',
      required: true,
      notes: 'The number plotted at that position. Any finite value.',
    },
  ],
  variation: [
    {
      name: 'position',
      type: 'number',
      required: true,
      notes: '1-based position of the changed residue.',
    },
    {
      name: 'variant',
      type: 'string',
      required: true,
      notes:
        'The residue it changes to. `*` for a stop, `-` for a deletion.',
    },
    {
      name: 'wildType',
      type: 'string',
      required: false,
      notes: 'The original residue. Shown on hover.',
    },
    {
      name: 'description',
      type: 'string',
      required: false,
      notes: 'Free text shown on hover/click.',
    },
    {
      name: 'consequence',
      type: 'string',
      required: false,
      notes: 'Your own consequence label, e.g. `missense`.',
    },
  ],
};

/** The kinds that draw a shape, from the registry rather than a hand-list. */
function kindsDrawing(shape: ShapeName): string[] {
  const registry = createRegistry();
  return registry
    .listSemanticKinds()
    .filter((k) => registry.getSemanticKind(k)?.shape === shape);
}

/** Formats that can carry a shape's records. */
function formatsFor(shape: ShapeName): string[] {
  return DATA_FORMAT_NAMES.filter((f) => {
    const emits = DATA_FORMATS[f].emitsShape;
    return emits === undefined || emits === shape;
  });
}

function shapeSection(shape: ShapeName): string {
  const def = SHAPES[shape];
  const kinds = kindsDrawing(shape);
  const parts: string[] = [];
  parts.push(`### ${def.label}`);
  parts.push('');
  parts.push(
    `Written by: ${kinds.map((k) => `\`kind: ${k}\``).join(', ')}.`
  );
  parts.push('');
  parts.push(
    `Readable as: ${formatsFor(shape)
      .map((f) => `\`${f}\``)
      .join(', ')} — by file extension, or with an explicit \`format:\`.`
  );
  parts.push('');
  parts.push(fieldTable(SHAPE_FIELDS[shape]));
  return parts.join('\n');
}

function formatTable(): string {
  const header =
    '| Format | Extension | Fetched as | Records it can carry |\n|---|---|---|---|';
  const rows = DATA_FORMAT_NAMES.map((f) => {
    const d = DATA_FORMATS[f];
    const carries = d.emitsShape
      ? `${SHAPES[d.emitsShape].label} only`
      : 'whatever the track\'s kind draws';
    return `| \`${f}\` | \`${d.ext}\` | ${d.body} | ${carries} |`;
  });
  return [header, ...rows].join('\n');
}

function domainTable(docs: readonly KindAdapterDoc[]): string {
  const header =
    '| Semantic kind | Adapter | Renders with | Inputs | Input shape |\n|---|---|---|---|---|';
  const rows = docs.map((d) => {
    const inputs = d.fetchesSecondaryUrl
      ? `${d.inputs} (+ fetches a further URL)`
      : String(d.inputs);
    return `| \`${d.kind}\` | \`${d.name}\` | \`${d.component}\` | ${inputs} | ${cell(
      d.inputSummary
    )} |`;
  });
  return [header, ...rows].join('\n');
}

export function renderReferenceMarkdown(
  reference: readonly AdapterDoc[] = ADAPTER_REFERENCE
): string {
  const domain = reference.filter(isDomain);

  const lines: string[] = [];
  lines.push('---');
  lines.push('title: Built-in adapter reference');
  lines.push('---');
  lines.push('');
  lines.push(
    '<!-- Generated by `pnpm adapters:sync` from src/schema/adapters/adapter-reference.ts. Do not edit by hand. -->'
  );
  lines.push('');
  lines.push(
    'ProtVista *configuration* (rows, tracks, sources, rendering) is validated by the ' +
      `[config JSON Schema](${PAGES_BASE}/schema/v1/config.schema.json); *track payloads* — the shapes ` +
      'adapters consume — are not. This page fills that gap: the expected input shape for every ' +
      'built-in adapter. For the config-vs-payload boundary see ' +
      '[Configuration vs data](/protvista/configuration-vs-data); for the normative generic-format ' +
      `contract see [specs/generic-format-adapters.md](${GITHUB_BLOB}/specs/generic-format-adapters.md).`
  );
  lines.push('');
  lines.push(
    'This reference is generated from the adapter code and kept in sync by drift tests, so it ' +
      'cannot silently diverge. It is a reference aid, not a normative schema.'
  );
  lines.push('');

  lines.push('## Bring your own data');
  lines.push('');
  lines.push(
    'Two independent facts decide how a source is read. Your track\'s `kind` says **which ' +
      'records** it needs; the file says **how they are encoded**. You never name an ' +
      'adapter for either: point a track at `./hits.csv` and the kind supplies the first ' +
      'half while the extension supplies the second. Use `format:` only when nothing can ' +
      'infer it — inline text, or a URL with no recognised extension.'
  );
  lines.push('');
  lines.push(
    'A malformed file fails with your own filename, the reading applied to it, and the ' +
      'offending row and column: `./depth.csv (parsed as CSV): row 3, column "value": ' +
      'expected a number, got "abc"`.'
  );
  lines.push('');
  lines.push('### The formats');
  lines.push('');
  lines.push(formatTable());
  lines.push('');
  lines.push(
    'Only BED constrains what it can carry: it encodes feature semantics (0-based ' +
      'half-open, converted on read), so pairing it with a kind that draws anything else ' +
      'is a config error naming both sides.'
  );
  lines.push('');
  lines.push('## The record shapes');
  lines.push('');
  lines.push(
    'Three shapes cover every kind that accepts your data. A machine-readable schema for ' +
      `the feature record is served at [\`feature-record.schema.json\`](${FEATURE_RECORD_SCHEMA_ID}).`
  );
  lines.push('');
  for (const shape of SHAPE_NAMES) {
    lines.push(shapeSection(shape));
    lines.push('');
  }

  lines.push('## Built-in track adapters (provider-supplied)');
  lines.push('');
  lines.push(
    'These back the kinds named for their provider. Their input is a response from an EBI ' +
      'API (or equivalent) — you do **not** author these payloads, and no file can stand in ' +
      'for one: each takes two responses plus a further fetch. The shapes below are ' +
      'informational, not a contract you must produce.'
  );
  lines.push('');
  lines.push(domainTable(domain));
  lines.push('');

  lines.push('## Related');
  lines.push('');
  lines.push(
    '- [Configuration vs data](/protvista/configuration-vs-data) — what config controls vs what providers supply.'
  );
  lines.push(
    `- [specs/config-approach.md](${GITHUB_BLOB}/specs/config-approach.md) — normative Intent/Representation split.`
  );
  lines.push(
    `- [specs/generic-format-adapters.md](${GITHUB_BLOB}/specs/generic-format-adapters.md) — normative generic-format contract.`
  );
  lines.push(
    `- [examples/](${GITHUB_TREE}/examples) — runnable, CI-validated config + data pairs.`
  );
  lines.push('');
  lines.push(
    '_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._'
  );
  lines.push('');
  return lines.join('\n');
}

export function renderFeatureRecordSchema(): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const f of FEATURE_RECORD_FIELDS) {
    const prop: Record<string, unknown> = { type: f.type };
    if (f.notes) prop.description = f.notes;
    if (f.name === 'start') {
      prop.description =
        '1-based start position (inclusive).';
      prop.$comment =
        'features-json also accepts `begin` as an alias for `start`; `start` wins when both are present.';
    }
    properties[f.name] = prop;
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: FEATURE_RECORD_SCHEMA_ID,
    title: 'ProtVista feature record',
    description:
      'The canonical payload the generic bring-your-own-data adapters (features-csv, features-tsv, features-json, bed) emit and the feature tracks consume. Generic format only — domain-adapter (EBI API) payloads are not schematised. See docs/adapter-reference.md.',
    type: 'object',
    required: FEATURE_RECORD_FIELDS.filter((f) => f.required).map((f) => f.name),
    additionalProperties: true,
    properties,
  };
}

/** Serialised form written to `public/schema/v1/feature-record.schema.json`. */
export function renderFeatureRecordSchemaJson(): string {
  return `${JSON.stringify(renderFeatureRecordSchema(), null, 2)}\n`;
}
