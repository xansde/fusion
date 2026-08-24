<script lang="ts">
  /**
   * AbilityCard.svelte — generalized interactive PF2e ability chat card
   * (r20-X1). The GENERALIZATION of SpellCastCard.svelte: it renders
   * `flags.pf2e.abilityCard` (AbilityCard, @fusion/shared) for spells,
   * Kineticist impulses AND weapon strikes, mounted by ChatMessage.svelte in
   * place of the plain text body. Legacy `flags.pf2e.spellCast` messages are
   * adapted to an AbilityCard on read (ChatMessage.svelte) so old chat renders
   * through this same component.
   *
   * Actions (driven by which fields the card carries, not rigidly by kind):
   *   - "Fazer teste de resistência" (save type + DC present): ANY player may
   *     click — it is the TARGET who rolls. Resolves the clicker's actor
   *     (1 owned → auto; N owned or GM → mini-selector) and emits a chat:send
   *     `/r 1d20+<mod> # Salvaguarda...` with speaker = the chosen actor.
   *   - "Rolar dano" / "Rolar dano crítico" (damage / crit formula present):
   *     visible only to the user's owner / GM — emits a chat:send
   *     `/r <formula> # <flavor>` with speaker = the caster.
   * The ATTACK roll (spell-attack / strike / blast attack) is NOT a card button:
   * it is fired at announce time and nested under the card (r18-N1), so it shows
   * as a compact roll line above these buttons.
   *
   * All rolls run on the SERVER (RNG server-side, anti-cheat). This component
   * only decides which buttons to show and builds the ops via the pure VM.
   */

  import type { Socket } from "socket.io-client";
  import type { AbilityCard } from "@fusion/shared";
  import { t } from "$lib/i18n/i18n.js";
  import { sendOp } from "$lib/docs/sendOp.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import { getSocket, session } from "$lib/session.svelte.js";
  import { getDocument, requireConnectedSocket, listPacks, searchPack } from "$lib/compendium/compendiumApi.js";
  import { DocumentDetailsCache } from "$lib/compendium/documentDetails.js";
  import DocumentDetailsPanel from "../../sheets/pf2e/DocumentDetailsPanel.svelte";
  import { buildSpellDetailsResolver, type SpellDetailsResolver } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import {
    resolveClickerActors,
    showSaveButton,
    hasDamage,
    hasCritDamage,
    canRollDamage,
    buildSaveRollOp,
    buildDamageRollOp,
    resolveAbilityUuid,
    type ClickerActorOption,
    type AbilityChatOp,
    type ActorDocLike,
  } from "../../../lib/sheets/pf2e/abilityCardVM.js";

  interface Props {
    card: AbilityCard;
    /** Id of the chat message this card renders (r18-N1) — nests save/damage rolls under it. */
    messageId?: string;
    worldId: string;
    socket?: Socket | undefined;
    isGm?: boolean;
    userId?: string;
  }

  const { card, messageId, worldId, socket, isGm = false, userId = "" }: Props = $props();

  let pending = $state(false);
  let errorMsg = $state<string | null>(null);
  let selectorOpen = $state(false);

  // Per-kind header treatment (icon + accessible title). Damage/save buttons are
  // driven by the card's fields, not by kind.
  const KIND_ICON: Record<AbilityCard["kind"], string> = {
    spell: "✦",
    impulse: "◈",
    strike: "⚔",
  };
  const kindIcon = $derived(KIND_ICON[card.kind]);
  const cardTitle = $derived(t(`FUSION.Chat.AbilityCard.Title.${card.kind}`));
  // The ability NAME opens a compendium details popup ONLY for spells (the
  // resolver indexes the spells-core pack); impulse/strike names are plain text.
  const nameClickable = $derived(card.kind === "spell");

  // --- Spell details popup (r17.2, spells only) -----------------------------
  const detailsCache = new DocumentDetailsCache();
  let spellDetailsResolver = $state<SpellDetailsResolver | null>(null);
  let resolverLoaded = $state(false);
  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  let detailsOpen = $state(false);
  let detailsDoc = $state<Record<string, unknown> | null>(null);
  let detailsLoading = $state(false);
  let detailsNotFound = $state(false);
  let detailsFetchId = 0; // guards a stale fetch resolving after close/reopen

  async function loadSpellDetailsResolver(): Promise<void> {
    if (resolverLoaded) return;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
      const spellPack = packs.find((p) => p.id.endsWith(".spells-core")) ?? packs[0];
      if (!spellPack) return;
      const { entries } = await searchPack(sock, { packId: spellPack.id });
      spellDetailsResolver = buildSpellDetailsResolver(entries);
    } catch {
      // Offline / no socket / no pack: resolver stays null — the popup shows
      // the "not found" message rather than blocking the card.
    } finally {
      resolverLoaded = true;
    }
  }

  async function openNameDetails(): Promise<void> {
    if (!nameClickable) return;
    detailsOpen = true;
    detailsNotFound = false;
    const fetchId = ++detailsFetchId;
    await loadSpellDetailsResolver();
    if (fetchId !== detailsFetchId) return; // closed/reopened while loading
    const resolver = spellDetailsResolver;
    if (!resolver) {
      detailsNotFound = true;
      return;
    }
    const uuid = resolveAbilityUuid(card, resolver);
    if (!uuid) {
      detailsNotFound = true;
      return;
    }
    await loadSpellDetailsDoc(uuid, fetchId);
  }

  async function loadSpellDetailsDoc(uuid: string, fetchId: number): Promise<void> {
    const cached = detailsCache.get(uuid);
    if (cached) {
      detailsDoc = cached;
      detailsLoading = false;
      detailsNotFound = false;
      return;
    }
    detailsLoading = true;
    detailsNotFound = false;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { document } = await getDocument(sock, uuid);
      detailsCache.set(uuid, document);
      if (fetchId === detailsFetchId) detailsDoc = document;
    } catch {
      if (fetchId === detailsFetchId) {
        detailsNotFound = true;
        detailsDoc = null;
      }
    } finally {
      if (fetchId === detailsFetchId) detailsLoading = false;
    }
  }

  function closeNameDetails(): void {
    detailsOpen = false;
    detailsDoc = null;
    detailsLoading = false;
    detailsNotFound = false;
    detailsFetchId++; // invalidate any in-flight fetch/resolver load
  }

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
  const controllable = $derived(canRollDamage(card, casterActor, userId, isGm));
  const canDamage = $derived(controllable && hasDamage(card));
  const canCrit = $derived(controllable && hasCritDamage(card));

  const saveTypeLabel = $derived(
    card.saveType ? t(`FUSION.Sheet.Chat.SaveName.${card.saveType}`) : "",
  );

  // Damage-roll flavor prefix (the VM appends nothing extra — we pass the full
  // flavor). Spells keep the rank-aware "Ignição (nível 2)" phrasing; impulses
  // and strikes use the generic "<name> — Dano" / "— Crítico".
  const damageFlavor = $derived.by(() => {
    const dtype = card.damageType ? ` ${card.damageType}` : "";
    if (card.kind === "spell") {
      const prefix =
        (card.rank ?? 0) > 0
          ? t("FUSION.Sheet.Chat.SpellDamageHeightened", {
              name: card.name,
              rank: String(card.rank ?? 0),
            })
          : t("FUSION.Sheet.Chat.SpellDamage", { name: card.name });
      return `${prefix}${dtype}`;
    }
    return `${t("FUSION.Chat.AbilityCard.DamageFlavor", { name: card.name })}${dtype}`;
  });
  const critFlavor = $derived.by(() => {
    const dtype = card.damageType ? ` ${card.damageType}` : "";
    return `${t("FUSION.Chat.AbilityCard.CritFlavor", { name: card.name })}${dtype}`;
  });

  async function emit(op: AbilityChatOp): Promise<void> {
    if (!socket) {
      console.warn("[AbilityCard] no socket — cannot emit", op.type);
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
    // r18-N1: nest the save under this card's own message so the chat groups it.
    const op = buildSaveRollOp(card, actor, saveTypeLabel, worldId, messageId);
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
    const op = buildDamageRollOp(card, card.damageFormula, worldId, damageFlavor, messageId);
    if (op) await emit(op);
  }

  async function handleCritClick(): Promise<void> {
    const op = buildDamageRollOp(card, card.critDamageFormula, worldId, critFlavor, messageId);
    if (op) await emit(op);
  }
</script>

<div class="ability-card" aria-label={cardTitle}>
  <!-- Header -->
  <div class="ability-card__header">
    <span class="ability-card__icon ability-card__icon--{card.kind}" aria-hidden="true">{kindIcon}</span>
    {#if nameClickable}
      <button
        type="button"
        class="ability-card__title ability-name-btn"
        aria-label={t("FUSION.Sheet.Spells.SpellDetailsOpen", { name: card.name })}
        onclick={() => void openNameDetails()}
      >{card.name}</button>
    {:else}
      <span class="ability-card__title">{card.name}</span>
    {/if}
    {#if card.actionCost}
      <span class="ability-card__cost" aria-hidden="true">{card.actionCost}</span>
    {/if}
    {#if card.kind === "spell" && (card.rank ?? 0) > 0}
      <span class="ability-card__rank">{t("FUSION.Chat.SpellCard.Rank", { rank: String(card.rank ?? 0) })}</span>
    {/if}
  </div>

  <!-- Save / DC line -->
  {#if canSave}
    <div class="ability-card__save">
      {t("FUSION.Sheet.Chat.SpellCastSave", {
        dc: String(card.dcValue),
        save: saveTypeLabel,
        basic: card.basicSave ? t("FUSION.Sheet.Chat.SpellCastSaveBasic") : "",
      })}
    </div>
  {/if}

  <!-- Damage line (display) -->
  {#if card.damageFormula}
    <div class="ability-card__damage">
      {card.damageFormula}{#if card.damageType}<span class="ability-card__dtype"> {card.damageType}</span>{/if}
    </div>
  {/if}

  <!-- Traits -->
  {#if card.traits && card.traits.length > 0}
    <div class="ability-card__traits">
      {#each card.traits as trait (trait)}
        <span class="ability-card__trait">{trait}</span>
      {/each}
    </div>
  {/if}

  {#if errorMsg}
    <p class="ability-card__error" role="alert">{errorMsg}</p>
  {/if}

  <!-- Actor selector (N controllable actors) -->
  {#if selectorOpen && clickerActors.length > 1}
    <div class="ability-card__selector" role="group" aria-label={t("FUSION.Chat.SpellCard.PickActor")}>
      {#each clickerActors as opt (opt.id)}
        <button
          type="button"
          class="ability-card__btn ability-card__btn--ghost"
          onclick={() => rollSaveWith(opt.id)}
          disabled={pending}
        >
          {opt.name}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Actions -->
  {#if canSave || canDamage || canCrit}
    <div class="ability-card__actions">
      {#if canSave}
        <button
          type="button"
          class="ability-card__btn ability-card__btn--primary"
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
          class="ability-card__btn ability-card__btn--danger"
          onclick={handleDamageClick}
          disabled={pending}
        >
          {t("FUSION.Chat.SpellCard.RollDamage")}
        </button>
      {/if}
      {#if canCrit}
        <button
          type="button"
          class="ability-card__btn ability-card__btn--danger"
          onclick={handleCritClick}
          disabled={pending}
        >
          {t("FUSION.Chat.AbilityCard.RollCritDamage")}
        </button>
      {/if}
    </div>
  {/if}
</div>

<!--
  Ability details popup (spells only): clicking a spell card's NAME opens the
  same details UX as the Spells tab (DocumentDetailsPanel, r14-B4). Rendered as
  a fixed-position overlay ABOVE the whole layout so it works from the chat
  sidebar without disturbing the log's scroll. ESC / click-outside close.
-->
{#if detailsOpen}
  <div
    class="ability-details-backdrop"
    role="presentation"
    onclick={closeNameDetails}
    onkeydown={(e) => { if (e.key === "Escape") closeNameDetails(); }}
  >
    <div
      class="ability-details-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t("FUSION.Sheet.Spells.SpellDetailsTitle")}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") closeNameDetails(); }}
    >
      <button
        type="button"
        class="ability-details-modal__close"
        aria-label={t("FUSION.Dialog.Close")}
        onclick={closeNameDetails}
      >&times;</button>
      {#if detailsNotFound}
        <p class="ability-details-modal__not-found">{t("FUSION.Chat.SpellCard.DetailsNotFound")}</p>
      {:else}
        <DocumentDetailsPanel
          document={detailsDoc}
          loading={detailsLoading}
          error={false}
          onRetry={() => {}}
          loadingKey="FUSION.Sheet.Spells.Picker.Details.Loading"
          selectHintKey="FUSION.Sheet.Spells.Picker.Details.SelectHint"
          noDescriptionKey="FUSION.Sheet.Spells.Picker.Details.NoDescription"
        />
      {/if}
    </div>
  </div>
{/if}

<style>
  .ability-card {
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

  .ability-card__header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ability-card__icon--spell {
    color: #7c5cfc;
  }
  .ability-card__icon--impulse {
    color: #3ddc84;
  }
  .ability-card__icon--strike {
    color: #ff9f43;
  }

  .ability-card__title {
    flex: 1;
    font-weight: 600;
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  /* Clickable ability name (spells) — a real <button> with no chrome. */
  .ability-card__title.ability-name-btn {
    display: inline;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    font-family: var(--fusion-font);
    text-align: left;
    cursor: pointer;
    transition: color 0.12s;
  }

  .ability-card__title.ability-name-btn:hover,
  .ability-card__title.ability-name-btn:focus-visible {
    color: var(--fusion-accent-hover);
    text-decoration: underline;
    text-underline-offset: 2px;
    outline: none;
  }

  .ability-card__cost {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-accent);
    font-size: 0.85rem;
    letter-spacing: 1px;
  }

  .ability-card__rank {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .ability-card__save {
    font-size: 0.75rem;
    color: var(--fusion-text-muted);
  }

  .ability-card__damage {
    font-family: var(--fusion-font-mono);
    font-size: 0.8rem;
    color: var(--fusion-text);
  }

  .ability-card__dtype {
    color: var(--fusion-text-muted);
  }

  .ability-card__traits {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .ability-card__trait {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .ability-card__error {
    font-size: 0.7rem;
    color: var(--fusion-danger);
    margin: 0;
  }

  .ability-card__selector {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    border: 1px dashed var(--fusion-accent-dim);
  }

  .ability-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--fusion-border);
  }

  .ability-card__btn {
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.3rem 0.65rem;
  }

  .ability-card__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ability-card__btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .ability-card__btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .ability-card__btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text);
  }

  .ability-card__btn--danger {
    background: rgba(255, 92, 92, 0.12);
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .ability-details-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 110;
  }

  .ability-details-modal {
    position: relative;
    width: 440px;
    max-width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
  }

  .ability-details-modal__close {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    background: transparent;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: var(--fusion-radius-sm);
    font-family: var(--fusion-font);
  }

  .ability-details-modal__close:hover {
    color: var(--fusion-text);
    background: var(--fusion-surface-alt);
  }

  .ability-details-modal__not-found {
    padding: 32px 16px;
    text-align: center;
    font-size: 12.5px;
    color: var(--fusion-text-muted);
    margin: 0;
  }
</style>
