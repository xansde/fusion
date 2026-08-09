<script lang="ts">
  /**
   * IsekaiBlessingDialog.svelte — read-only details for one Isekai blessing.
   *
   * Deliberately NOT PlanDetailsDialog: that one resolves a name against a
   * compendium pack over the socket, and the Isekai layer has no pack. The
   * blessing's text travels on the chip itself (`AutoFeatureModel.isekai`), so
   * this dialog is pure render — no fetch, no loading state, no failure mode.
   */

  import type { IsekaiChipInfo } from "../../../../lib/sheets/pf2e/planVM.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    /** The chip's own name, plus everything the layer carried with it. */
    blessing: IsekaiChipInfo & { name: string };
    onClose: () => void;
  }

  let { blessing, onClose }: Props = $props();

  const kindLabel = $derived(
    blessing.kind === "major"
      ? t("FUSION.Sheet.Isekai.MajorBlessing")
      : t("FUSION.Sheet.Isekai.MinorBlessing"),
  );
</script>

<div
  class="isekai-dialog__backdrop"
  role="button"
  tabindex="-1"
  aria-label={t("FUSION.Dialog.Close")}
  onclick={onClose}
  onkeydown={(e) => {
    if (e.key === "Escape" || e.key === "Enter") onClose();
  }}
></div>

<div
  class="isekai-dialog"
  role="dialog"
  aria-modal="true"
  aria-label={blessing.name}
  style={`--accent: ${blessing.color}`}
>
  <header class="isekai-dialog__head">
    <div class="isekai-dialog__source">{blessing.archetypeName} · {kindLabel}</div>
    <h2 class="isekai-dialog__title">{blessing.name}</h2>
    <button type="button" class="isekai-dialog__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>
      ✕
    </button>
  </header>
  <!--
    The layer's rules text carries inline <b> emphasis, exactly like the pack
    descriptions the compendium panel renders. It is authored content shipped
    in the bundle — not user input, and never fetched from a peer.
  -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <p class="isekai-dialog__text">{@html blessing.text}</p>
</div>

<style>
  .isekai-dialog__backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    padding: 0;
    z-index: 60;
  }

  .isekai-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    overflow-y: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-top: 3px solid var(--accent);
    border-radius: var(--fusion-radius);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    padding: 16px 18px 18px;
  }

  .isekai-dialog__head {
    position: relative;
    padding-right: 28px;
    margin-bottom: 10px;
  }

  .isekai-dialog__source {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    font-weight: 700;
  }

  .isekai-dialog__title {
    margin: 2px 0 0;
    font-size: 17px;
    color: var(--fusion-text);
  }

  .isekai-dialog__close {
    position: absolute;
    top: 0;
    right: 0;
    background: none;
    border: none;
    color: var(--fusion-text-subtle);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 4px;
  }

  .isekai-dialog__close:hover {
    color: var(--fusion-text);
  }

  .isekai-dialog__text {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--fusion-text);
  }

  .isekai-dialog__text :global(b) {
    color: var(--accent);
  }
</style>
