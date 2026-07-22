/**
 * Draggable vertical divider between the editor and preview panes.
 *
 * The split is stored as two `fr` weights (`--left` / `--right`) on the
 * grid container, so it survives window resizes proportionally rather
 * than freezing at a pixel width. The handle is a focusable ARIA
 * separator and is keyboard-operable (Left/Right arrows, Shift for a
 * larger step).
 */
const MIN_PANE_PX = 200;
const SPLITTER_PX = 8;

export function initSplitter(container: HTMLElement, handle: HTMLElement): void {
  // Set the split from a desired left-pane width (px). The two `fr`
  // weights sum to the flexible space (container − splitter), so the grid
  // resolves the left track to exactly `leftPx` while keeping the ratio
  // resize-stable.
  const applyLeftWidth = (leftPx: number, width: number): void => {
    const flexible = width - SPLITTER_PX;
    const left = Math.max(MIN_PANE_PX, Math.min(leftPx, flexible - MIN_PANE_PX));
    const right = flexible - left;
    container.style.setProperty('--left', `${left}fr`);
    container.style.setProperty('--right', `${right}fr`);
    handle.setAttribute('aria-valuenow', String(Math.round((left / flexible) * 100)));
  };

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    container.classList.add('dragging');
    const onMove = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      applyLeftWidth(moveEvent.clientX - rect.left, rect.width);
    };
    const onUp = (upEvent: PointerEvent) => {
      handle.releasePointerCapture(upEvent.pointerId);
      container.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });

  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const leftPane = handle.previousElementSibling as HTMLElement | null;
    const currentLeft = leftPane
      ? leftPane.getBoundingClientRect().width
      : rect.width / 2;
    const step = (event.shiftKey ? 64 : 24) * (event.key === 'ArrowLeft' ? -1 : 1);
    applyLeftWidth(currentLeft + step, rect.width);
  });
}
