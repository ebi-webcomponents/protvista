/**
 * `<protvista-track-manager>` — the accessible "Customize layout" panel.
 *
 * A plain, keyboard-navigable list of every row (lane) in the viewer. Each
 * visible lane carries reorder controls (a drag handle plus move-up /
 * move-down buttons) and a show/hide toggle; group lanes expand to list
 * their child tracks so individual tracks can be hidden too. Hidden
 * lanes/tracks move to a "Hidden tracks" section so they can be brought back
 * (hide is reversible, not deletion). This list is the accessible source of
 * truth the canvas mirrors: it mutates nothing itself — every action is
 * emitted as an event the host viewer routes to its layout API.
 *
 * Accessibility (WCAG 2.1 AA — see specs/track-configurability-design.md):
 *   - real `<button>`s with accessible names; the toggle adds `aria-pressed`
 *     plus an action word ("Hide X" / "Show X"), never icon/colour alone
 *     (1.4.1, 4.1.2);
 *   - reorder always has a non-drag path — move-up / move-down buttons —
 *     alongside pointer drag-and-drop (2.5.7);
 *   - a roving-tabindex grid keyboard model: Up/Down move between rows,
 *     Left/Right between a row's controls, one tab stop for the whole list
 *     (2.1.1); focus follows a moved/hidden item (2.4.7);
 *   - an `aria-live` region announces each reorder / hide / show (4.1.3);
 *   - targets are ≥ 24×24 px with a visible `:focus-visible` ring;
 *   - drag styling avoids motion under `prefers-reduced-motion`.
 */
import { LitElement, html, svg, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import type { NormalizedRow, NormalizedTrack } from './schema/normalize';
import type { ViewerLayout } from './schema/types';
import { orderRows, isHidden, swapIds, moveId } from './layout';
import { renderLabel } from './tooltips/resolve';

import eyeIcon from './icons/eye.svg';
import eyeSlashIcon from './icons/eye-slash.svg';
import gripIcon from './icons/grip.svg';
import chevronUpIcon from './icons/chevron-up.svg';

// Roving/focus keys — one namespace per control kind so a lane's four
// controls (and each track's toggle) never collide.
const laneKey = (rowId: string): string => `L:${rowId}`;
const trackKey = (groupId: string, trackId: string): string =>
  `T:${groupId}:${trackId}`;
const upKey = (rowId: string): string => `U:${rowId}`;
const downKey = (rowId: string): string => `D:${rowId}`;
const handleKey = (rowId: string): string => `H:${rowId}`;

@customElement('protvista-track-manager')
export class ProtvistaTrackManager extends LitElement {
  /** Authored rows (the viewer's `config.rows`), in authored order. */
  @property({ attribute: false })
  rows: readonly NormalizedRow[] = [];

  /** Current runtime layout overlay (row order + visibility). */
  @property({ attribute: false })
  layout: ViewerLayout = { order: null, hidden: {} };

  /** Accession, for `{accession}` interpolation in Markdoc labels. */
  @property({ type: String })
  accession = '';

  /** The control that currently carries `tabindex="0"` (roving cursor). */
  @state()
  private _focusKey?: string;

  /** Live-region text announced after a reorder/hide/show/reset. */
  @state()
  private _announcement = '';

  /** Set by an action to re-focus a control after the next render. */
  private _pendingFocusKey?: string;

  /**
   * The roving grid: rows of focusable control keys in DOM order. Up/Down
   * move between the outer arrays, Left/Right within one. Refreshed each
   * render so it always matches what is on screen.
   */
  private _grid: string[][] = [];

  /** The lane id currently being dragged (HTML5 DnD), if any. */
  private _dragId?: string;

  /** Memo for plain-text label extraction (Markdoc → text). */
  private _labelTextCache = new Map<string, string>();

  static override styles = css`
    :host {
      display: block;
      font-family: var(--protvista-font-family, inherit);
      font-size: var(--protvista-font-size, 0.8rem);
      color: var(--protvista-color-text, #222222);
    }

    .panel {
      border: 1px solid var(--protvista-color-border, #c5c8cc);
      border-radius: var(--protvista-radius, 4px);
      background: var(--protvista-color-surface, #ffffff);
      padding: 0.75rem 1rem 1rem;
      margin: 0 0 0.5rem;
    }

    .panel__head {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .panel__title {
      font-weight: 600;
      font-size: 1rem;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .track-list {
      margin-left: 1.75rem;
      border-left: 2px solid var(--protvista-color-border, #c5c8cc);
      padding-left: 0.5rem;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 30px;
      padding: 0.1rem 0;
    }

    .row.dragover {
      box-shadow: inset 0 2px 0 var(--protvista-color-accent, #0053d6);
    }

    .row__label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .controls {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      flex: 0 0 auto;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      min-height: 24px;
      min-width: 24px;
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--protvista-color-border, #c5c8cc);
      border-radius: var(--protvista-radius, 4px);
      background: var(--protvista-color-surface, #ffffff);
      color: var(--protvista-color-text, #222222);
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      background: var(--protvista-color-bg-hover, #f1f7ff);
    }

    button:focus-visible {
      outline: 2px solid var(--protvista-color-accent, #0053d6);
      outline-offset: 2px;
    }

    button:disabled {
      color: var(--protvista-color-disabled, #808080);
      cursor: default;
    }

    .handle {
      cursor: grab;
    }

    .icon {
      display: inline-flex;
    }

    .icon svg {
      width: 16px;
      height: 16px;
    }

    .icon--down svg {
      transform: rotate(180deg);
    }

    .toggle[aria-pressed='true'] {
      color: var(--protvista-color-text-muted, #4a5056);
    }

    .hidden {
      margin-top: 0.75rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--protvista-color-border, #c5c8cc);
    }

    .hidden__title {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-weight: 600;
      color: var(--protvista-color-text-muted, #4a5056);
      margin-bottom: 0.25rem;
    }

    .hidden__badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      height: 1.25rem;
      padding: 0 0.35rem;
      border-radius: 999px;
      background: var(--protvista-color-accent, #0053d6);
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .empty {
      color: var(--protvista-color-text-muted, #4a5056);
      font-style: italic;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
    }
  `;

  /** Markdoc label → plain text, for accessible names and the visible label. */
  private _labelText(source: string): string {
    const cacheKey = `${this.accession} ${source}`;
    const cached = this._labelTextCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const rendered = renderLabel(source, this.accession || undefined);
    // renderLabel already sanitizes; parse (never executes) to strip tags.
    const doc = new DOMParser().parseFromString(rendered, 'text/html');
    const text = (doc.body.textContent || '').trim() || source;
    this._labelTextCache.set(cacheKey, text);
    return text;
  }

  private _hidden(key: string, authored?: boolean): boolean {
    return isHidden(this.layout, key, authored);
  }

  override render() {
    const ordered = orderRows(this.rows as NormalizedRow[], this.layout.order);
    const visibleLanes = ordered.filter((r) => !this._hidden(r.id, r.hidden));
    const hiddenLanes = ordered.filter((r) => this._hidden(r.id, r.hidden));

    // Hidden child tracks live under currently-visible group lanes.
    const hiddenTracks: { group: NormalizedRow; track: NormalizedTrack }[] = [];
    for (const g of visibleLanes) {
      if (g.standalone) continue;
      for (const t of g.tracks) {
        if (this._hidden(`${g.id}-${t.id}`, t.hidden)) {
          hiddenTracks.push({ group: g, track: t });
        }
      }
    }
    const hiddenCount = hiddenLanes.length + hiddenTracks.length;

    // Build the roving grid (focusable control keys, per DOM row) alongside
    // the template so navigation always matches what is shown.
    const grid: string[][] = [];
    const total = visibleLanes.length;
    visibleLanes.forEach((g, i) => {
      const laneCtls = [handleKey(g.id)];
      if (i > 0) laneCtls.push(upKey(g.id));
      if (i < total - 1) laneCtls.push(downKey(g.id));
      laneCtls.push(laneKey(g.id));
      grid.push(laneCtls);
      if (!g.standalone) {
        for (const t of g.tracks) {
          if (!this._hidden(`${g.id}-${t.id}`, t.hidden)) {
            grid.push([trackKey(g.id, t.id)]);
          }
        }
      }
    });
    for (const g of hiddenLanes) grid.push([laneKey(g.id)]);
    for (const { group, track } of hiddenTracks) {
      grid.push([trackKey(group.id, track.id)]);
    }
    this._grid = grid;
    const allKeys = grid.flat();
    const focusKey =
      this._focusKey && allKeys.includes(this._focusKey)
        ? this._focusKey
        : allKeys[0];

    return html`
      <section class="panel" aria-label="Customize layout">
        <div class="panel__head">
          <span class="panel__title">Customize layout</span>
          <button type="button" class="reset" @click=${this._onReset}>
            Reset to default
          </button>
        </div>

        <div class="lists" @keydown=${this._onKeyDown}>
          ${visibleLanes.length === 0
            ? html`<p class="empty">All tracks are hidden.</p>`
            : html`
                <ul class="lane-list">
                  ${repeat(
                    visibleLanes,
                    (g) => g.id,
                    (g, i) => this._renderLane(g, i, total, focusKey)
                  )}
                </ul>
              `}
          ${hiddenCount > 0
            ? html`
                <section class="hidden" aria-label="Hidden tracks">
                  <div class="hidden__title">
                    <span>Hidden tracks</span>
                    <span class="hidden__badge">${hiddenCount}</span>
                  </div>
                  <ul class="hidden-list">
                    ${repeat(
                      hiddenLanes,
                      (g) => `hid-${g.id}`,
                      (g) => html`<li>
                        ${this._renderToggleRow(
                          laneKey(g.id),
                          this._labelText(g.label),
                          true,
                          focusKey,
                          () => this._toggleRow(g)
                        )}
                      </li>`
                    )}
                    ${repeat(
                      hiddenTracks,
                      (h) => `hidt-${h.group.id}-${h.track.id}`,
                      (h) => html`<li>
                        ${this._renderToggleRow(
                          trackKey(h.group.id, h.track.id),
                          `${this._labelText(h.group.label)} / ${this._labelText(
                            h.track.label
                          )}`,
                          true,
                          focusKey,
                          () => this._toggleTrack(h.group, h.track)
                        )}
                      </li>`
                    )}
                  </ul>
                </section>
              `
            : nothing}
        </div>

        <div class="visually-hidden" aria-live="polite">
          ${this._announcement}
        </div>
      </section>
    `;
  }

  private _renderLane(
    g: NormalizedRow,
    index: number,
    total: number,
    focusKey: string
  ) {
    const name = this._labelText(g.label);
    const childTracks = g.standalone
      ? []
      : g.tracks.filter((t) => !this._hidden(`${g.id}-${t.id}`, t.hidden));
    return html`
      <li>
        <div
          class="row"
          @dragover=${this._onDragOver}
          @dragenter=${this._onDragEnter}
          @dragleave=${this._onDragLeave}
          @drop=${(e: DragEvent) => this._onDrop(e, g)}
        >
          <button
            type="button"
            class="handle"
            data-key=${handleKey(g.id)}
            aria-label="Reorder ${name}"
            tabindex=${handleKey(g.id) === focusKey ? '0' : '-1'}
            draggable="true"
            @focus=${() => this._setFocusKey(handleKey(g.id))}
            @dragstart=${(e: DragEvent) => this._onDragStart(e, g)}
            @dragend=${this._onDragEnd}
          >
            <span class="icon" aria-hidden="true"
              >${svg`${unsafeHTML(gripIcon)}`}</span
            >
          </button>
          <span class="row__label" title=${name}>${name}</span>
          <span class="controls">
            <button
              type="button"
              class="move-up"
              data-key=${upKey(g.id)}
              aria-label="Move ${name} up"
              ?disabled=${index === 0}
              tabindex=${upKey(g.id) === focusKey ? '0' : '-1'}
              @focus=${() => this._setFocusKey(upKey(g.id))}
              @click=${() => this._move(g, -1)}
            >
              <span class="icon" aria-hidden="true"
                >${svg`${unsafeHTML(chevronUpIcon)}`}</span
              >
            </button>
            <button
              type="button"
              class="move-down"
              data-key=${downKey(g.id)}
              aria-label="Move ${name} down"
              ?disabled=${index === total - 1}
              tabindex=${downKey(g.id) === focusKey ? '0' : '-1'}
              @focus=${() => this._setFocusKey(downKey(g.id))}
              @click=${() => this._move(g, 1)}
            >
              <span class="icon icon--down" aria-hidden="true"
                >${svg`${unsafeHTML(chevronUpIcon)}`}</span
              >
            </button>
            ${this._toggleButton(laneKey(g.id), name, false, focusKey, () =>
              this._toggleRow(g)
            )}
          </span>
        </div>
        ${childTracks.length > 0
          ? html`<ul class="track-list">
              ${repeat(
                childTracks,
                (t) => t.id,
                (t) => html`<li>
                  ${this._renderToggleRow(
                    trackKey(g.id, t.id),
                    this._labelText(t.label),
                    false,
                    focusKey,
                    () => this._toggleTrack(g, t)
                  )}
                </li>`
              )}
            </ul>`
          : nothing}
      </li>
    `;
  }

  /** A label + a lone show/hide toggle (child tracks and hidden items). */
  private _renderToggleRow(
    key: string,
    name: string,
    hidden: boolean,
    focusKey: string,
    onToggle: () => void
  ) {
    return html`
      <div class="row">
        <span class="row__label" title=${name}>${name}</span>
        <span class="controls">
          ${this._toggleButton(key, name, hidden, focusKey, onToggle)}
        </span>
      </div>
    `;
  }

  /** The show/hide toggle. `hidden` is the item's current state. */
  private _toggleButton(
    key: string,
    name: string,
    hidden: boolean,
    focusKey: string,
    onToggle: () => void
  ) {
    const action = hidden ? 'Show' : 'Hide';
    return html`
      <button
        type="button"
        class="toggle"
        data-key=${key}
        aria-pressed=${hidden ? 'true' : 'false'}
        aria-label="${action} ${name}"
        tabindex=${key === focusKey ? '0' : '-1'}
        @click=${onToggle}
        @focus=${() => this._setFocusKey(key)}
      >
        <span class="icon" aria-hidden="true"
          >${svg`${unsafeHTML(hidden ? eyeSlashIcon : eyeIcon)}`}</span
        >
        <span aria-hidden="true">${action}</span>
      </button>
    `;
  }

  // ── Keyboard (roving-tabindex grid) ─────────────────────────

  private _onKeyDown = (e: KeyboardEvent) => {
    const grid = this._grid;
    if (!grid.length) return;
    const cur =
      this._focusKey && grid.flat().includes(this._focusKey)
        ? this._focusKey
        : grid[0][0];
    let r = 0;
    let c = 0;
    for (let i = 0; i < grid.length; i++) {
      const j = grid[i].indexOf(cur);
      if (j !== -1) {
        r = i;
        c = j;
        break;
      }
    }
    let nr = r;
    let nc = c;
    switch (e.key) {
      case 'ArrowDown':
        nr = Math.min(r + 1, grid.length - 1);
        nc = Math.min(nc, grid[nr].length - 1); // keep column, clamp
        break;
      case 'ArrowUp':
        nr = Math.max(r - 1, 0);
        nc = Math.min(nc, grid[nr].length - 1);
        break;
      case 'ArrowRight':
        nc = Math.min(c + 1, grid[r].length - 1);
        break;
      case 'ArrowLeft':
        nc = Math.max(c - 1, 0);
        break;
      case 'Home':
        nr = 0;
        nc = 0;
        break;
      case 'End':
        nr = grid.length - 1;
        nc = 0;
        break;
      default:
        return;
    }
    e.preventDefault();
    this._moveFocus(grid[nr][nc]);
  };

  private _setFocusKey(key: string) {
    this._focusKey = key;
  }

  /**
   * Point the roving cursor at `key` and focus it after the next render.
   * For same-order moves (keyboard navigation) the synchronous `updated()`
   * hook does the focusing within `updateComplete`.
   */
  private _moveFocus(key: string) {
    this._focusKey = key;
    this._pendingFocusKey = key;
  }

  /**
   * Keep focus on a control after an action that reorders/hides via the
   * host (reorder, show/hide). The host re-renders us with the new
   * `layout` in a later tick, so focus is applied after that settles
   * (a frame) — a synchronous focus would land on the pre-change DOM and
   * be dropped when the keyed rows move. WCAG 2.4.7.
   */
  private _focusAfterSettle(key: string) {
    this._focusKey = key; // roving cursor follows immediately
    requestAnimationFrame(() => {
      const btn = this.renderRoot.querySelector<HTMLElement>(
        `[data-key="${CSS.escape(key)}"]`
      );
      // preventScroll: hiding a track moves focus to its control in the
      // Hidden section at the bottom; without this the page would scroll
      // down to it. Focus still follows the item (WCAG 2.4.7), silently.
      btn?.focus({ preventScroll: true });
    });
  }

  // ── Reorder (move buttons + drag-and-drop) ──────────────────

  private _move(g: NormalizedRow, dir: -1 | 1) {
    const ordered = orderRows(this.rows as NormalizedRow[], this.layout.order);
    const visible = ordered.filter((r) => !this._hidden(r.id, r.hidden));
    const vi = visible.findIndex((r) => r.id === g.id);
    const nvi = vi + dir;
    if (nvi < 0 || nvi >= visible.length) return;
    const newOrder = swapIds(
      ordered.map((r) => r.id),
      g.id,
      visible[nvi].id
    );
    this._announceMove(this._labelText(g.label), nvi, visible.length);
    // Keep focus on the pressed control when it stays enabled at the new
    // position, else fall back to the always-present drag handle.
    const stays =
      dir < 0 ? nvi > 0 : nvi < visible.length - 1;
    this._focusAfterSettle(
      stays ? (dir < 0 ? upKey(g.id) : downKey(g.id)) : handleKey(g.id)
    );
    this._emitOrder(newOrder);
  }

  private _onDragStart = (e: DragEvent, g: NormalizedRow) => {
    this._dragId = g.id;
    e.dataTransfer?.setData('text/plain', g.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };

  private _onDragEnd = () => {
    this._dragId = undefined;
    this._clearDragOver();
  };

  private _onDragOver = (e: DragEvent) => {
    if (!this._dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };

  private _onDragEnter = (e: DragEvent) => {
    if (!this._dragId) return;
    const row = (e.currentTarget as HTMLElement).closest('.row');
    row?.classList.add('dragover');
  };

  private _onDragLeave = (e: DragEvent) => {
    const row = (e.currentTarget as HTMLElement).closest('.row');
    row?.classList.remove('dragover');
  };

  private _clearDragOver() {
    this.renderRoot
      .querySelectorAll('.row.dragover')
      .forEach((el) => el.classList.remove('dragover'));
  }

  private _onDrop = (e: DragEvent, target: NormalizedRow) => {
    e.preventDefault();
    const draggedId =
      this._dragId ?? e.dataTransfer?.getData('text/plain') ?? '';
    this._dragId = undefined;
    this._clearDragOver();
    if (!draggedId || draggedId === target.id) return;
    const ordered = orderRows(this.rows as NormalizedRow[], this.layout.order);
    if (!ordered.some((r) => r.id === draggedId)) return;
    const newOrder = moveId(
      ordered.map((r) => r.id),
      draggedId,
      target.id
    );
    // Announce the dragged lane's new position among the visible lanes.
    const nextVisible = newOrder.filter((id) => {
      const row = ordered.find((r) => r.id === id);
      return row && !this._hidden(row.id, row.hidden);
    });
    const dragged = ordered.find((r) => r.id === draggedId)!;
    this._announceMove(
      this._labelText(dragged.label),
      nextVisible.indexOf(draggedId),
      nextVisible.length
    );
    this._focusAfterSettle(handleKey(draggedId));
    this._emitOrder(newOrder);
  };

  private _emitOrder(order: string[]) {
    this.dispatchEvent(
      new CustomEvent('row-order-change', {
        detail: { order },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ── Visibility ──────────────────────────────────────────────

  private _toggleRow(g: NormalizedRow) {
    const visible = this._hidden(g.id, g.hidden); // toggling: hidden → show
    this._announce(this._labelText(g.label), visible);
    this._focusAfterSettle(laneKey(g.id));
    this.dispatchEvent(
      new CustomEvent('row-visibility-toggle', {
        detail: { rowId: g.id, visible },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _toggleTrack(g: NormalizedRow, t: NormalizedTrack) {
    const visible = this._hidden(`${g.id}-${t.id}`, t.hidden);
    this._announce(this._labelText(t.label), visible);
    this._focusAfterSettle(trackKey(g.id, t.id));
    this.dispatchEvent(
      new CustomEvent('track-visibility-toggle', {
        detail: { groupId: g.id, trackId: t.id, visible },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onReset = () => {
    this._announcement = 'Layout reset to the authored default';
    this.dispatchEvent(
      new CustomEvent('reset-layout', { bubbles: true, composed: true })
    );
  };

  private _announce(name: string, visible: boolean) {
    this._announcement = `${name} ${visible ? 'shown' : 'hidden'}`;
  }

  private _announceMove(name: string, index: number, total: number) {
    this._announcement = `${name} moved to position ${index + 1} of ${total}`;
  }

  protected override updated() {
    if (!this._pendingFocusKey) return;
    const key = this._pendingFocusKey;
    this._pendingFocusKey = undefined;
    const btn = this.renderRoot.querySelector<HTMLElement>(
      `[data-key="${CSS.escape(key)}"]`
    );
    btn?.focus({ preventScroll: true });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protvista-track-manager': ProtvistaTrackManager;
  }
}
