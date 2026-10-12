<script lang="ts">
  /**
   * Popover.svelte — a generic popover anchored to a trigger (BAR-F1-03; spec 53
   * REQ-BAR-043).
   *
   * A small floating panel with whatever the caller puts in it: a cost picker, a short form,
   * a list of options. Unaware of who uses it:
   *
   *     <button bind:this={button} onclick={() => (open = !open)}>Custo</button>
   *     <Popover bind:open anchor={button} label="Escolha o custo" placement="top">
   *       …content…
   *     </Popover>
   *
   * What it does, and why:
   *  - **Closes on a click outside, on Escape, and when Tab would step out** — all three from
   *    `lib/ui/dismissableLayer.ts`, which reuses `clickOutside.ts`. "Menu that doesn't close
   *    when you click away" is the recurring defect `PROCESSO-UI.md` lists; here it is
   *    handled once. The trigger is exempt from "outside": its own click toggles the popover,
   *    and closing-then-reopening on the same click is the classic bug.
   *  - **Focus goes in and comes back.** On open the focus moves to the first thing inside
   *    that can take it (the popover itself if there is nothing); on Escape and on Tab it
   *    returns to the trigger. After a click elsewhere it stays where that click put it.
   *    A caller that routes the focus itself passes `restoreFocus={false}`.
   *  - **It owns the keyboard while open.** The canvas listens on `window` and moves, deletes or
   *    duplicates the selected token on the arrow keys, Delete and D; a key pressed in the
   *    popover must not reach it. Tab alone is let through (`keepLayerKeysFromApp`).
   *  - **Aria.** `role="dialog"` with `aria-modal="false"` — the non-modal dialog pattern —
   *    and a required `label`. The trigger gets `aria-haspopup`, `aria-expanded` and
   *    `aria-controls` from here, so a caller cannot forget them (and should not set its own).
   *  - **Above every window**: portaled to `<body>` with the `--fusion-z-tooltip` token — the
   *    scale shares one layer for tooltip and popover (spec 53 §2.7, REQ-UIF-008). Placed
   *    beside the trigger, flipping when it would leave the screen.
   *
   * This file is markup and wiring. What the layer asks of its behaviour is `popoverLayerOptions`,
   * what closing does is `createDismissHandler`, and what the trigger's aria says is
   * `markPopoverTrigger` — all tested without a DOM, which this component's script cannot be.
   */

  import type { Snippet } from "svelte";
  import type { Placement } from "../../lib/ui/floating.js";
  import { floatingLayer } from "../../lib/ui/floatingLayer.js";
  import {
    createDismissHandler,
    dismissableLayer,
    keepLayerKeysFromApp,
    nextLayerId,
    popoverLayerOptions,
    type DismissReason,
  } from "../../lib/ui/dismissableLayer.js";
  import { markPopoverTrigger } from "../../lib/ui/triggerWiring.js";

  interface Props {
    /** Open state. Bindable. */
    open?: boolean | undefined;
    /** The trigger the popover hangs from. Null means "not yet". */
    anchor: HTMLElement | null;
    /** The popover's accessible name. Required: a dialog without a name is announced as nothing. */
    label: string;
    placement?: Placement | undefined;
    /** Give the focus back to the trigger on Escape and Tab. Default true. */
    restoreFocus?: boolean | undefined;
    /** Called after the popover closed itself, with why. Not called when the owner closes it. */
    onclose?: ((reason: DismissReason) => void) | undefined;
    children: Snippet;
  }

  let {
    open = $bindable(false),
    anchor,
    label,
    placement = "bottom",
    restoreFocus = true,
    onclose,
    children,
  }: Props = $props();

  const popoverId = nextLayerId("fusion-popover");

  const dismiss = createDismissHandler({
    setOpen: (value) => {
      open = value;
    },
    onclose: () => onclose,
  });

  // The trigger's aria. Set here, not by the caller, so it cannot be forgotten or drift.
  $effect(() => {
    const element = anchor;
    if (element === null) return;
    return markPopoverTrigger(element, { open, controls: popoverId });
  });
</script>

{#if open}
  <div
    class="fusion-popover"
    id={popoverId}
    role="dialog"
    aria-modal="false"
    aria-label={label}
    tabindex="-1"
    data-fusion-layer
    use:floatingLayer={{ anchor, placement, offset: 6 }}
    use:dismissableLayer={popoverLayerOptions({ anchor, restoreFocus, onDismiss: dismiss })}
    onkeydown={(event) => keepLayerKeysFromApp(event)}
  >
    {@render children()}
  </div>
{/if}

<style>
  /* The prototype's `.pop` (docs/design/barra-de-acoes/prototipo-barra-fiel.html): the same
     surface as the context menu. Position and reveal are driven by `floatingLayer`. */
  .fusion-popover {
    position: fixed;
    left: 0;
    top: 0;
    /* One layer for tooltip and popover (spec 53 §2.7). */
    z-index: var(--fusion-z-tooltip);
    /* Shown by floatingLayer once it has measured and placed the box. */
    visibility: hidden;
    box-sizing: border-box;
    /* Shrink-wrapped, so the measurement taken before placing stays true after it. */
    width: max-content;
    max-width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 12px;
    box-shadow: var(--fusion-shadow-modal);
  }

  /* It takes the focus itself when there is nothing inside to take it. */
  .fusion-popover:focus-visible {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: -2px;
  }
</style>
