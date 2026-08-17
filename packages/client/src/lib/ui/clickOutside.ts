/**
 * clickOutside.ts — a reusable Svelte 5 action that closes a popover-style
 * region when the reader interacts outside of it.
 *
 * Motivated by task A021 (docs/design/gaveta-lateral/tasks-ajustes-r1.md): the chat
 * panel's "⋯" menu (`ChatPanel.svelte`, REQ-ACH-015) only closed on Escape or on the
 * toggle button itself — clicking anywhere else on the page left it open, which is not
 * how a menu/popover behaves. No shared `clickOutside` directive existed in the repo
 * (checked: `clickOutside`/`outside` across `packages/client/src` before writing this).
 *
 * `pointerdown` (not `click`) so the menu closes as soon as the reader starts
 * interacting elsewhere — the same signal a native `<select>`/menu uses, and it composes
 * with `stopPropagation` on the anchor's own toggle button without a race, since
 * `toggleMenu()` runs on `click`, which fires strictly after `pointerdown` for the same
 * gesture.
 *
 * The decision "is this event's target outside the node?" is factored out as a pure
 * function (`isOutsideTarget`) because the client's Vitest runs in `environment: "node"`
 * with no jsdom (`packages/client/vitest.config.ts`) — there is no real DOM to dispatch a
 * `pointerdown` against and observe. `isOutsideTarget` only needs `Node.contains`, so it
 * is testable against a minimal fake node instead.
 */

interface ContainsCapable {
  contains(other: Node | null): boolean;
}

/**
 * True when `target` is not inside `node` (including when `target` is null, e.g. the
 * event fired against a detached node). This is the entire decision the action makes;
 * kept pure and exported so it can be unit-tested without a real DOM.
 */
export function isOutsideTarget(node: ContainsCapable, target: EventTarget | null): boolean {
  if (target === null) return true;
  // `Node.contains` only ever returns true for an actual descendant/self; passing a
  // non-Node value through is safe (it simply cannot be "contained") and, deliberately,
  // this does NOT reference the global `Node` class — this project's Vitest runs in
  // `environment: "node"` (no jsdom), where `Node` is undefined, so an `instanceof Node`
  // check would throw a ReferenceError instead of returning a decision.
  return !node.contains(target as unknown as Node);
}

export interface ClickOutsideAction {
  update(callback: () => void): void;
  destroy(): void;
}

/**
 * Svelte 5 action: `use:clickOutside={() => (menuOpen = false)}`.
 *
 * Listens on `document` (capture phase, so a descendant that calls
 * `event.stopPropagation()` in the bubble phase still lets this run — the anchor's own
 * toggle button does not need special-casing) and invokes `callback` whenever a
 * `pointerdown` lands outside `node`. The callback is read through a mutable holder so a
 * new closure passed on re-render (Svelte calls `update()` for a changed action argument)
 * is honoured without re-registering the listener.
 */
export function clickOutside(node: HTMLElement, callback: () => void): ClickOutsideAction {
  let current = callback;

  function handlePointerDown(event: PointerEvent): void {
    if (isOutsideTarget(node, event.target)) {
      current();
    }
  }

  document.addEventListener("pointerdown", handlePointerDown, true);

  return {
    update(next: () => void): void {
      current = next;
    },
    destroy(): void {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    },
  };
}
