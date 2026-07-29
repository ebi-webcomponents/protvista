import { describe, it, expect, beforeEach } from 'vitest';
import { createDiagnosticsView } from '../diagnostics-view.js';

describe('createDiagnosticsView', () => {
  let summary: HTMLElement;
  let list: HTMLUListElement;

  beforeEach(() => {
    summary = document.createElement('p');
    list = document.createElement('ul');
  });

  it('showConfig: no diagnostics → valid summary, empty list, returns true', () => {
    const view = createDiagnosticsView(summary, list);
    expect(view.showConfig([])).toBe(true);
    expect(summary.textContent).toBe('No problems — config is valid.');
    expect(list.children).toHaveLength(0);
  });

  it('showConfig: lists diagnostics (with codes), pluralises, returns false', () => {
    const view = createDiagnosticsView(summary, list);
    const valid = view.showConfig([
      { message: 'bad kind', code: 'unknown-semantic-kind' },
      { message: 'no data', code: 'missing-inline-data' },
    ]);
    expect(valid).toBe(false);
    expect(summary.textContent).toBe('2 problems found:');
    expect(list.children).toHaveLength(2);
    expect(list.children[0].textContent).toBe('bad kind');
    expect((list.children[0] as HTMLElement).dataset.code).toBe(
      'unknown-semantic-kind'
    );
  });

  it('appendRuntime: appends issues with a phase prefix and updates the count', () => {
    const view = createDiagnosticsView(summary, list);
    view.showConfig([]);
    view.appendRuntime([{ message: 'fetch failed', code: 'runtime' }], 'data');
    expect(list.children).toHaveLength(1);
    expect(list.children[0].textContent).toBe('[data] fetch failed');
    expect(summary.textContent).toBe('1 problem found:');
  });

  it('appendRuntime: falls back to a generic message when no issues are given', () => {
    const view = createDiagnosticsView(summary, list);
    view.showConfig([]);
    view.appendRuntime(undefined);
    expect(list.children).toHaveLength(1);
    expect(list.children[0].textContent).toBe('A track failed to load its data.');
    expect((list.children[0] as HTMLElement).dataset.code).toBe('runtime');
  });
});
