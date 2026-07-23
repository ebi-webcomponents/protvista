/**
 * Draggable vertical divider between the editor and preview panes.
 *
 * The split is stored as two `fr` weights (`--left` / `--right`) on the
 * grid container, so it survives window resizes proportionally rather
 * than freezing at a pixel width. The handle is a focusable ARIA
 * separator, keyboard-operable (Left/Right arrows, Shift for a larger
 * step, Home/End to snap to the bounds).
 */
const MIN_PANE_PX = 200;
const SPLITTER_PX = 8;
// Ratio bounds the handle's aria-valuemin/aria-valuemax advertise (15/85).
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

export function initSplitter(container: HTMLElement, handle: HTMLElement): void {
  // Set the split from a desired left-pane width (px). Clamped by both a
  // pixel floor (usability at any width) and the ratio bounds, so the
  // reported `aria-valuenow` never falls outside [15, 85]. The two `fr`
  // weights sum to the flexible space (container − splitter), keeping the
  // ratio resize-stable.
  const applyLeftWidth = (leftPx: number, width: number): void => {
    const flexible = width - SPLITTER_PX;
    const min = Math.max(MIN_PANE_PX, MIN_RATIO * flexible);
    const max = Math.max(min, Math.min(flexible - MIN_PANE_PX, MAX_RATIO * flexible));
    const left = Math.min(Math.max(leftPx, min), max);
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
    const end = () => {
      container.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
    };
    handle.addEventListener('pointermove', onMove);
    // Fires on pointerup, pointercancel, or any lost capture — so the move
    // listener and the `dragging` state can never leak.
    handle.addEventListener('lostpointercapture', end, { once: true });
  });

  handle.addEventListener('keydown', (event) => {
    const rect = container.getBoundingClientRect();
    const flexible = rect.width - SPLITTER_PX;
    const leftPane = handle.previousElementSibling as HTMLElement | null;
    const currentLeft = leftPane
      ? leftPane.getBoundingClientRect().width
      : flexible / 2;
    const step = event.shiftKey ? 64 : 24;
    switch (event.key) {
      case 'ArrowLeft':
        applyLeftWidth(currentLeft - step, rect.width);
        break;
      case 'ArrowRight':
        applyLeftWidth(currentLeft + step, rect.width);
        break;
      case 'Home':
        applyLeftWidth(0, rect.width); // clamps to the minimum
        break;
      case 'End':
        applyLeftWidth(rect.width, rect.width); // clamps to the maximum
        break;
      default:
        return;
    }
    event.preventDefault();
  });
}
