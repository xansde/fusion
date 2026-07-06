<script lang="ts">
  /**
   * SpellCastCard.svelte — interactive PF2e spell-cast chat card (r17-P2).
   *
   * Renders `flags.pf2e.spellCast` (SpellCastCard, @fusion/shared) mounted by
   * ChatMessage.svelte in place of the plain text body. NOT a `message.card`
   * (CardData) declarative card — it mirrors the Etmos ConjuracaoCard pattern:
   * a namespaced flag with its own component + pure VM.
   *
   * Two actions:
   *   - "Fazer teste de resistência" (save type + DC present): ANY player may
   *     click — it is the TARGET who rolls. Resolves the clicker's actor
   *     (1 owned → auto; N owned or GM → mini-selector) and emits a chat:send
   *     `/r 1d20+<mod> # Salvaguarda...` with speaker = the chosen actor.
   *   - "Rolar dano" (damage formula present): visible only to the caster's
   *     owner / GM — emits a chat:send `/r <heightened formula> # <spell> — Dano`
   *     with speaker = the caster.
   *
   * All rolls run on the SERVER (RNG server-side, anti-cheat). This component
   * only decides which buttons to show and builds the ops via the pure VM.
   */

  import type { Socket } from "socket.io-client";
  import type { SpellCastCard } from "@fusion/shared";
  import { t } from "$lib/i18n/i18n.js";
  import { sendOp } from "$lib/docs/sendOp.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import {
    resolveClickerActors,
    showSaveButton,
    canRollDamage,
    buildSaveRollOp,
    buildDamageRollOp,
    type ClickerActorOption,
    type SpellCastChatOp,
    type ActorDocLike,
  } from "$lib/sheets/pf2e/spellCastCardVM.js";

  interface Props {
    card: SpellCastCard;
    worldId: string;
    socket?: Socket | undefined;
    isGm?: boolean;
    userId?: string;
  }

  const { card, worldId, socket, isGm = false, userId = "" }: Props = $props();

  let pending = $state(false);
  let errorMsg = $state<string | null>(null);
  let selectorOpen = $state(false);

  // The caster actor from the client's mirror (best-effort; may be undefined
  // for a player who cannot see the caster — the damage gate then needs GM).
  const casterActor = $derived(
    worldMirror.getDoc<ActorDocLike>("Actor", card.casterActorId) ?? undefined,
  );

  // Every character/npc the clicker may roll the save with.
  const clickerActors = $derived<ClickerActorOption[]>(
    resolveClickerActors(worldMirror.getByType<ActorDocLike>("Actor"), userId, isGm),
  );

  const canSave = $derived(showSaveButton(card));
  const canDamage = $derived(canRollDamage(card, casterActor, userId, isGm));

  const saveTypeLabel = $derived(
    card.saveType ? t(`FUSION.Sheet.Chat.SaveName.${card.saveType}`) : "",
  );
  const damageFlavorPrefix = $derived(
    card.rank > 0
      ? t("FUSION.Sheet.Chat.SpellDamageHeightened", { name: card.spellName, rank: String(card.rank) })
      : t("FUSION.Sheet.Chat.SpellDamage", { name: card.spellName }),
  );

  async function emit(op: SpellCastChatOp): Promise<void> {
    if (!socket) {
      console.warn("[SpellCastCard] no socket — cannot emit", op.type);
      return;
    }
    pending = true;
    errorMsg = null;
    try {
      const { type, ...payload } = op;
      await sendOp(socket, { type, payload });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      pending = false;
    }
  }

  async function rollSaveWith(actorId: string): Promise<void> {
    const actor = worldMirror.getDoc<ActorDocLike>("Actor", actorId);
    if (!actor) return;
    const op = buildSaveRollOp(card, actor, saveTypeLabel, worldId);
    if (op) await emit(op);
    selectorOpen = false;
  }

  async function handleSaveClick(): Promise<void> {
    // 1 controllable actor → roll immediately; several → open the selector.
    if (clickerActors.length === 1) {
      await rollSaveWith(clickerActors[0]!.id);
    } else if (clickerActors.length > 1) {
      selectorOpen = !selectorOpen;
    }
  }

  async function handleDamageClick(): Promise<void> {
    const op = buildDamageRollOp(card, worldId, damageFlavorPrefix);
    if (op) await emit(op);
  }
</script>

<div class="spell-card" aria-label={t("FUSION.Chat.SpellCard.Title")}>
  <!-- Header -->
  <div class="spell-card__header">
    <span class="spell-card__icon" aria-hidden="true">✦</span>
    <span class="spell-card__title">{card.spellName}</span>
    {#if card.actionCost}
      <span class="spell-card__cost" aria-hidden="true">{card.actionCost}</span>
    {/if}
    {#if card.rank > 0}
      <span class="spell-card__rank">{t("FUSION.Chat.SpellCard.Rank", { rank: String(card.rank) })}</span>
    {/if}
  </div>

  <!-- Save / DC line -->
  {#if canSave}
    <div class="spell-card__save">
      {t("FUSION.Sheet.Chat.SpellCastSave", {
        dc: String(card.dcValue),
        save: saveTypeLabel,
        basic: card.basicSave ? t("FUSION.Sheet.Chat.SpellCastSaveBasic") : "",
      })}
    </div>
  {/if}

  <!-- Damage line (display) -->
  {#if card.damageFormula}
    <div class="spell-card__damage">
      {card.damageFormula}{#if card.damageType}<span class="spell-card__dtype"> {card.damageType}</span>{/if}
    </div>
  {/if}

  <!-- Traits -->
  {#if card.traits && card.traits.length > 0}
    <div class="spell-card__traits">
      {#each card.traits as trait (trait)}
        <span class="spell-card__trait">{trait}</span>
      {/each}
    </div>
  {/if}

  {#if errorMsg}
    <p class="spell-card__error" role="alert">{errorMsg}</p>
  {/if}

  <!-- Actor selector (N controllable actors) -->
  {#if selectorOpen && clickerActors.length > 1}
    <div class="spell-card__selector" role="group" aria-label={t("FUSION.Chat.SpellCard.PickActor")}>
      {#each clickerActors as opt (opt.id)}
        <button
          type="button"
          class="spell-card__btn spell-card__btn--ghost"
          onclick={() => rollSaveWith(opt.id)}
          disabled={pending}
        >
          {opt.name}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Actions -->
  <div class="spell-card__actions">
    {#if canSave}
      <button
        type="button"
        class="spell-card__btn spell-card__btn--primary"
        onclick={handleSaveClick}
        disabled={pending || clickerActors.length === 0}
        title={clickerActors.length === 0 ? t("FUSION.Chat.SpellCard.NoActor") : ""}
      >
        {t("FUSION.Chat.SpellCard.RollSave")}
      </button>
    {/if}
    {#if canDamage}
      <button
        type="button"
        class="spell-card__btn spell-card__btn--danger"
        onclick={handleDamageClick}
        disabled={pending}
      >
        {t("FUSION.Chat.SpellCard.RollDamage")}
      </button>
    {/if}
  </div>
</div>

<style>
  .spell-card {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    overflow: hidden;
    max-width: 340px;
    margin-top: 0.35rem;
    padding: 0.5rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .spell-card__header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .spell-card__icon {
    color: #7c5cfc;
  }

  .spell-card__title {
    flex: 1;
    font-weight: 600;
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .spell-card__cost {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-accent);
    font-size: 0.85rem;
    letter-spacing: 1px;
  }

  .spell-card__rank {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .spell-card__save {
    font-size: 0.75rem;
    color: var(--fusion-text-muted);
  }

  .spell-card__damage {
    font-family: var(--fusion-font-mono);
    font-size: 0.8rem;
    color: var(--fusion-text);
  }

  .spell-card__dtype {
    color: var(--fusion-text-muted);
  }

  .spell-card__traits {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .spell-card__trait {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .spell-card__error {
    font-size: 0.7rem;
    color: var(--fusion-danger);
    margin: 0;
  }

  .spell-card__selector {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    border: 1px dashed var(--fusion-accent-dim);
  }

  .spell-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--fusion-border);
  }

  .spell-card__btn {
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.3rem 0.65rem;
  }

  .spell-card__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .spell-card__btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .spell-card__btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .spell-card__btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text);
  }

  .spell-card__btn--danger {
    background: rgba(255, 92, 92, 0.12);
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }
</style>
