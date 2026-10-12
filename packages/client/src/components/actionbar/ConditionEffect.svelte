<script lang="ts">
  /**
   * ConditionEffect.svelte — the effect of a condition, revealed by a click on its chip
   * (BAR-F1-04; spec 53 REQ-BAR-028, D-B23; prototype `.tip--chip`).
   *
   * The chip in the status strip shows only the NAME of the condition; the effect appears when the
   * chip is clicked and folds when it is clicked again. This is the box that shows it. It is not a
   * hover tooltip (the effect must not pop up for a mere pass of the mouse) and not a dialog (it
   * must not take the focus away from the canvas, or the number keys would go silent behind it).
   *
   * It is a floating layer like the generic ones (BAR-F1-03): portaled to `<body>` above the window
   * host and placed over the chip by `floatingLayer`, and closed by a click outside or by Escape by
   * `dismissableLayer` — one Escape closes it and no more, the key is consumed, so the selected
   * token is not dropped with it. The chip is exempt from "outside": its own click toggles.
   */

  import { floatingLayer } from "../../lib/ui/floatingLayer.js";
  import { dismissableLayer, type DismissableLayerOptions } from "../../lib/ui/dismissableLayer.js";

  interface Props {
    /** Element id, so the chip can point at it with `aria-controls`. */
    id: string;
    /** The chip that opened it. */
    anchor: HTMLElement | null;
    /** The condition as the chip writes it ("Amedrontado 1"). */
    name: string;
    effect: string;
    /** It closed itself (Escape, or a click outside). */
    onclose: () => void;
  }

  const { id, anchor, name, effect, onclose }: Props = $props();

  const layer = $derived<DismissableLayerOptions>({
    onDismiss: onclose,
    anchor,
    exemptAnchor: true,
    // The focus is nowhere near this box: nothing to give back, nothing to take.
    restoreFocus: false,
    initialFocus: "none",
    tab: "close-at-edges",
  });
</script>

<div
  class="effect"
  {id}
  data-fusion-layer
  use:floatingLayer={{ anchor, placement: "top", offset: 6 }}
  use:dismissableLayer={layer}
>
  <div class="effect__name">{name}</div>
  <div class="effect__text">{effect}</div>
</div>

<style>
  /* The prototype's `.tip--chip`: the tooltip's box, 236 px wide. Position and reveal are driven by
     `floatingLayer`; this says what it looks like. */
  .effect {
    position: fixed;
    left: 0;
    top: 0;
    z-index: var(--fusion-z-tooltip);
    visibility: hidden;
    box-sizing: border-box;
    width: max-content;
    max-width: min(236px, calc(100vw - 16px));
    padding: 8px 10px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 11px;
    line-height: 1.4;
    box-shadow: var(--fusion-shadow-modal);
    overflow-wrap: anywhere;
  }

  .effect__name {
    font-weight: 700;
  }

  .effect__text {
    margin-top: 2px;
    color: var(--fusion-text-muted);
  }
</style>
