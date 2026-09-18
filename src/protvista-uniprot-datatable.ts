import {
  LitElement,
  html,
  css,
  nothing,
  unsafeCSS,
  type TemplateResult,
  type PropertyValues,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { tokenRef, tokenDefaultRef } from './styles/tokens.js';
import {
  computeFilteredData,
  computeUniqueValuesByKey,
  getRowId,
  resolvePath,
  safeDisplayValue,
  type Filters,
} from './utils/protvista-uniprot-datatable.js';

export interface ColumnConfig<T extends Record<string, unknown>> {
  label: string;
  key: keyof T | string;
  filterable?: boolean;
  render?: (
    row: T
  ) => TemplateResult | string | number | undefined | null | typeof nothing;
}

/**
 * The pre-token `--protvista-dt-*` override names, still honoured for one
 * major cycle. Each is tried *after* the current token name and *before*
 * the registry default, so an old override keeps working while a new one
 * takes precedence.
 */
const LEGACY_ALIASES: Record<string, string> = {
  '--protvista-datatable-accent': '--protvista-dt-primary',
  '--protvista-datatable-text-head': '--protvista-dt-text-head',
  '--protvista-datatable-text-body': '--protvista-dt-text-body',
  '--protvista-datatable-text-muted': '--protvista-dt-text-muted',
  '--protvista-datatable-text-input': '--protvista-dt-text-input',
  '--protvista-datatable-bg-base': '--protvista-dt-bg-base',
  '--protvista-datatable-bg-header': '--protvista-dt-bg-header',
  '--protvista-datatable-bg-hover': '--protvista-dt-bg-hover',
  '--protvista-datatable-bg-active': '--protvista-dt-bg-active',
  '--protvista-datatable-border': '--protvista-dt-border',
  '--protvista-datatable-border-input': '--protvista-dt-border-input',
  '--protvista-datatable-shadow-header': '--protvista-dt-shadow-header',
};

/**
 * Read a token, carrying its alias and default chain to the point of use.
 *
 * These used to be declared on `:host`, which quietly made them
 * unoverridable: a declaration *on* an element always beats a value
 * *inherited* into it, whatever the specificity, so a consumer's
 * `:root { --protvista-datatable-border: … }` — or even
 * `protvista-uniprot-datatable { … }`, which loses to `:host` on
 * specificity as well — never reached the table. Only an inline style or
 * `!important` got through, contradicting the documented "set it on the
 * element or any ancestor". Declaring nothing and spelling the chain out
 * here puts the resolution at the element that uses the value, where an
 * override from anywhere above wins. See `tokenRef` in styles/tokens.ts;
 * this is the same fix, plus the alias hop.
 */
const t = (name: string) => {
  const alias = LEGACY_ALIASES[name];
  return unsafeCSS(
    alias
      ? `var(${name}, var(${alias}, ${tokenDefaultRef(name)}))`
      : tokenRef(name)
  );
};

@customElement('protvista-uniprot-datatable')
export class ProtvistaUniprotDatatable<
  T extends Record<string, unknown>,
> extends LitElement {
  @property({ attribute: false })
  data: ReadonlyArray<T> = [];

  @property({ attribute: false })
  columns: ReadonlyArray<ColumnConfig<T>> = [];

  @property({ type: String, attribute: 'selected-id' })
  selectedId?: string;

  @property({ type: String, attribute: 'row-id-key' })
  rowIdKey: keyof T | string = 'id';

  @state()
  private filters: Filters = {};

  @state()
  private filteredData: ReadonlyArray<T> = [];

  @state()
  private uniqueValuesByKey: Record<string, string[]> = {};

  @state()
  private focusedRowId?: string;

  private pendingFocusId?: string;

  static override styles = css`
    /* Themable via CSS custom properties. Each --protvista-datatable-*
       token defaults from the shared global tier and falls back to its
       historical literal; the former --protvista-dt-* names are still
       honoured as aliases for one major cycle, so existing overrides keep
       working. None of them is *declared* here — see \`t()\` above for why
       that would make them unoverridable — so every read below carries
       the chain. Consumers can also target structure via ::part(...) —
       see the part="…" attributes in render(). */
    :host {
      display: block;
      width: 100%;
      font-family: ${t('--protvista-font-family')};
    }

    .scroll-container {
      max-height: ${t('--protvista-datatable-max-height')};
      overflow-y: auto;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border: 1px solid ${t('--protvista-datatable-border')};
      background: ${t('--protvista-datatable-bg-base')};
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
      color: ${t('--protvista-datatable-text-body')};
    }

    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: ${t('--protvista-datatable-bg-header')};
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      box-shadow: 0 1px 0 ${t('--protvista-datatable-shadow-header')};
    }

    th {
      text-align: left;
      padding: 0.75rem 0.5rem;
      white-space: nowrap;
      vertical-align: top;
      font-weight: 700;
      color: ${t('--protvista-datatable-text-head')};
    }

    td {
      padding: 0.75rem 0.5rem;
      border-bottom: 1px solid ${t('--protvista-datatable-border')};
      vertical-align: middle;
    }

    tbody tr {
      cursor: pointer;
      transition: background-color 0.15s ease-in-out;
      outline: none;
    }

    tbody tr:hover {
      background-color: ${t('--protvista-datatable-bg-hover')};
    }

    tbody tr:focus-visible {
      background-color: ${t('--protvista-datatable-bg-hover')};
      outline: 2px solid ${t('--protvista-datatable-accent')};
      outline-offset: -2px;
      position: relative;
      z-index: 1;
    }

    tbody tr.active {
      background-color: ${t('--protvista-datatable-bg-active')};
      box-shadow: inset 4px 0 0 ${t('--protvista-datatable-accent')};
    }

    .header-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    select {
      display: block;
      padding: 0.4rem;
      font-size: 0.85rem;
      width: 100%;
      border: 1px solid ${t('--protvista-datatable-border-input')};
      border-radius: ${t('--protvista-radius')};
      background-color: ${t('--protvista-datatable-bg-base')};
      color: ${t('--protvista-datatable-text-input')};
    }

    select:focus {
      outline: 2px solid ${t('--protvista-datatable-accent')};
      border-color: ${t('--protvista-datatable-accent')};
    }

    .no-results {
      text-align: center;
      padding: 3rem;
      color: ${t('--protvista-datatable-text-muted')};
      font-style: italic;
    }

    /* Utility classes for link content rendered into cells (e.g. the
       structure component's Source / Foldseek links). They live here,
       not in the caller, because cell content renders inside this
       shadow root where the caller's global stylesheet cannot reach. */
    .cell-link {
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .cell-link__icon {
      display: inline-flex;
      width: 0.9em;
      height: 0.9em;
    }

    .cell-link__icon--sm {
      width: 0.8em;
      height: 0.8em;
    }
  `;

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('data') || changed.has('columns')) {
      this.uniqueValuesByKey = computeUniqueValuesByKey(
        this.data,
        this.columns.map((c) => ({
          key: String(c.key),
          filterable: c.filterable,
        }))
      );
    }

    if (changed.has('data') || changed.has('filters')) {
      this.filteredData = computeFilteredData(this.data, this.filters);

      if (this.selectedId) {
        const idStillExists = this.filteredData.some(
          (r) => getRowId(r, this.rowIdKey) === this.selectedId
        );
        if (!idStillExists) {
          this.selectedId = undefined;
        }
      }

      if (this.focusedRowId) {
        const focusStillExists = this.filteredData.some(
          (r) => getRowId(r, this.rowIdKey) === this.focusedRowId
        );
        if (!focusStillExists) {
          this.focusedRowId = undefined;
        }
      }
    }

    if (changed.has('selectedId')) {
      const hasFocus = this.matches(':focus-within');
      if (!hasFocus) {
        this.focusedRowId = this.selectedId;
      }
    }
  }

  protected override updated(changed: PropertyValues) {
    if (
      (changed.has('filters') ||
        changed.has('data') ||
        changed.has('selectedId')) &&
      this.filteredData.length &&
      this.matches(':focus-within')
    ) {
      const focusable =
        this.renderRoot.querySelector<HTMLTableRowElement>(
          'tbody tr[tabindex="0"]'
        ) ??
        this.renderRoot.querySelector<HTMLTableRowElement>('tbody tr[data-id]');
      focusable?.focus();
    }
  }

  private dispatchRowClick(row: T) {
    this.dispatchEvent(
      new CustomEvent<T>('row-click', {
        detail: row,
        bubbles: true,
        composed: true,
      })
    );
  }

  private focusRowById(id: string) {
    this.focusedRowId = id;
    this.pendingFocusId = id;

    void this.updateComplete.then(() => {
      if (this.pendingFocusId !== id) return;

      const tr = this.renderRoot.querySelector<HTMLTableRowElement>(
        `tbody tr[data-id="${CSS.escape(id)}"]`
      );
      const activeEl = (this.shadowRoot?.activeElement ||
        document.activeElement) as HTMLElement | null;

      if (tr && activeEl !== tr) tr.focus();
    });
  }

  private getFocusIndex(rows: ReadonlyArray<T>): number {
    if (!rows.length) return -1;

    if (this.focusedRowId) {
      const idx = rows.findIndex(
        (r) => getRowId(r, this.rowIdKey) === this.focusedRowId
      );
      if (idx !== -1) return idx;
    }

    if (this.selectedId) {
      const idx = rows.findIndex(
        (r) => getRowId(r, this.rowIdKey) === this.selectedId
      );
      if (idx !== -1) return idx;
    }

    return 0;
  }

  private moveFocus(nextIndex: number) {
    const rows = this.filteredData;
    if (nextIndex < 0 || nextIndex >= rows.length) return;

    const row = rows[nextIndex];
    const id = getRowId(row, this.rowIdKey);
    if (!id) return;

    this.focusRowById(id);
  }

  private selectCurrentFocus() {
    const rows = this.filteredData;
    const currentIdx = this.getFocusIndex(rows);
    if (currentIdx === -1) return;

    const row = rows[currentIdx];
    const id = getRowId(row, this.rowIdKey);
    if (!id) return;

    this.selectedId = id;
    this.focusedRowId = id;
    this.dispatchRowClick(row);
  }

  private onTBodyClick = (e: Event) => {
    const tr = e
      .composedPath()
      .find((n) => n instanceof HTMLTableRowElement) as
      | HTMLTableRowElement
      | undefined;

    const id = tr?.dataset?.id;
    if (!id) return;

    const row = this.filteredData.find(
      (r) => getRowId(r, this.rowIdKey) === id
    );
    if (!row) return;

    this.selectedId = id;
    this.focusedRowId = id;
    this.dispatchRowClick(row);

    const activeEl = (this.shadowRoot?.activeElement ||
      document.activeElement) as HTMLElement | null;
    if (activeEl !== tr) tr?.focus();
  };

  private onTBodyKeyDown = (e: KeyboardEvent) => {
    const rows = this.filteredData;
    if (!rows.length) return;

    const current = this.getFocusIndex(rows);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.moveFocus(Math.min(current + 1, rows.length - 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        this.moveFocus(Math.max(current - 1, 0));
        return;
      case 'Home':
        e.preventDefault();
        this.moveFocus(0);
        return;
      case 'End':
        e.preventDefault();
        this.moveFocus(rows.length - 1);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.selectCurrentFocus();
        return;
      default:
        return;
    }
  };

  private onFilterChange = (e: Event) => {
    e.stopPropagation();
    const select = e.currentTarget as HTMLSelectElement;
    const key = select.dataset['key'];
    if (!key) return;

    const value = select.value;
    const nextFilters = { ...this.filters };

    if (!value) delete nextFilters[key];
    else nextFilters[key] = value;

    this.filters = nextFilters;
    this.focusedRowId = undefined;
    this.pendingFocusId = undefined;
  };

  private onFilterClick = (e: Event) => {
    e.stopPropagation();
  };

  private renderCell(col: ColumnConfig<T>, row: T) {
    if (col.render) return col.render(row) ?? nothing;
    const val = resolvePath(row, String(col.key));
    return safeDisplayValue(val);
  }

  private renderFilterDropdown(col: ColumnConfig<T>) {
    if (!col.filterable) return nothing;

    const key = String(col.key);
    const options = this.uniqueValuesByKey[key] ?? [];

    return html`
      <select
        part="filter-select"
        aria-label=${ifDefined(
          col.label ? `Filter by ${col.label}` : undefined
        )}
        data-key=${key}
        .value=${this.filters[key] ?? ''}
        @change=${this.onFilterChange}
        @click=${this.onFilterClick}
      >
        <option value="">All</option>
        ${options.map((val) => html`<option value=${val}>${val}</option>`)}
      </select>
    `;
  }

  private renderNoResults() {
    return html`
      <tr>
        <td colspan=${this.columns.length} class="no-results" part="no-results">
          No matching results found
        </td>
      </tr>
    `;
  }

  override render() {
    return html`
      <div class="scroll-container" part="scroll-container">
        <table part="table">
          <thead part="header">
            <tr>
              ${this.columns.map(
                (col) => html`
                  <th scope="col" part="header-cell">
                    <div class="header-content">
                      <span>${col.label}</span>
                      ${this.renderFilterDropdown(col)}
                    </div>
                  </th>
                `
              )}
            </tr>
          </thead>

          <tbody
            role="listbox"
            aria-label="Results"
            @click=${this.onTBodyClick}
            @keydown=${this.onTBodyKeyDown}
          >
            ${repeat(
              this.filteredData,
              (row, index) => getRowId(row, this.rowIdKey) || String(index),
              (row, index) => {
                const id = getRowId(row, this.rowIdKey);
                const isSelected = id === this.selectedId;

                const isFocusable = this.focusedRowId
                  ? id === this.focusedRowId
                  : this.selectedId
                    ? id === this.selectedId
                    : index === 0;

                return html`
                  <tr
                    data-id=${id || ''}
                    class=${isSelected ? 'active' : ''}
                    part=${isSelected ? 'row row-active' : 'row'}
                    role="option"
                    aria-selected=${isSelected ? 'true' : 'false'}
                    tabindex=${isFocusable ? '0' : '-1'}
                  >
                    ${this.columns.map(
                      (col) => html`<td part="cell">${this.renderCell(col, row)}</td>`
                    )}
                  </tr>
                `;
              }
            )}
            ${this.filteredData.length === 0 ? this.renderNoResults() : nothing}
          </tbody>
        </table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protvista-uniprot-datatable': ProtvistaUniprotDatatable<
      Record<string, unknown>
    >;
  }
}

export default ProtvistaUniprotDatatable;
