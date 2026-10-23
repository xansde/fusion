<script lang="ts">
  /**
   * FavoriteDiceEditor.svelte — changing the three favourites.
   *
   * Spec 38 (`specs/38-aba-chat.md`) §5.6, REQ-ACH-055: the editor opens in a floating
   * window from the panel's "⋯" (REQ-ACH-015) and lets any role change the label, the
   * formula and the mode of each of the three favourites. It is available to everyone
   * because a favourite has no permission to check: it is a local shortcut, not a macro
   * (REQ-ACH-057).
   *
   * The mode select is the ONLY place a favourite gets locked (REQ-ACH-052); everywhere
   * else "follows the selector" is the answer, and the precedence between a locked
   * favourite, a command and the selector lives in `lib/chat/resolveRollMode.ts`.
   *
   * The formula is checked as it is typed (REQ-ACH-054) and the reason is shown next to
   * the field — the same verdict that decides whether the tray's button is enabled
   * (Q-ACH-04), so the editor is where an invalid favourite gets fixed.
   */

  import { untrack } from "svelte";

  import { t } from "../../lib/i18n/i18n.js";
  import {
    checkFavoriteFormula,
    favoriteProblemI18nKey,
    loadFavoriteDice,
    saveFavoriteDice,
  } from "../../lib/chat/favoriteDice.js";
  import { ROLL_MODE_ORDER, rollModeI18nStem } from "./rollModeIcons.js";

  import type { RollMode } from "@fusion/shared";
  import type { FavoriteDie } from "../../lib/chat/favoriteDice.js";

  const {
    worldId,
    userId,
  }: {
    worldId: string;
    userId: string;
  } = $props();

  // Seeded untracked so the first render (server included) already shows the saved values;
  // the effect below owns every read after that.
  let draft = $state<FavoriteDie[]>(untrack(() => loadFavoriteDice(worldId, userId)));
  let savedMessage = $state<string | null>(null);

  const owner = $derived({ world: worldId, user: userId });

  $effect(() => {
    const { world, user } = owner;
    draft = loadFavoriteDice(world, user);
  });

  function problemOf(formula: string): string | null {
    const check = checkFavoriteFormula(formula);
    if (check.valid || check.problem === undefined) return null;
    return t(favoriteProblemI18nKey(check.problem), {
      token: check.token ?? "",
      detail: check.detail ?? "",
    });
  }

  function update(index: number, patch: Partial<FavoriteDie>): void {
    const current = draft[index];
    if (current === undefined) return;
    draft[index] = { ...current, ...patch };
    savedMessage = null;
  }

  function save(): void {
    saveFavoriteDice(worldId, userId, draft);
    savedMessage = t("FUSION.Chat.Favorites.Editor.Saved");
  }
</script>

<div class="favorite-editor">
  {#each draft as favorite, index (index)}
    {@const problem = problemOf(favorite.formula)}
    <fieldset class="favorite-editor__slot" data-slot={index + 1}>
      <legend>{t("FUSION.Chat.RollBuilder.Slot", { index: index + 1 })}</legend>

      <label class="favorite-editor__field favorite-editor__field--label">
        <span>{t("FUSION.Chat.Favorites.Editor.Label")}</span>
        <input
          type="text"
          value={favorite.label}
          oninput={(e) => {
            update(index, { label: e.currentTarget.value });
          }}
        />
      </label>

      <label class="favorite-editor__field favorite-editor__field--formula">
        <span>{t("FUSION.Chat.Favorites.Editor.Formula")}</span>
        <input
          type="text"
          class:favorite-editor__input--invalid={problem !== null}
          value={favorite.formula}
          aria-invalid={problem !== null ? "true" : undefined}
          oninput={(e) => {
            update(index, { formula: e.currentTarget.value });
          }}
        />
      </label>

      <label class="favorite-editor__field favorite-editor__field--mode">
        <span>{t("FUSION.Chat.Favorites.Editor.Mode")}</span>
        <select
          value={favorite.mode ?? ""}
          onchange={(e) => {
            const picked = e.currentTarget.value;
            update(index, { mode: picked === "" ? null : (picked as RollMode) });
          }}
        >
          <option value="">{t("FUSION.Chat.Favorites.Editor.ModeFollows")}</option>
          {#each ROLL_MODE_ORDER as mode (mode)}
            <option value={mode}>{t(`${rollModeI18nStem[mode]}.Label`)}</option>
          {/each}
        </select>
      </label>

      {#if problem !== null}
        <p class="favorite-editor__problem" role="alert">{problem}</p>
      {/if}
    </fieldset>
  {/each}

  <div class="favorite-editor__actions">
    <button type="button" data-action="save-favorites" onclick={save}>
      {t("FUSION.Chat.Favorites.Editor.Save")}
    </button>
    {#if savedMessage !== null}
      <span class="favorite-editor__saved" aria-live="polite">{savedMessage}</span>
    {/if}
  </div>
</div>

<style>
  .favorite-editor {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-3);
    padding: var(--fusion-space-3);
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-base);
    color: var(--fusion-text);
  }

  /* Row-based, like `.fld` in prototypes/chat-tab.prototype.html: label, formula and mode
     of a favourite sit on one line, wrapping only when the formula's reason needs its own
     row. ui-chat: grouped by a hairline, not a box per slot. */
  .favorite-editor__slot {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--fusion-space-2);
    border: none;
    border-top: 1px solid var(--fusion-border);
    margin: 0;
    padding: var(--fusion-space-2) 0 0;
  }

  .favorite-editor__slot legend {
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text-muted);
    padding: 0 var(--fusion-space-1) 0 0;
  }

  .favorite-editor__field {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-1);
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  .favorite-editor__field--label {
    flex: 0 0 6.5rem;
  }

  .favorite-editor__field--formula {
    flex: 1 1 6rem;
    min-width: 0;
  }

  /* Shrinks instead of wrapping to its own row (a `flex: 0 0 auto` mode field never yields
     its intrinsic width, and the fieldset's hypothetical-basis sum overflows the roll
     builder window — see FavoriteDiceEditor's review r1 note). */
  .favorite-editor__field--mode {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
  }

  .favorite-editor__field--mode select {
    width: 100%;
  }

  .favorite-editor__field input,
  .favorite-editor__field select {
    min-height: var(--fusion-target);
    background: var(--fusion-input-bg);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-base);
    padding: 0 var(--fusion-space-2);
    min-width: 0;
  }

  .favorite-editor__field input:focus-visible,
  .favorite-editor__field select:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 1px;
  }

  .favorite-editor__field--formula input {
    font-family: var(--fusion-font-mono);
  }

  .favorite-editor__input--invalid {
    border-color: var(--fusion-danger);
  }

  .favorite-editor__problem {
    flex: 1 0 100%;
    margin: 0;
    font-size: var(--fusion-text-sm);
    color: var(--fusion-danger);
  }

  .favorite-editor__actions {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-3);
  }

  .favorite-editor__actions button {
    min-height: var(--fusion-target);
    padding: 0 var(--fusion-space-4);
    background: var(--fusion-accent);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius);
    color: var(--fusion-on-accent);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-base);
    font-weight: var(--fusion-weight-bold);
  }

  .favorite-editor__actions button:hover {
    background: var(--fusion-accent-hover);
  }

  .favorite-editor__actions button:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 1px;
  }

  .favorite-editor__saved {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text);
  }
</style>
