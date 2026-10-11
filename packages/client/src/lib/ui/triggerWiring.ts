/**
 * triggerWiring.ts — how a trigger element is wired to a tooltip or a popover (BAR-F1-03).
 *
 * `Tooltip.svelte` and `Popover.svelte` do little more than call these. Keeping the wiring
 * here means what it does — which DOM events reach the tooltip's timing machine, when Escape
 * is consumed and when it is left alone, what the trigger's aria says — is proven in a plain
 * test over minimal doubles (docs/design/barra-de-acoes/tasks.md §2.10), instead of living in
 * a component script that only a browser can run.
 *
 * Every `bind…`/`describe…`/`mark…` returns the function that undoes it, shaped to be the
 * return value of a Svelte `$effect`.
 */

import { isAnyLayerOpen, isEscapeKey, mergeDescribedBy } from "./dismissableLayer.js";
import type { HoverIntent } from "./hoverIntent.js";

// ---------------------------------------------------------------------------
// The tooltip's trigger
// ---------------------------------------------------------------------------

/**
 * True for the focus a keyboard gives an element, false for the focus a mouse click leaves on
 * a button: a tooltip that opened on the second would just sit on top of a button the user has
 * already pressed. `:focus-visible` is the browser's own answer; when it cannot give one, the
 * tooltip opens rather than hides.
 */
export function isKeyboardFocus(target: unknown): boolean {
  const matches = (target as { matches?: unknown } | null)?.matches;
  if (typeof matches !== "function") return true;
  try {
    return (matches as (selector: string) => boolean).call(target, ":focus-visible");
  } catch {
    return true;
  }
}

/** The part of the timing machine the trigger's events drive. */
export type TooltipTriggerIntent = Pick<
  HoverIntent,
  "hoverIn" | "hoverOut" | "focusIn" | "focusOut" | "press" | "reset"
>;

/**
 * Feeds the trigger's hover, focus and press to the tooltip's timing machine:
 *
 *  - a mouse or pen entering is a hover (a touch is not: there is no hovering on touch, and
 *    long-press belongs to the tablet mode, REQ-A11-046);
 *  - keyboard focus is a focus, but the focus a mouse click leaves on a button is not;
 *  - a press of the trigger tells the machine to get out of the click's way.
 *
 * Undoing it also resets the machine: a trigger that goes away must not leave a tooltip
 * showing or a timer pending.
 */
export function bindTooltipTrigger(
  trigger: Pick<HTMLElement, "addEventListener" | "removeEventListener">,
  intent: TooltipTriggerIntent,
  focusVisible: (target: unknown) => boolean = isKeyboardFocus,
): () => void {
  const onPointerEnter = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") intent.hoverIn();
  };
  const onPointerLeave = (): void => {
    intent.hoverOut();
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (focusVisible(event.target)) intent.focusIn();
  };
  const onFocusOut = (): void => {
    intent.focusOut();
  };
  const onPointerDown = (): void => {
    intent.press();
  };

  trigger.addEventListener("pointerenter", onPointerEnter);
  trigger.addEventListener("pointerleave", onPointerLeave);
  trigger.addEventListener("focusin", onFocusIn);
  trigger.addEventListener("focusout", onFocusOut);
  trigger.addEventListener("pointerdown", onPointerDown);

  return () => {
    trigger.removeEventListener("pointerenter", onPointerEnter);
    trigger.removeEventListener("pointerleave", onPointerLeave);
    trigger.removeEventListener("focusin", onFocusIn);
    trigger.removeEventListener("focusout", onFocusOut);
    trigger.removeEventListener("pointerdown", onPointerDown);
    intent.reset();
  };
}

export type TooltipEscapeDecision = "ignore" | "dismiss" | "dismiss-and-consume";

/**
 * Whose Escape is it, when a tooltip is showing?
 *
 *  - With a popover or menu open it is *theirs* (one Escape closes one thing, and the layer on
 *    top takes it): the tooltip does nothing.
 *  - Pressed with the focus on the tooltip's trigger it is the tooltip's: it closes, and the key
 *    stops there, or the same Escape would also close the window the trigger sits in.
 *  - Pressed anywhere else, the tooltip merely happens to be under the mouse. It closes, quietly,
 *    and the key goes on to whoever it was for — a search field to clear, a token to deselect.
 */
export function tooltipEscape(input: {
  target: unknown;
  anchor: { contains(other: Node | null): boolean } | null | undefined;
  anotherLayerOpen: boolean;
}): TooltipEscapeDecision {
  if (input.anotherLayerOpen) return "ignore";
  const aimedAtTrigger =
    input.target !== null &&
    input.target !== undefined &&
    input.anchor != null &&
    input.anchor.contains(input.target as Node);
  return aimedAtTrigger ? "dismiss-and-consume" : "dismiss";
}

/**
 * Makes Escape dismiss a showing tooltip, on the document in the capture phase so it runs
 * before the window's own handlers. The trigger is looked up when the key arrives, so a
 * trigger that changed is the one that counts.
 */
export function bindTooltipEscape(
  doc: Pick<Document, "addEventListener" | "removeEventListener">,
  intent: Pick<HoverIntent, "escape">,
  getAnchor: () => { contains(other: Node | null): boolean } | null | undefined,
  anotherLayerOpen: () => boolean = isAnyLayerOpen,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isEscapeKey(event)) return;
    const decision = tooltipEscape({
      target: event.target,
      anchor: getAnchor(),
      anotherLayerOpen: anotherLayerOpen(),
    });
    if (decision === "ignore") return;
    if (decision === "dismiss-and-consume") {
      event.preventDefault();
      event.stopPropagation();
    }
    intent.escape();
  };

  doc.addEventListener("keydown", onKeyDown, true);
  return () => {
    doc.removeEventListener("keydown", onKeyDown, true);
  };
}

/**
 * While a tooltip shows, it describes its trigger: its id is added to the trigger's
 * `aria-describedby` (which may already say something else), and taken out again — only its own
 * id — when it goes.
 */
export function describeTrigger(
  trigger: Pick<HTMLElement, "getAttribute" | "setAttribute" | "removeAttribute">,
  tooltipId: string,
): () => void {
  trigger.setAttribute(
    "aria-describedby",
    mergeDescribedBy(trigger.getAttribute("aria-describedby"), tooltipId, true) ?? tooltipId,
  );
  return () => {
    const rest = mergeDescribedBy(trigger.getAttribute("aria-describedby"), tooltipId, false);
    if (rest === null) trigger.removeAttribute("aria-describedby");
    else trigger.setAttribute("aria-describedby", rest);
  };
}

// ---------------------------------------------------------------------------
// The popover's trigger
// ---------------------------------------------------------------------------

/**
 * What a popover's trigger tells assistive technology: it opens a popup (a dialog), whether it
 * is open, and — only while there is something to point at — which element it controls. Set
 * here, not by the caller, so it cannot be forgotten or drift; undoing it leaves the trigger as
 * it was.
 */
export function markPopoverTrigger(
  trigger: Pick<HTMLElement, "setAttribute" | "removeAttribute">,
  state: { open: boolean; controls: string },
): () => void {
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", state.open ? "true" : "false");
  if (state.open) trigger.setAttribute("aria-controls", state.controls);
  return () => {
    trigger.removeAttribute("aria-haspopup");
    trigger.removeAttribute("aria-expanded");
    trigger.removeAttribute("aria-controls");
  };
}
