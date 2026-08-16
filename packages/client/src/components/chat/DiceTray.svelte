<script lang="ts">
  /**
   * DiceTray.svelte — three favourite dice and the door to the roll builder.
   *
   * Spec 38 (`specs/38-aba-chat.md`) §5.6, DEC-ACH-05 / REQ-ACH-050..054: the row sits
   * above the chat box with three favourites and a fourth button that opens the builder
   * (REQ-ACH-060). Firing one rolls immediately, with no dialog in between (RNF-ACH-01).
   *
   * Who sees the roll is decided in exactly one place — `lib/chat/resolveRollMode.ts`. This
   * component never sets `rollMode` by hand: it hands over the selector's current value and
   * the favourite's locked mode, and the resolver applies the precedence (REQ-ACH-044).
   *
   * Q-ACH-04, decided in `lib/chat/favoriteDice.ts`: a favourite whose formula is not valid
   * in the MVP is **disabled and says why** (in the tooltip and in the accessible name)
   * instead of failing on click.
   *
   * Icons are drawn, never emoji (REQ-NPC-094), and every button is a real `<button>` so
   * the keyboard reaches it with a visible focus ring (RNF-ACH-04).
   */

  import { untrack } from "svelte";

  import { t } from "../../lib/i18n/i18n.js";
  import {
    checkFavoriteFormula,
    favoriteProblemI18nKey,
    favoriteRollContent,
    loadFavoriteDice,
    subscribeFavoriteDice,
  } from "../../lib/chat/favoriteDice.js";
  import { buildChatSendPayload } from "../../lib/chat/resolveRollMode.js";
  import { currentRollMode } from "../../lib/chat/rollModeState.svelte.js";
  import { openRollBuilderWindow } from "../../lib/chat/rollBuilderWindow.js";
  import { rollModeI18nStem, rollModeIcons } from "./rollModeIcons.js";

  import type { ChatSendPayload } from "@fusion/shared";
  import type { FavoriteDie } from "../../lib/chat/favoriteDice.js";

  const {
    worldId,
    userId,
    onRoll,
    disabled = false,
  }: {
    worldId: string;
    userId: string;
    /** Sends the composed `chat:send` payload; the panel owns the socket. */
    onRoll: (payload: ChatSendPayload) => void | Promise<void>;
    disabled?: boolean;
  } = $props();

  // ---- Favourites, per world + user (REQ-ACH-053) ----
  //
  // Re-read whenever the identity changes AND whenever the editor or the builder saves:
  // both live in floating windows outside the drawer, so there is no parent in common to
  // hand a callback down (REQ-ACH-055).
  // The initial read is deliberately untracked: it seeds the first render (including the
  // server one), and the `$effect` below owns every read after that.
  let favorites = $state<FavoriteDie[]>(untrack(() => loadFavoriteDice(worldId, userId)));

  /** Who these favourites belong to; a change re-reads storage and re-subscribes. */
  const owner = $derived({ world: worldId, user: userId });

  $effect(() => {
    const { world, user } = owner;
    favorites = loadFavoriteDice(world, user);
    return subscribeFavoriteDice((changedWorld, changedUser) => {
      if (changedWorld === world && changedUser === user) {
        favorites = loadFavoriteDice(world, user);
      }
    });
  });

  // ---- Labels ----

  function modeHint(favorite: FavoriteDie): string {
    if (favorite.mode === null) return t("FUSION.Chat.Favorites.FollowsSelector");
    return t("FUSION.Chat.Favorites.LockedMode", {
      mode: t(`${rollModeI18nStem[favorite.mode]}.Label`),
    });
  }

  function describe(favorite: FavoriteDie): string {
    const check = checkFavoriteFormula(favorite.formula);
    if (!check.valid && check.problem !== undefined) {
      return t(favoriteProblemI18nKey(check.problem), {
        token: check.token ?? "",
        detail: check.detail ?? "",
      });
    }
    return `${t("FUSION.Chat.Favorites.Fire", { formula: favorite.formula })} — ${modeHint(favorite)}`;
  }

  // ---- Actions ----

  function fire(favorite: FavoriteDie): void {
    if (!checkFavoriteFormula(favorite.formula).valid) return;
    void onRoll(
      buildChatSendPayload({
        content: favoriteRollContent(favorite),
        worldId,
        selectorMode: currentRollMode(),
        favoriteMode: favorite.mode,
      }),
    );
  }

  function openBuilder(): void {
    openRollBuilderWindow({ worldId, userId });
  }

  /** Drawn d20 with a plus — "compose a roll". Same 24×24 grammar as the rail's icons. */
  const builderIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
    'stroke-linejoin="round" focusable="false">' +
    '<path d="M10.5 2.8 3.6 6.9v8.2l6.9 4.1 6.9-4.1V6.9z"/>' +
    '<path d="m3.6 6.9 6.9 4.1 6.9-4.1"/>' +
    '<path d="M10.5 11v8.2"/>' +
    '<path d="M19 16.5v5"/>' +
    '<path d="M16.5 19h5"/>' +
    "</svg>";
</script>

<div class="dice-tray" role="group" aria-label={t("FUSION.Chat.Favorites.RowLabel")}>
  {#each favorites as favorite, index (index)}
    {@const check = checkFavoriteFormula(favorite.formula)}
    <button
      type="button"
      class="dice-tray__favorite"
      class:dice-tray__favorite--invalid={!check.valid}
      data-slot={index + 1}
      data-formula={favorite.formula}
      data-locked-mode={favorite.mode}
      disabled={disabled || !check.valid}
      title={describe(favorite)}
      aria-label={`${favorite.label} — ${describe(favorite)}`}
      onclick={() => {
        fire(favorite);
      }}
    >
      <span class="dice-tray__label">{favorite.label}</span>
      {#if favorite.mode !== null}
        <span class="dice-tray__mode" aria-hidden="true">{@html rollModeIcons[favorite.mode]}</span>
      {/if}
    </button>
  {/each}

  <button
    type="button"
    class="dice-tray__builder"
    data-action="open-roll-builder"
    {disabled}
    title={t("FUSION.Chat.Favorites.OpenBuilder")}
    aria-label={t("FUSION.Chat.Favorites.OpenBuilder")}
    onclick={openBuilder}
  >
    <span class="dice-tray__icon" aria-hidden="true">{@html builderIcon}</span>
  </button>
</div>

<style>
  .dice-tray {
    display: flex;
    align-items: stretch;
    gap: 0.25rem;
    padding: 0.35rem 0.6rem 0;
    flex-shrink: 0;
  }

  .dice-tray__favorite {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    line-height: 1.4;
    transition: background-color var(--fusion-transition), border-color var(--fusion-transition);
  }

  .dice-tray__favorite:not(:disabled):hover {
    border-color: var(--fusion-accent);
    background: var(--fusion-surface);
  }

  .dice-tray__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A locked favourite carries its own mode icon, so the row says who will see the roll
     before it is fired (REQ-ACH-044). */
  .dice-tray__mode {
    display: inline-flex;
    line-height: 0;
    color: var(--fusion-accent);
    flex-shrink: 0;
  }

  /* Q-ACH-04: invalid means disabled with the reason in the tooltip, not a click that
     silently does nothing. */
  .dice-tray__favorite--invalid {
    border-style: dashed;
    color: var(--fusion-text-subtle);
  }

  .dice-tray__builder {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    flex-shrink: 0;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text-subtle);
    cursor: pointer;
    transition: color var(--fusion-transition), border-color var(--fusion-transition);
  }

  .dice-tray__builder:not(:disabled):hover {
    color: var(--fusion-text);
    border-color: var(--fusion-accent);
  }

  .dice-tray__favorite:disabled,
  .dice-tray__builder:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dice-tray__favorite:focus-visible,
  .dice-tray__builder:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
  }

  .dice-tray__icon {
    display: inline-flex;
    line-height: 0;
  }
</style>
