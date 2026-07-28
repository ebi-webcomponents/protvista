import { describe, it, expect, vi } from 'vitest';

vi.mock('lit', () => ({
  nothing: Symbol.for('lit.nothing'),
}));

import { nothing } from 'lit';
import {
  resolvePath,
  getRowId,
  getCellStringValue,
  computeFilteredData,
  computeUniqueValuesByKey,
  findRowFromEvent,
  safeDisplayValue,
  type FilterableColumn,
} from '../protvista-uniprot-datatable.js';

type Row = {
  id: string;
  source: string;
  method?: string;
  summary?: { model_identifier?: string; confidence?: number };
  flags?: { active?: boolean };
};

const data: Row[] = [
  {
    id: '1',
    source: 'PDB',
    method: 'Experimental',
    summary: { model_identifier: 'm1', confidence: 0 },
    flags: { active: false },
  },
  {
    id: '2',
    source: 'AlphaFold',
    method: 'Predicted',
    summary: { model_identifier: 'm2', confidence: 10 },
    flags: { active: true },
  },
  {
    id: '3',
    source: 'PDB',
    method: 'Experimental',
    summary: { model_identifier: 'm3' },
  },
];

describe('protvista-uniprot-datatable utils', () => {
  describe('resolvePath', () => {
    it('returns top-level values', () => {
      expect(resolvePath(data[0], 'id')).toBe('1');
    });

    it('returns nested values via dot path', () => {
      expect(resolvePath(data[0], 'summary.model_identifier')).toBe('m1');
    });

    it('supports falsey leaf values without breaking traversal', () => {
      expect(resolvePath(data[0], 'summary.confidence')).toBe(0);
      expect(resolvePath(data[0], 'flags.active')).toBe(false);
    });

    it('returns undefined for missing paths', () => {
      expect(resolvePath(data[0], 'summary.missing')).toBeUndefined();
      expect(resolvePath(data[0], 'missing.deep')).toBeUndefined();
    });
  });

  describe('getRowId', () => {
    it('returns a string id for direct keys', () => {
      expect(getRowId(data[0], 'id')).toBe('1');
    });

    it('supports deep rowIdKey paths', () => {
      expect(getRowId(data[0], 'summary.model_identifier')).toBe('m1');
    });

    it('returns empty string when the id cannot be resolved', () => {
      expect(getRowId(data[0], 'summary.missing')).toBe('');
    });
  });

  describe('getCellStringValue', () => {
    it('returns string values for direct keys', () => {
      expect(getCellStringValue(data[1], 'source')).toBe('AlphaFold');
    });

    it('stringifies non-string values', () => {
      expect(getCellStringValue(data[0], 'summary.confidence')).toBe('0');
      expect(getCellStringValue(data[0], 'flags.active')).toBe('false');
    });

    it('returns empty string for missing keys', () => {
      expect(getCellStringValue(data[0], 'nope')).toBe('');
    });
  });

  describe('computeFilteredData', () => {
    it('returns original data when filters are empty', () => {
      const out = computeFilteredData(data, {});
      expect(out).toBe(data);
    });

    it('filters by exact match for a single filter', () => {
      const out = computeFilteredData(data, { source: 'PDB' });
      expect(out.map((r) => r.id)).toEqual(['1', '3']);
    });

    it('filters by exact match for multiple filters', () => {
      const out = computeFilteredData(data, {
        source: 'PDB',
        method: 'Experimental',
      });
      expect(out.map((r) => r.id)).toEqual(['1', '3']);
    });

    it('ignores empty filter values', () => {
      const out = computeFilteredData(data, { source: '' });
      expect(out).toEqual(data);
    });
  });

  describe('computeUniqueValuesByKey', () => {
    it('builds sorted unique options for filterable columns only', () => {
      const cols: FilterableColumn[] = [
        { key: 'source', filterable: true },
        { key: 'method', filterable: true },
        { key: 'id', filterable: false },
        { key: 'summary.model_identifier', filterable: true },
      ];

      const out = computeUniqueValuesByKey(data, cols);

      expect(out).toEqual({
        source: ['AlphaFold', 'PDB'],
        method: ['Experimental', 'Predicted'],
        'summary.model_identifier': ['m1', 'm2', 'm3'],
      });
      expect(out).not.toHaveProperty('id');
    });

    it('returns empty object if no columns are filterable', () => {
      const cols: FilterableColumn[] = [
        { key: 'source', filterable: false },
        { key: 'method' },
      ];
      expect(computeUniqueValuesByKey(data, cols)).toEqual({});
    });
  });

  describe('safeDisplayValue', () => {
    it('returns lit.nothing for null and undefined', () => {
      expect(safeDisplayValue(undefined)).toBe(nothing);
      expect(safeDisplayValue(null)).toBe(nothing);
    });

    it('returns lit.nothing for objects and arrays', () => {
      expect(safeDisplayValue({ a: 1 })).toBe(nothing);
      expect(safeDisplayValue([1, 2, 3])).toBe(nothing);
    });

    it('returns a string for primitives', () => {
      expect(safeDisplayValue('x')).toBe('x');
      expect(safeDisplayValue(42)).toBe('42');
      expect(safeDisplayValue(false)).toBe('false');
    });
  });

  describe('findRowFromEvent', () => {
    class MockHTMLTableRowElement {
      dataset: Record<string, string> = {};
    }

    // @ts-expect-error - assign for test env
    global.HTMLTableRowElement = MockHTMLTableRowElement;

    it('returns matching row based on tr[data-id]', () => {
      const tr =
        new MockHTMLTableRowElement() as unknown as HTMLTableRowElement;
      (tr as any).dataset = { id: '2' };

      const e = {
        composedPath: () => [tr],
      } as unknown as Event;

      const out = findRowFromEvent(e, data, 'id');
      expect(out).toEqual({ id: '2', row: data[1] });
    });

    it('returns an id with undefined row when the id is not found in filteredData', () => {
      const tr =
        new MockHTMLTableRowElement() as unknown as HTMLTableRowElement;
      (tr as any).dataset = { id: '999' };

      const e = {
        composedPath: () => [tr],
      } as unknown as Event;

      const out = findRowFromEvent(e, data, 'id');
      expect(out).toEqual({ id: '999', row: undefined });
    });

    it('returns null if no tr[data-id] is found in the composedPath', () => {
      const e = {
        composedPath: () => [{}, { foo: 'bar' }],
      } as unknown as Event;

      const out = findRowFromEvent(e, data, 'id');
      expect(out).toBeNull();
    });
  });
});
