/**
 * floatingLayer.ts — the DOM glue that puts a tooltip, popover or menu on screen (BAR-F1-03).
 *
 * `computePosition` (floating.ts) knows the geometry; this action knows the page. It does
 * three things to the element it is put on:
 *
 *  1. **Moves it out of the component tree**, to the end of `<body>` — or, when the trigger is
 *     inside a *modal* `<dialog>`, into that dialog. A floating layer has to sit above the
 *     window host (z 200), but the host is `position: fixed` with a z-index, i.e. its own
 *     stacking context: nothing rendered *inside* a window can climb out of it, however high
 *     its z-index. Rendered at the body, the layer's `--fusion-z-tooltip` / `--fusion-z-menu`
 *     is compared with the host's, which is the whole point of the scale (spec 11
 *     REQ-UIF-008). A modal `<dialog>` (`showModal()`) lives in the browser's top layer, above
 *     everything outside it, so a layer opened from inside one has to stay inside it. A
 *     non-modal `<dialog open>` is just a box in the page — the app's token and file-picker
 *     dialogs are, centred with a `transform` — and the body is the right place for those: a
 *     `transform` makes its element the containing block of `position: fixed` children, which
 *     would skew every coordinate computed against the viewport.
 *     Which dialog is decided by where the *trigger* is, not by where the component was
 *     written: `<Tooltip anchor={button}>` may sit anywhere in the markup.
 *     Known limit: a modal dialog that is itself restyled with a `transform` clips its
 *     children to its own box (`overflow`), so a layer hosted inside one is cut at the dialog's
 *     edge. The app has none today (its modal dialogs use `showModal()` unstyled; the transformed
 *     ones are non-modal and so are bypassed). The placement stays right regardless.
 *  2. **Places it** beside the anchor, or at the pointer, with the collision rules of
 *     `computePosition`, and only then makes it visible — so it is never seen at the corner
 *     before it jumps to its spot, and it is focusable as soon as the action returns. Inside a
 *     dialog it also checks where it actually landed and compensates, because a modal dialog
 *     restyled with a transform (or filter, or contain) would otherwise offset it by the
 *     dialog's own origin.
 *  3. **Keeps it placed** when the viewport resizes, when something scrolls, and when its own
 *     size changes (an expanded tooltip is wider than the short one).
 *
 * The element is expected to be `position: fixed; left: 0; top: 0; visibility: hidden;
 * width: max-content` in its own stylesheet. `width: max-content` matters: a fixed box that
 * shrink-wraps to the room beside it would change size as it moves, and the measurement
 * taken here would be wrong the moment it was applied.
 */

import { computePosition, type Placement } from "./floating.js";

export interface FloatingLayerOptions {
  /** The trigger to sit beside. */
  anchor?: HTMLElement | null | undefined;
  /** A viewport point (a right-click). When given it wins over the anchor. */
  point?: { x: number; y: number } | null | undefined;
  placement?: Placement | undefined;
  /** Gap to the anchor. Default 6; a menu opened at the pointer wants 0. */
  offset?: number | undefined;
  padding?: number | undefined;
}

export interface FloatingLayerAction {
  update(options: FloatingLayerOptions): void;
  destroy(): void;
}

/**
 * The modal `<dialog>` around `origin`, if any. A non-modal one is not a host: it is a box in
 * the page, and the body clears it with room to spare.
 */
function modalDialogAround(origin: HTMLElement): HTMLElement | null {
  const dialog = origin.closest("dialog");
  if (dialog === null) return null;
  try {
    return dialog.matches(":modal") ? dialog : null;
  } catch {
    // A browser without `:modal` cannot say. Staying inside is what a modal needs, and the
    // placement below compensates for whatever the dialog does to its children.
    return dialog;
  }
}

export function floatingLayer(
  node: HTMLElement,
  initial: FloatingLayerOptions,
): FloatingLayerAction {
  let options = initial;
  const doc = document;
  const win = doc.defaultView ?? window;

  // 1. Out of the component tree. The trigger decides where (a layer written outside a modal
  //    dialog may belong to a button inside it); a pointer menu with no trigger falls back to
  //    where the layer itself sits, looked up before the move.
  const host = modalDialogAround(initial.anchor ?? node) ?? doc.body;
  host.appendChild(node);
  const inDialog = host !== doc.body;

  // 2. Place and reveal.
  function reposition(): void {
    const box = node.getBoundingClientRect();
    const viewport = { width: win.innerWidth, height: win.innerHeight };

    let anchor;
    if (options.point != null) {
      anchor = { x: options.point.x, y: options.point.y, width: 0, height: 0 };
    } else if (options.anchor != null && options.anchor.isConnected) {
      const rect = options.anchor.getBoundingClientRect();
      anchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } else {
      // Nothing to sit beside: show it in the middle rather than leave an invisible,
      // unfocusable layer behind.
      anchor = { x: viewport.width / 2, y: viewport.height / 2, width: 0, height: 0 };
    }

    const position = computePosition({
      anchor,
      floating: { width: box.width, height: box.height },
      viewport,
      placement: options.placement,
      offset: options.offset,
      padding: options.padding,
    });

    node.style.left = `${String(position.x)}px`;
    node.style.top = `${String(position.y)}px`;
    node.dataset["placement"] = position.placement;
    node.style.visibility = "visible";

    if (inDialog) compensate(position.x, position.y);
  }

  /**
   * `left`/`top` are measured from the containing block. In the body that is the viewport; in
   * a dialog with a transform it is the dialog. Where the layer really landed is the truth, so
   * move it by however far that is from where it was meant to be.
   */
  function compensate(wantedX: number, wantedY: number): void {
    const landed = node.getBoundingClientRect();
    const offByX = landed.x - wantedX;
    const offByY = landed.y - wantedY;
    if (Math.abs(offByX) < 1 && Math.abs(offByY) < 1) return;
    node.style.left = `${String(wantedX - offByX)}px`;
    node.style.top = `${String(wantedY - offByY)}px`;
  }

  reposition();

  // 3. Keep it placed.
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
  observer?.observe(node);
  win.addEventListener("resize", reposition);
  win.addEventListener("scroll", reposition, { capture: true, passive: true });

  return {
    update(next: FloatingLayerOptions): void {
      options = next;
      reposition();
    },
    destroy(): void {
      observer?.disconnect();
      win.removeEventListener("resize", reposition);
      win.removeEventListener("scroll", reposition, { capture: true });
      // Svelte removes the element too; removing a node twice is harmless.
      node.remove();
    },
  };
}
