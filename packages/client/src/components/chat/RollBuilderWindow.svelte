<script lang="ts">
  /**
   * RollBuilderWindow.svelte — composing WHAT gets rolled.
   *
   * Spec 38 (`specs/38-aba-chat.md`) §5.7, DEC-ACH-06 / REQ-ACH-060..063. The window puts
   * together quantity, faces, modifier, label, advantage/disadvantage, exploding and keep
   * highest, and shows the resulting formula before rolling (REQ-ACH-060).
   *
   * It has **no** roll mode control (REQ-ACH-061). Two places deciding the audience is
   * where leaks start, so the window only REPORTS the selector's current mode and points
   * back at the panel. Saving the build as a favourite therefore always produces a
   * "follows the selector" favourite (REQ-ACH-062).
   *
   * Mounted by `WindowHost` as a floating window (REQ-ACH-063, REQ-UIF-009) — it never
   * touches the drawer's width (REQ-GAV-012), and it resolves the LIVE socket when it rolls
   * instead of capturing one in `componentProps`, which would freeze across a reconnect.
   */

  import { t } from "../../lib/i18n/i18n.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { sendChatMessage } from "../../lib/chat/chatStore.svelte.js";
  import { buildChatSendPayload } from "../../lib/chat/resolveRollMode.js";
  import { rollModeState } from "../../lib/chat/rollModeState.svelte.js";
  import {
    FAVORITE_SLOT_COUNT,
    loadFavoriteDice,
    saveFavoriteDice,
  } from "../../lib/chat/favoriteDice.js";
  import {
    DEFAULT_ROLL_BUILDER_SPEC,
    MAX_DICE_COUNT,
    MAX_DIE_FACES,
    MIN_DICE_COUNT,
    MIN_DIE_FACES,
    buildRollFormula,
    favoriteFromSpec,
  } from "../../lib/chat/rollBuilder.js";
  import { rollModeI18nStem, rollModeIcons } from "./rollModeIcons.js";

  import type { ChatSendPayload } from "@fusion/shared";
  import type { RollEdge } from "../../lib/chat/rollBuilder.js";

  const {
    worldId,
    userId,
    onRoll,
  }: {
    worldId: string;
    userId: string;
    /**
     * Optional sender. Left out in the app: the window lives outside the chat panel, which
     * unmounts on every drawer tab switch, so it sends through the live socket itself.
     */
    onRoll?: (payload: ChatSendPayload) => void | Promise<void>;
  } = $props();

  // ---- What gets rolled (REQ-ACH-060) ----

  let count = $state(DEFAULT_ROLL_BUILDER_SPEC.count);
  let faces = $state(DEFAULT_ROLL_BUILDER_SPEC.faces);
  let modifier = $state(DEFAULT_ROLL_BUILDER_SPEC.modifier);
  let label = $state(DEFAULT_ROLL_BUILDER_SPEC.label);
  let edge = $state<RollEdge>(DEFAULT_ROLL_BUILDER_SPEC.edge);
  let explode = $state(DEFAULT_ROLL_BUILDER_SPEC.explode);
  let keepHighest = $state<number | null>(DEFAULT_ROLL_BUILDER_SPEC.keepHighest);
  let saveSlot = $state(0);
  let savedMessage = $state<string | null>(null);

  const spec = $derived({ count, faces, modifier, label, edge, explode, keepHighest });
  const formula = $derived(buildRollFormula(spec));

  // ---- Who sees it: reported, never chosen here (REQ-ACH-061) ----

  const modeLabel = $derived(t(`${rollModeI18nStem[rollModeState.mode]}.Label`));

  // ---- Actions ----

  async function roll(): Promise<void> {
    const payload = buildChatSendPayload({
      content: `/roll ${formula}`,
      worldId,
      selectorMode: rollModeState.mode,
      // The window locks nothing: a build follows the selector (DEC-ACH-06).
      favoriteMode: null,
    });

    if (onRoll) {
      await onRoll(payload);
      return;
    }
    const socket = getSocket();
    if (socket === null) return;
    await sendChatMessage(socket, payload);
  }

  function saveAsFavorite(): void {
    const favorite = favoriteFromSpec(spec);
    const slots = loadFavoriteDice(worldId, userId);
    slots[saveSlot] = favorite;
    saveFavoriteDice(worldId, userId, slots);
    savedMessage = t("FUSION.Chat.RollBuilder.Saved", { label: favorite.label });
  }
</script>

<div class="roll-builder">
  <div class="roll-builder__grid">
    <label class="roll-builder__field">
      <span>{t("FUSION.Chat.RollBuilder.Count")}</span>
      <input type="number" min={MIN_DICE_COUNT} max={MAX_DICE_COUNT} bind:value={count} />
    </label>

    <label class="roll-builder__field">
      <span>{t("FUSION.Chat.RollBuilder.Faces")}</span>
      <input type="number" min={MIN_DIE_FACES} max={MAX_DIE_FACES} bind:value={faces} />
    </label>

    <label class="roll-builder__field">
      <span>{t("FUSION.Chat.RollBuilder.Modifier")}</span>
      <input type="number" bind:value={modifier} />
    </label>

    <label class="roll-builder__field">
      <span>{t("FUSION.Chat.RollBuilder.KeepHighest")}</span>
      <input
        type="number"
        min="1"
        max={count}
        placeholder={t("FUSION.Chat.RollBuilder.KeepAll")}
        disabled={edge !== "none"}
        value={keepHighest ?? ""}
        oninput={(e) => {
          const raw = e.currentTarget.value.trim();
          keepHighest = raw === "" ? null : Number(raw);
        }}
      />
    </label>
  </div>

  <label class="roll-builder__field roll-builder__field--wide">
    <span>{t("FUSION.Chat.RollBuilder.Label")}</span>
    <input
      type="text"
      bind:value={label}
      placeholder={t("FUSION.Chat.RollBuilder.LabelPlaceholder")}
    />
  </label>

  <fieldset class="roll-builder__edge">
    <legend>{t("FUSION.Chat.RollBuilder.Edge")}</legend>
    {#each ["none", "advantage", "disadvantage"] as const as option (option)}
      <label class="roll-builder__radio">
        <input type="radio" name="roll-builder-edge" value={option} bind:group={edge} />
        <span
          >{t(
            `FUSION.Chat.RollBuilder.Edge.${option === "none" ? "None" : option === "advantage" ? "Advantage" : "Disadvantage"}`,
          )}</span
        >
      </label>
    {/each}
  </fieldset>

  <label class="roll-builder__check">
    <input type="checkbox" bind:checked={explode} />
    <span>{t("FUSION.Chat.RollBuilder.Explode")}</span>
  </label>

  <!-- The composed formula, always visible before rolling (REQ-ACH-060) -->
  <div class="roll-builder__preview">
    <span class="roll-builder__preview-label">{t("FUSION.Chat.RollBuilder.Preview")}</span>
    <code data-preview="formula">{formula}</code>
  </div>

  <!-- Who sees it is reported, not chosen (REQ-ACH-061) -->
  <p class="roll-builder__mode" data-roll-mode={rollModeState.mode}>
    <span class="roll-builder__mode-icon" aria-hidden="true"
      >{@html rollModeIcons[rollModeState.mode]}</span
    >
    <span>{t("FUSION.Chat.RollBuilder.ModeNotice", { mode: modeLabel })}</span>
  </p>

  <div class="roll-builder__actions">
    <button
      type="button"
      class="roll-builder__roll"
      data-action="roll"
      onclick={() => {
        void roll();
      }}
    >
      {t("FUSION.Chat.RollBuilder.Roll")}
    </button>

    <label class="roll-builder__slot">
      <span>{t("FUSION.Chat.RollBuilder.SaveSlot")}</span>
      <select bind:value={saveSlot}>
        {#each Array.from({ length: FAVORITE_SLOT_COUNT }, (_, i) => i) as slot (slot)}
          <option value={slot}>{t("FUSION.Chat.RollBuilder.Slot", { index: slot + 1 })}</option>
        {/each}
      </select>
    </label>

    <button
      type="button"
      class="roll-builder__save"
      data-action="save-favorite"
      onclick={saveAsFavorite}
    >
      {t("FUSION.Chat.RollBuilder.SaveAsFavorite")}
    </button>
  </div>

  {#if savedMessage !== null}
    <p class="roll-builder__saved" aria-live="polite">{savedMessage}</p>
  {/if}
</div>

<style>
  .roll-builder {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .roll-builder__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem;
  }

  .roll-builder__field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
  }

  .roll-builder__field--wide {
    width: 100%;
  }

  .roll-builder__field input,
  .roll-builder__slot select {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    padding: 0.2rem 0.35rem;
    min-width: 0;
  }

  .roll-builder__edge {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 0.3rem 0.5rem;
  }

  .roll-builder__edge legend {
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
    padding: 0 0.25rem;
  }

  .roll-builder__radio,
  .roll-builder__check {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
  }

  .roll-builder__preview {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    border-top: 1px solid var(--fusion-border);
    padding-top: 0.4rem;
  }

  .roll-builder__preview-label {
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
  }

  .roll-builder__preview code {
    font-size: 0.875rem;
    color: var(--fusion-accent);
    word-break: break-all;
  }

  .roll-builder__mode {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
  }

  .roll-builder__mode-icon {
    display: inline-flex;
    line-height: 0;
    flex-shrink: 0;
  }

  .roll-builder__actions {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .roll-builder__slot {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
  }

  .roll-builder__roll,
  .roll-builder__save {
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .roll-builder__roll {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: #fff;
    font-weight: 600;
  }

  .roll-builder__roll:hover {
    background: var(--fusion-accent-hover);
  }

  .roll-builder__save:hover {
    border-color: var(--fusion-accent);
  }

  .roll-builder__roll:focus-visible,
  .roll-builder__save:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
  }

  .roll-builder__saved {
    margin: 0;
    font-size: 0.7rem;
    color: var(--fusion-success);
  }
</style>
