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
  import Icon from "../common/Icon.svelte";

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
      <span class="dice-tray__head">
        <span class="dice-tray__label">{favorite.label}</span>
        {#if favorite.mode !== null}
          <span class="dice-tray__mode" aria-hidden="true">{@html rollModeIcons[favorite.mode]}</span>
        {/if}
      </span>
      <!-- ui-chat: a favourite named by its own formula ("1d20") does not print it twice. -->
      {#if favorite.formula !== favorite.label}
        <span class="dice-tray__formula">{favorite.formula}</span>
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
    <Icon name="dices" size={20} />
  </button>
</div>

<style>
  /* Layout follows `.dicebar`/`.fav` in prototypes/chat-tab.prototype.html; sizes are the
     tokens of the visual language (ui-chat): 40px targets, 13px floor, no caps. */
  .dice-tray {
    display: flex;
    align-items: stretch;
    gap: var(--fusion-space-1);
    padding: var(--fusion-space-2) var(--fusion-space-3) 0;
    flex-shrink: 0;
  }

  .dice-tray__favorite {
    flex: 1;
    min-width: 0;
    min-height: var(--fusion-target);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--fusion-space-1);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    line-height: var(--fusion-leading-tight);
    transition: border-color var(--fusion-transition);
  }

  .dice-tray__favorite:not(:disabled):hover {
    border-color: var(--fusion-accent);
  }

  .dice-tray__head {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--fusion-space-1);
    width: 100%;
  }

  .dice-tray__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--fusion-weight-bold);
  }

  /* A locked favourite carries its own mode icon, so the row says who will see the roll
     before it is fired (REQ-ACH-044). */
  .dice-tray__mode {
    display: inline-flex;
    color: var(--fusion-text-muted);
    flex-shrink: 0;
  }

  .dice-tray__mode :global(svg) {
    width: 14px;
    height: 14px;
  }

  .dice-tray__formula {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
    font-size: var(--fusion-text-xs);
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
    flex: 0 0 var(--fusion-target);
    min-height: var(--fusion-target);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    transition: border-color var(--fusion-transition);
  }

  .dice-tray__builder:not(:disabled):hover {
    border-color: var(--fusion-accent);
  }

  .dice-tray__favorite:disabled,
  .dice-tray__builder:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dice-tray__favorite:focus-visible,
  .dice-tray__builder:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 1px;
  }
</style>
