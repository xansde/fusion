<script lang="ts">
  /**
   * Tooltip.svelte — a generic, anchored tooltip (BAR-F1-03; spec 53 REQ-BAR-043/044).
   *
   * Reusable by any part of the app and unaware of who uses it. The caller hands it the
   * element the tooltip belongs to (`anchor`) and what to say; it decides when to show:
   *
   *     <button bind:this={button}>Golpe</button>
   *     <Tooltip anchor={button} text="Golpe de Espada" />
   *
   * What it does, and why:
   *  - **Opens on hover and on keyboard focus, after a delay** — never on a mouse-click focus,
   *    where the tooltip would just sit on top of a button the user already pressed — and goes
   *    away on blur, on Escape and on a press of the trigger. The timing is
   *    `lib/ui/hoverIntent.ts`; WCAG 1.4.13 asks for *dismissible* (Escape), *hoverable* (the
   *    pointer can cross onto the tooltip without it vanishing) and *persistent*.
   *  - **Escape is only consumed when it is the tooltip's.** Pressed with the focus on the
   *    trigger, the key stops here, or it would also close the window the trigger sits in. A
   *    tooltip that is merely under the mouse closes quietly and lets the key go on to whoever it
   *    was for (a search field to clear, a token to deselect); and with a popover or menu open,
   *    the key is theirs and the tooltip does nothing (`tooltipEscape`).
   *  - **`role="tooltip"` and `aria-describedby`**: while it is open the trigger is described
   *    by it (an id is added to any `aria-describedby` the trigger already has, and removed
   *    again). Only while open, because the content is not even rendered before then.
   *  - **Drawn, never the native `title`**, which cannot be styled, is not reachable from the
   *    keyboard and appears after a delay we do not control (the same reason as
   *    `ConditionChip.svelte`, whose look this one shares).
   *  - **Two levels.** The short one by default; the expanded one when the caller turns
   *    `expanded` on and gave an `expandedContent`. *Who* turns it on is the caller's call —
   *    the action bar will use Alt — so this component does not listen for any key to do it.
   *    The expanded level replaces the short one, so a caller can hand over a full panel
   *    (a sheet's detail component, say) without repeating the header.
   *  - **Above every window**: portaled to `<body>` by `floatingLayer`, with the
   *    `--fusion-z-tooltip` token (REQ-UIF-008). It is placed beside the anchor, flipping to
   *    the other side when it would leave the screen (`lib/ui/floating.ts`).
   *
   * Not here, on purpose: touch. A tooltip that appears on hover has to appear on long-press
   * too (REQ-A11-046), which belongs with the tablet mode; `open` can be driven from outside
   * (`bind:open`) for exactly that.
   *
   * This file is markup and wiring. What the trigger's events do (`bindTooltipTrigger`), whose
   * Escape it is (`bindTooltipEscape`) and what the trigger's aria says (`describeTrigger`) live
   * in `lib/ui/triggerWiring.ts`, tested without a DOM, which this component's script cannot be.
   */

  import type { Snippet } from "svelte";
  import type { Placement } from "../../lib/ui/floating.js";
  import { floatingLayer } from "../../lib/ui/floatingLayer.js";
  import { createHoverIntent } from "../../lib/ui/hoverIntent.js";
  import { nextLayerId } from "../../lib/ui/dismissableLayer.js";
  import {
    bindTooltipEscape,
    bindTooltipTrigger,
    describeTrigger,
  } from "../../lib/ui/triggerWiring.js";

  interface Props {
    /** The element the tooltip describes. The tooltip listens to it; null means "not yet". */
    anchor: HTMLElement | null;
    /** Plain text for the short level. Ignored when `content` is given. */
    text?: string | undefined;
    /** Rich content for the short level. */
    content?: Snippet | undefined;
    /** The expanded level, shown instead of the short one while `expanded` is on. */
    expandedContent?: Snippet | undefined;
    /** Show the expanded level. The caller decides what flips it. */
    expanded?: boolean | undefined;
    /** Open state. Bindable: read it, or drive it (a long-press) from outside. */
    open?: boolean | undefined;
    placement?: Placement | undefined;
    /** Milliseconds before a hover or a keyboard focus opens it. */
    openDelay?: number | undefined;
    /** Milliseconds before leaving closes it — the time to cross onto the tooltip. */
    closeDelay?: number | undefined;
    /** Never opens. */
    disabled?: boolean | undefined;
    /** Element id, for callers that need to reference it. Generated when omitted. */
    id?: string | undefined;
  }

  let {
    anchor,
    text = "",
    content,
    expandedContent,
    expanded = false,
    open = $bindable(false),
    placement = "top",
    openDelay = 300,
    closeDelay = 100,
    disabled = false,
    id,
  }: Props = $props();

  const generatedId = nextLayerId("fusion-tooltip");
  const tipId = $derived(id ?? generatedId);

  const showExpanded = $derived(expanded && expandedContent !== undefined);
  const hasShort = $derived(text !== "" || content !== undefined);
  const visible = $derived(open && !disabled && (hasShort || showExpanded));

  const intent = createHoverIntent({
    openDelay: () => openDelay,
    closeDelay: () => closeDelay,
    onChange: (value) => {
      open = value;
    },
  });

  // `open` may be set from outside; keep the timing machine in step without echoing it back.
  $effect(() => {
    intent.sync(open);
  });

  // Listen to the trigger: hover, keyboard focus and press feed the timing machine. Touch
  // pointers are left out (no hover on touch), and so is the focus a mouse click leaves.
  $effect(() => {
    const element = anchor;
    if (element === null || disabled) return;
    return bindTooltipTrigger(element, intent);
  });

  // Escape dismisses it. On the document in the capture phase, so it runs before the window's
  // own handlers; consumed only when aimed at the trigger, left alone otherwise, and left to a
  // popover or menu when one is open (`tooltipEscape` has the rule).
  $effect(() => {
    if (!visible) return;
    return bindTooltipEscape(document, intent, () => anchor);
  });

  // While it is showing, it describes the trigger. Added to what is already there.
  $effect(() => {
    const element = anchor;
    if (element === null || !visible) return;
    return describeTrigger(element, tipId);
  });
</script>

{#if visible}
  <div
    class="fusion-tooltip"
    class:fusion-tooltip--expanded={showExpanded}
    id={tipId}
    role="tooltip"
    data-level={showExpanded ? "expanded" : "short"}
    use:floatingLayer={{ anchor, placement, offset: 6 }}
    onpointerenter={() => intent.layerIn()}
    onpointerleave={() => intent.layerOut()}
  >
    {#if showExpanded && expandedContent}
      {@render expandedContent()}
    {:else if content}
      {@render content()}
    {:else}
      {text}
    {/if}
  </div>
{/if}

<style>
  /* The look of the ConditionChip tooltip and of the prototype's `.tip`
     (docs/design/barra-de-acoes/prototipo-barra-fiel.html). Position, size and the reveal
     are driven by `floatingLayer`; this only says what the box looks like. */
  .fusion-tooltip {
    position: fixed;
    left: 0;
    top: 0;
    z-index: var(--fusion-z-tooltip);
    /* Shown by floatingLayer once it has measured and placed the box. */
    visibility: hidden;
    box-sizing: border-box;
    /* Shrink-wrapped to its content: a fixed box that shrank to the room beside it would
       change size as it moves, and the measurement would be wrong the moment it applied. */
    width: max-content;
    max-width: min(272px, calc(100vw - 16px));
    padding: 8px 10px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.4;
    box-shadow: var(--fusion-shadow-modal);
    overflow-wrap: anywhere;
  }

  /* The expanded level carries a whole panel: wider, and scrollable if it is taller than
     the screen. */
  .fusion-tooltip--expanded {
    max-width: min(420px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
  }
</style>
