/**
 * Proof that the computed pipeline agrees with the adapter grid it replaces.
 *
 * Phase 3 deletes `features-csv`, `linegraph-tsv`, `variation-json` and the
 * rest, and resolves (shape, format) through `runPipeline` instead. That is
 * only safe if the two produce the same thing — for well-formed input *and*
 * for malformed input, since the row/column-named errors are a documented
 * part of the bring-your-own-data contract and the reason authors can debug
 * their own files.
 *
 * So every cell of the grid is compared against its computed equivalent:
 * same payload, and the same thrown message. A cell that disagrees here is a
 * cell phase 3 would silently change.
 */

import { describe, it, expect, vi } from 'vitest';

import { runPipeline, formatCanProduce, ShapeFormatMismatchError } from '../pipeline.js';
import { createRegistry } from '../../registry.js';
import { KIND_ADAPTER_VARIANTS } from '../../file-formats.js';
import { SHAPES } from '../../shapes.js';
import type { DataFormat, ShapeName } from '../../types.js';

const registry = createRegistry();
const adapter = (name: string) => registry.getAdapter(name)!;

/**
 * The grid, written out: every (shape, format) cell and the adapter name it
 * resolves to today. Cross-checked against `KIND_ADAPTER_VARIANTS` below so
 * this table cannot quietly describe a grid that no longer exists.
 */
const GRID: Record<ShapeName, Partial<Record<DataFormat, string>>> = {
  feature: {
    csv: 'features-csv',
    tsv: 'features-tsv',
    json: 'features-json',
    bed: 'bed',
  },
  point: { csv: 'linegraph-csv', tsv: 'linegraph-tsv', json: 'linegraph' },
  variation: {
    csv: 'variation-csv',
    tsv: 'variation-tsv',
    json: 'variation',
  },
};

/** Well-formed input per shape, in each encoding. */
const WELL_FORMED: Record<ShapeName, Partial<Record<DataFormat, unknown>>> = {
  feature: {
    csv: 'type,start,end,description,score\nDOMAIN,18,289,Extracellular,0.95\nBINDING,132,140,Heparin,0.87\n',
    tsv: 'type\tstart\tend\tdescription\nDOMAIN\t18\t289\tExtracellular\n',
    json: [
      { type: 'DOMAIN', start: 18, end: 289, description: 'Extracellular' },
      { type: 'BINDING', start: 132, end: 140, score: 0.87 },
    ],
    bed: 'chr1\t17\t289\tDOMAIN\n',
  },
  point: {
    csv: 'position,value\n1,412\n30,688\n60,905\n',
    tsv: 'position\tvalue\n1\t412\n30\t688\n',
    json: [
      { position: 1, value: 412 },
      { position: 30, value: 688 },
    ],
  },
  variation: {
    csv: 'position,wildType,variant,description\n672,D,N,3 of 48\n723,T,*,stop\n',
    tsv: 'position\tvariant\n672\tN\n',
    json: [
      { position: 672, wildType: 'D', variant: 'N', description: '3 of 48' },
      { position: 723, wildType: 'T', variant: '*' },
    ],
  },
};

/** Input that must fail, and fail the same way in both paths. */
const MALFORMED: Record<ShapeName, Partial<Record<DataFormat, unknown>>> = {
  feature: {
    csv: 'type,start,end,description\nDOMAIN,abc,289,x\n',
    tsv: 'type\tstart\tend\n', // missing a required column
    json: [{ type: 'DOMAIN', start: 'x', end: 9 }],
  },
  point: {
    csv: 'position,value\n1,abc\n',
    tsv: 'position\n1\n',
    json: [{ position: 1, value: '412' }],
  },
  variation: {
    csv: 'position,variant\nabc,K\n',
    tsv: 'position\n1\n',
    json: [{ position: 1 }],
  },
};

/** Run `fn` and hand back whatever it threw, sync or async. */
async function capture(fn: () => unknown): Promise<Error | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

type Cell = { shape: ShapeName; format: DataFormat; name: string };

const CELLS: Cell[] = (Object.keys(GRID) as ShapeName[]).flatMap((shape) =>
  (Object.keys(GRID[shape]) as DataFormat[]).map((format) => ({
    shape,
    format,
    name: GRID[shape][format] as string,
  }))
);

describe('the grid table describes the grid that actually exists', () => {
  it('every cell names a registered adapter', () => {
    for (const { name } of CELLS) {
      expect(registry.getAdapter(name), `${name} is not registered`).toBeDefined();
    }
  });

  it('every cell is one a kind can actually reach', () => {
    // Guards against comparing against a cell the resolver abandoned: each
    // (shape, format) must be wired to some kind's family.
    const wired = new Set(
      Object.values(KIND_ADAPTER_VARIANTS).flatMap((byExt) =>
        Object.values(byExt)
      )
    );
    for (const { name } of CELLS) {
      expect(wired.has(name as never), `${name} is unreachable`).toBe(true);
    }
  });

  it('covers every shape', () => {
    expect(Object.keys(GRID).sort()).toEqual(Object.keys(SHAPES).sort());
  });
});

describe.each(CELLS)('$shape × $format → $name', ({ shape, format, name }) => {
  it('produces the same payload as the grid adapter', async () => {
    const body = WELL_FORMED[shape][format];
    expect(body, `no fixture for ${shape} × ${format}`).toBeDefined();

    const fromGrid = await adapter(name)(body);
    const fromPipeline = await runPipeline(shape, format, body, {
      formatLabel: name,
    });
    expect(fromPipeline).toEqual(fromGrid);
  });

  it('throws the same message as the grid adapter', async () => {
    const body = MALFORMED[shape][format];
    if (body === undefined) return; // BED's failure modes are covered in bed.spec

    const gridError = await capture(() => adapter(name)(body));
    const pipelineError = await capture(() =>
      runPipeline(shape, format, body, { formatLabel: name })
    );

    expect(
      gridError,
      `${name} accepted input meant to be malformed`
    ).toBeInstanceOf(Error);
    expect(pipelineError).toBeInstanceOf(Error);
    expect(pipelineError?.message).toBe(gridError?.message);
  });
});

describe('a format that cannot produce the shape is refused', () => {
  it('BED only produces feature records', () => {
    expect(formatCanProduce('bed', 'feature')).toBe(true);
    expect(formatCanProduce('bed', 'point')).toBe(false);
    expect(formatCanProduce('bed', 'variation')).toBe(false);
  });

  it('the container formats produce any shape', () => {
    for (const format of ['csv', 'tsv', 'json'] as DataFormat[]) {
      for (const shape of Object.keys(SHAPES) as ShapeName[]) {
        expect(formatCanProduce(format, shape)).toBe(true);
      }
    }
  });

  it('names both sides when refusing, in the author’s vocabulary', () => {
    // This is the diagnostic the whole redesign exists to make possible: no
    // adapter name, no body type, just the file and the track.
    expect(() => runPipeline('variation', 'bed', 'chr1\t1\t2\tX\n')).toThrow(
      ShapeFormatMismatchError
    );
    expect(() => runPipeline('variation', 'bed', '')).toThrow(
      'BED files carry feature records (type, start, end); this track draws variation records (position, variant).'
    );
  });
});

describe('a non-text body on a delimited format degrades rather than throwing', () => {
  it('warns and yields an empty payload, as the grid adapters do', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(runPipeline('point', 'csv', [{ position: 1 }])).toEqual([]);
    expect(runPipeline('variation', 'csv', {})).toEqual({ variants: [] });
    expect(runPipeline('feature', 'tsv', 42)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
