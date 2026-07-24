/**
 * `<protvista-track-manager>` — the accessible "Customize layout" panel.
 *
 * A keyboard-navigable list of every track, grouped by adjacency: a group's
 * tracks that stay together render under the group header; a track moved away
 * from its siblings renders on its own as "Group / Track". Every track can be
 * reordered individually (move up/down + drag) and shown/hidden; a group
 * header reorders or hides the whole group. Hidden tracks/groups move to a
 * "Hidden tracks" section so they can be brought back.
 *
 * The panel mutates nothing — each action is emitted as an event the host
 * viewer routes to its layout API (`setTrackOrder` / `setRowVisibility` /
 * `setTrackVisibility` / `resetLayout`), whose state change flows back down as
 * the `layout` property (single source of truth).
 *
 * Accessibility (WCAG 2.1 AA — see specs/track-configurability-design.md):
 * real `<button>`s with names; the toggle adds `aria-pressed` + an action
 * word ("Hide X" / "Show X"), never colour/icon alone; reorder always has a
 * non-drag path (move up/down); a roving-tabindex grid (Up/Down between rows,
 * Left/Right between a row's controls, one tab stop); focus follows a
 * moved/hidden item without scrolling; an `aria-live` region announces each
 * action; targets are ≥ 24×24 px with a visible focus ring.
 */
import { LitElement, html, svg, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import type { NormalizedRow } from './schema/normalize';
import type { ViewerLayout } from './schema/types';
import {
  type Block,
  type TrackEntry,
  isHidden,
  swapIds,
  moveBlock,
  orderedTrackKeys,
  effectiveTracks,
  displayBlocks,
} from './layout';
import { renderLabel } from './tooltips/resolve';

import eyeIcon from './icons/eye.svg';
import eyeSlashIcon from './icons/eye-slash.svg';
import gripIcon from './icons/grip.svg';
import chevronUpIcon from './icons/chevron-up.svg';

// Control (roving/focus/data) keys. One namespace per control kind so a
// track's four controls, a group header's four, and a hidden item never
// collide. Group-header controls key on the block's first track key (a group
// can appear as several partial blocks).
const tHide = (k: string) => `T:${k}`;
const tUp = (k: string) => `U:${k}`;
const tDown = (k: string) => `D:${k}`;
const tGrip = (k: string) => `H:${k}`;
const gHide = (k: string) => `GT:${k}`;
const gUp = (k: string) => `GU:${k}`;
const gDown = (k: string) => `GD:${k}`;
const gGrip = (k: string) => `GH:${k}`;
const show = (k: string) => `S:${k}`;

/** The first (anchor) track key of a display block. */
const blockAnchor = (block: Block): string =>
  block.kind === 'group' ? block.tracks[0].key : block.entry.key;
/** Every track key a block owns (for moving/dragging it as a unit). */
const blockKeys = (block: Block): string[] =>
  block.kind === 'group' ? block.tracks.map((t) => t.key) : [block.entry.key];

@customElement('protvista-track-manager')
export class ProtvistaTrackManager extends LitElement {
  /** Authored rows (the viewer's `config.rows`), in authored order. */
  @property({ attribute: false })
  rows: readonly NormalizedRow[] = [];

  /** Current runtime layout overlay (flat track order + visibility). */
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

  /** Roving grid: focusable control keys per DOM row. Refreshed each render. */
  private _grid: string[][] = [];

  /** Per-render snapshots the reorder handlers read. */
  private _fullKeys: string[] = [];
  private _effective: TrackEntry[] = [];
  private _blocks: Block[] = [];

  /** Track keys currently being dragged (one for a track, many for a block). */
  private _dragKeys: string[] = [];

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
      gap: 0.5rem;
      min-height: 30px;
      padding: 0.1rem 0;
    }

    .row.dragover {
      box-shadow: inset 0 2px 0 var(--protvista-color-accent, #0053d6);
    }

    /* Item 4: every control clustered on the left; the label fills the rest. */
    .controls {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      flex: 0 0 auto;
    }

    .row__label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row--group > .row__label {
      font-weight: 600;
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

  // ── Labels + visibility helpers ─────────────────────────────

  private _labelText(source: string): string {
    const cacheKey = `${this.accession} ${source}`;
    const cached = this._labelTextCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const rendered = renderLabel(source, this.accession || undefined);
    const doc = new DOMParser().parseFromString(rendered, 'text/html');
    const text = (doc.body.textContent || '').trim() || source;
    this._labelTextCache.set(cacheKey, text);
    return text;
  }

  private _hidden(key: string, authored?: boolean): boolean {
    return isHidden(this.layout, key, authored);
  }

  override render() {
    const rows = this.rows as NormalizedRow[];
    const blocks = displayBlocks(rows, this.layout);
    const effective = effectiveTracks(rows, this.layout);
    this._blocks = blocks;
    this._effective = effective;
    this._fullKeys = orderedTrackKeys(rows, this.layout);

    const effIndex = new Map(effective.map((e, i) => [e.key, i]));
    const total = effective.length;

    // Hidden items, unified: a whole hidden group once, a hidden standalone by
    // its row label, and a group's individually-hidden track as "Group / Track".
    const hiddenItems = this._hiddenItems(rows);

    // Build the roving grid (focusable control keys per DOM row).
    const grid: string[][] = [];
    blocks.forEach((block, bi) => {
      if (block.kind === 'group') {
        const anchor = blockAnchor(block);
        const gk = [gHide(anchor)];
        if (bi > 0) gk.push(gUp(anchor));
        if (bi < blocks.length - 1) gk.push(gDown(anchor));
        gk.push(gGrip(anchor));
        grid.push(gk);
        for (const e of block.tracks) grid.push(this._trackKeys(e, effIndex, total));
      } else {
        grid.push(this._trackKeys(block.entry, effIndex, total));
      }
    });
    for (const item of hiddenItems) grid.push([item.key]);
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
          ${blocks.length === 0
            ? html`<p class="empty">All tracks are hidden.</p>`
            : html`<ul class="block-list">
                ${repeat(
                  blocks,
                  (b) => blockAnchor(b) + (b.kind === 'group' ? ':g' : ''),
                  (b, bi) => this._renderBlock(b, bi, effIndex, total, focusKey)
                )}
              </ul>`}
          ${hiddenItems.length > 0
            ? html`<section class="hidden" aria-label="Hidden tracks">
                <div class="hidden__title">
                  <span>Hidden tracks</span>
                  <span class="hidden__badge">${hiddenItems.length}</span>
                </div>
                <ul class="hidden-list">
                  ${repeat(
                    hiddenItems,
                    (item) => item.key,
                    (item) => html`<li>
                      ${this._renderHiddenRow(
                        item.key,
                        item.label,
                        focusKey,
                        item.onShow
                      )}
                    </li>`
                  )}
                </ul>
              </section>`
            : nothing}
        </div>

        <div class="visually-hidden" aria-live="polite">
          ${this._announcement}
        </div>
      </section>
    `;
  }

  private _trackKeys(
    entry: TrackEntry,
    effIndex: Map<string, number>,
    total: number
  ): string[] {
    const ei = effIndex.get(entry.key) ?? 0;
    const keys = [tHide(entry.key)];
    if (ei > 0) keys.push(tUp(entry.key));
    if (ei < total - 1) keys.push(tDown(entry.key));
    keys.push(tGrip(entry.key));
    return keys;
  }

  private _separatedLabel(entry: TrackEntry): string {
    return `${this._labelText(entry.group.label)} / ${this._labelText(
      entry.track.label
    )}`;
  }

  // ── Block / row rendering ───────────────────────────────────

  private _renderBlock(
    block: Block,
    bi: number,
    effIndex: Map<string, number>,
    total: number,
    focusKey: string
  ) {
    if (block.kind === 'single') {
      const { entry } = block;
      // A standalone or a track split out of its group: one track row whose
      // label is the plain track name (standalone) or "Group / Track". A
      // standalone toggles by its row id; a separated track by its track key.
      const label = block.separated
        ? this._separatedLabel(entry)
        : this._labelText(entry.track.label);
      const onToggle = block.separated
        ? () => this._setTrackVisible(entry.group, entry.track, false)
        : () => this._setRowVisible(entry.group, false);
      return html`<li>
        ${this._renderTrackRow(entry, label, onToggle, effIndex, total, focusKey)}
      </li>`;
    }

    const anchor = blockAnchor(block);
    const name = this._labelText(block.group.label);
    return html`<li>
      <div
        class="row row--group"
        @dragover=${this._onDragOver}
        @dragenter=${this._onDragEnter}
        @dragleave=${this._onDragLeave}
        @drop=${(e: DragEvent) => this._onDrop(e, anchor)}
      >
        <span class="controls">
          ${this._toggleBtn(gHide(anchor), name, false, focusKey, () =>
            this._setRowVisible(block.group, false)
          )}
          ${this._moveBtn(
            gUp(anchor),
            `Move ${name} up`,
            bi === 0,
            false,
            focusKey,
            () => this._moveBlockBy(bi, -1)
          )}
          ${this._moveBtn(
            gDown(anchor),
            `Move ${name} down`,
            bi === this._blocks.length - 1,
            true,
            focusKey,
            () => this._moveBlockBy(bi, 1)
          )}
          ${this._gripBtn(gGrip(anchor), `Reorder ${name}`, focusKey, () =>
            blockKeys(block)
          )}
        </span>
        <span class="row__label" title=${name}>${name}</span>
      </div>
      <ul class="track-list">
        ${repeat(
          block.tracks,
          (e) => e.key,
          (e) =>
            html`<li>
              ${this._renderTrackRow(
                e,
                this._labelText(e.track.label),
                () => this._setTrackVisible(e.group, e.track, false),
                effIndex,
                total,
                focusKey
              )}
            </li>`
        )}
      </ul>
    </li>`;
  }

  private _renderTrackRow(
    entry: TrackEntry,
    label: string,
    onToggle: () => void,
    effIndex: Map<string, number>,
    total: number,
    focusKey: string
  ) {
    const key = entry.key;
    const ei = effIndex.get(key) ?? 0;
    return html`
      <div
        class="row"
        @dragover=${this._onDragOver}
        @dragenter=${this._onDragEnter}
        @dragleave=${this._onDragLeave}
        @drop=${(e: DragEvent) => this._onDrop(e, key)}
      >
        <span class="controls">
          ${this._toggleBtn(tHide(key), label, false, focusKey, onToggle)}
          ${this._moveBtn(
            tUp(key),
            `Move ${label} up`,
            ei === 0,
            false,
            focusKey,
            () => this._moveTrackBy(entry, -1)
          )}
          ${this._moveBtn(
            tDown(key),
            `Move ${label} down`,
            ei === total - 1,
            true,
            focusKey,
            () => this._moveTrackBy(entry, 1)
          )}
          ${this._gripBtn(tGrip(key), `Reorder ${label}`, focusKey, () => [key])}
        </span>
        <span class="row__label" title=${label}>${label}</span>
      </div>
    `;
  }

  /** A "Hidden tracks" section row: label + a Show toggle. */
  private _renderHiddenRow(
    key: string,
    label: string,
    focusKey: string,
    onShow: () => void
  ) {
    return html`
      <div class="row">
        <span class="controls">
          ${this._toggleBtn(key, label, true, focusKey, onShow)}
        </span>
        <span class="row__label" title=${label}>${label}</span>
      </div>
    `;
  }

  // ── Control button templates ────────────────────────────────

  private _toggleBtn(
    key: string,
    name: string,
    hidden: boolean,
    focusKey: string,
    onToggle: () => void
  ) {
    const action = hidden ? 'Show' : 'Hide';
    return html`<button
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
    </button>`;
  }

  private _moveBtn(
    key: string,
    label: string,
    disabled: boolean,
    down: boolean,
    focusKey: string,
    onClick: () => void
  ) {
    return html`<button
      type="button"
      class="move"
      data-key=${key}
      aria-label=${label}
      ?disabled=${disabled}
      tabindex=${key === focusKey ? '0' : '-1'}
      @focus=${() => this._setFocusKey(key)}
      @click=${onClick}
    >
      <span class="icon ${down ? 'icon--down' : ''}" aria-hidden="true"
        >${svg`${unsafeHTML(chevronUpIcon)}`}</span
      >
    </button>`;
  }

  private _gripBtn(
    key: string,
    label: string,
    focusKey: string,
    keysToDrag: () => string[]
  ) {
    return html`<button
      type="button"
      class="handle"
      data-key=${key}
      aria-label=${label}
      tabindex=${key === focusKey ? '0' : '-1'}
      draggable="true"
      @focus=${() => this._setFocusKey(key)}
      @dragstart=${(e: DragEvent) => this._onDragStart(e, keysToDrag())}
      @dragend=${this._onDragEnd}
    >
      <span class="icon" aria-hidden="true">${svg`${unsafeHTML(gripIcon)}`}</span>
    </button>`;
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
        nc = Math.min(nc, grid[nr].length - 1);
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
    this._focusKey = grid[nr][nc];
    this._pendingFocusKey = grid[nr][nc];
  };

  private _setFocusKey(key: string) {
    this._focusKey = key;
  }

  /**
   * Keep focus on a control after a host-driven reorder/hide. The host
   * re-renders us with the new `layout` a tick later; focus is applied after
   * that settles (a frame), with `preventScroll` so hiding a track never
   * scrolls the page to the Hidden section. WCAG 2.4.7.
   */
  private _focusAfterSettle(key: string) {
    this._focusKey = key;
    requestAnimationFrame(() => {
      const btn = this.renderRoot.querySelector<HTMLElement>(
        `[data-key="${CSS.escape(key)}"]`
      );
      btn?.focus({ preventScroll: true });
    });
  }

  // ── Reorder ─────────────────────────────────────────────────

  private _moveTrackBy(entry: TrackEntry, dir: -1 | 1) {
    const idx = this._effective.findIndex((e) => e.key === entry.key);
    const nidx = idx + dir;
    if (nidx < 0 || nidx >= this._effective.length) return;
    const newOrder = swapIds(
      this._fullKeys,
      entry.key,
      this._effective[nidx].key
    );
    this._announceMove(this._labelText(entry.track.label), nidx);
    const stays = dir < 0 ? nidx > 0 : nidx < this._effective.length - 1;
    this._focusAfterSettle(
      stays ? (dir < 0 ? tUp(entry.key) : tDown(entry.key)) : tGrip(entry.key)
    );
    this._emitOrder(newOrder);
  }

  private _moveBlockBy(bi: number, dir: -1 | 1) {
    const blocks = this._blocks;
    const nbi = bi + dir;
    if (nbi < 0 || nbi >= blocks.length) return;
    const moving = blockKeys(blocks[bi]);
    const beforeKey =
      dir < 0
        ? blockAnchor(blocks[bi - 1])
        : bi + 2 < blocks.length
          ? blockAnchor(blocks[bi + 2])
          : null;
    const newOrder = moveBlock(this._fullKeys, moving, beforeKey);
    const anchor = blockAnchor(blocks[bi]);
    const label =
      blocks[bi].kind === 'group'
        ? this._labelText((blocks[bi] as { group: NormalizedRow }).group.label)
        : anchor;
    // Announce the block's new position among the blocks.
    this._announcement = `${label} moved to position ${nbi + 1} of ${blocks.length}`;
    const stays = dir < 0 ? nbi > 0 : nbi < blocks.length - 1;
    this._focusAfterSettle(
      stays ? (dir < 0 ? gUp(anchor) : gDown(anchor)) : gGrip(anchor)
    );
    this._emitOrder(newOrder);
  }

  private _onDragStart = (e: DragEvent, keys: string[]) => {
    this._dragKeys = keys;
    e.dataTransfer?.setData('text/plain', keys.join(','));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };

  private _onDragEnd = () => {
    this._dragKeys = [];
    this._clearDragOver();
  };

  private _onDragOver = (e: DragEvent) => {
    if (!this._dragKeys.length) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };

  private _onDragEnter = (e: DragEvent) => {
    if (!this._dragKeys.length) return;
    (e.currentTarget as HTMLElement).classList.add('dragover');
  };

  private _onDragLeave = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('dragover');
  };

  private _clearDragOver() {
    this.renderRoot
      .querySelectorAll('.row.dragover')
      .forEach((el) => el.classList.remove('dragover'));
  }

  private _onDrop = (e: DragEvent, targetKey: string) => {
    e.preventDefault();
    const keys = this._dragKeys.length
      ? this._dragKeys
      : (e.dataTransfer?.getData('text/plain') ?? '').split(',').filter(Boolean);
    this._dragKeys = [];
    this._clearDragOver();
    if (!keys.length || keys.includes(targetKey)) return;
    const newOrder = moveBlock(this._fullKeys, keys, targetKey);
    this._focusAfterSettle(tGrip(keys[0]));
    this._emitOrder(newOrder);
  };

  private _emitOrder(order: string[]) {
    this.dispatchEvent(
      new CustomEvent('track-order-change', {
        detail: { order },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ── Visibility ──────────────────────────────────────────────

  /** Every currently-hidden item, ready for the "Hidden tracks" section. */
  private _hiddenItems(
    rows: NormalizedRow[]
  ): { key: string; label: string; onShow: () => void }[] {
    const items: { key: string; label: string; onShow: () => void }[] = [];
    for (const row of rows) {
      // A standalone row is its own track — keyed by the row id.
      if (row.standalone) {
        if (this._hidden(row.id, row.hidden)) {
          items.push({
            key: show(row.id),
            label: this._labelText(row.tracks[0]?.label ?? row.label),
            onShow: () => this._setRowVisible(row, true),
          });
        }
        continue;
      }
      // A whole hidden group appears once.
      if (this._hidden(row.id, row.hidden)) {
        items.push({
          key: show(row.id),
          label: this._labelText(row.label),
          onShow: () => this._setRowVisible(row, true),
        });
        continue;
      }
      // Otherwise, each individually-hidden track ("Group / Track").
      for (const track of row.tracks) {
        const key = `${row.id}-${track.id}`;
        if (this._hidden(key, track.hidden)) {
          items.push({
            key: show(key),
            label: `${this._labelText(row.label)} / ${this._labelText(track.label)}`,
            onShow: () => this._setTrackVisible(row, track, true),
          });
        }
      }
    }
    return items;
  }

  /** Show/hide a whole lane (a group header or a standalone row) by row id. */
  private _setRowVisible(row: NormalizedRow, visible: boolean) {
    const name = this._labelText(
      row.standalone ? (row.tracks[0]?.label ?? row.label) : row.label
    );
    this._announce(name, visible);
    if (!visible) this._focusAfterSettle(show(row.id));
    this.dispatchEvent(
      new CustomEvent('row-visibility-toggle', {
        detail: { rowId: row.id, visible },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Show/hide one track within a group. */
  private _setTrackVisible(
    group: NormalizedRow,
    track: NormalizedRow['tracks'][number],
    visible: boolean
  ) {
    this._announce(this._labelText(track.label), visible);
    if (!visible) this._focusAfterSettle(show(`${group.id}-${track.id}`));
    this.dispatchEvent(
      new CustomEvent('track-visibility-toggle', {
        detail: { groupId: group.id, trackId: track.id, visible },
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

  private _announceMove(name: string, index: number) {
    this._announcement = `${name} moved to position ${index + 1} of ${this._effective.length}`;
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
