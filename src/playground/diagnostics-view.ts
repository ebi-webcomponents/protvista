/**
 * Owns the config pane's validation footer — the summary line plus the
 * error list. Both render paths (live config diagnostics and runtime
 * `protvista-error` issues) go through here, so the pluralised summary
 * text and the `<li>` construction live in exactly one place.
 */

/** The minimal shape this view renders from a diagnostic or an issue. */
interface Renderable {
  message: string;
  code?: string;
}

export interface DiagnosticsView {
  /**
   * Replace the list with the current config diagnostics and update the
   * summary. Returns whether the config is valid (no diagnostics).
   */
  showConfig(diagnostics: readonly Renderable[]): boolean;
  /**
   * Append runtime issues (from a `protvista-error` event) and refresh the
   * summary count. Falls back to a generic message when none are given.
   */
  appendRuntime(issues: readonly Renderable[] | undefined, phase?: string): void;
}

export function createDiagnosticsView(
  summary: HTMLElement,
  list: HTMLElement
): DiagnosticsView {
  const setSummary = (count: number): void => {
    summary.textContent =
      count === 0
        ? 'No problems — config is valid.'
        : `${count} problem${count === 1 ? '' : 's'} found:`;
  };

  const item = (message: string, code?: string): HTMLLIElement => {
    const li = document.createElement('li');
    li.textContent = message;
    if (code) li.dataset.code = code;
    return li;
  };

  return {
    showConfig(diagnostics) {
      setSummary(diagnostics.length);
      list.replaceChildren(...diagnostics.map((d) => item(d.message, d.code)));
      return diagnostics.length === 0;
    },

    appendRuntime(issues, phase) {
      const rows =
        issues && issues.length > 0
          ? issues
          : [{ message: 'A track failed to load its data.', code: 'runtime' }];
      for (const issue of rows) {
        list.append(
          item(
            phase ? `[${phase}] ${issue.message}` : issue.message,
            issue.code ?? 'runtime'
          )
        );
      }
      setSummary(list.childElementCount);
    },
  };
}
