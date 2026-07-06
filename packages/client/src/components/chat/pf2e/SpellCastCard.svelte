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
  import { getSocket, session } from "$lib/session.svelte.js";
  import { getDocument, requireConnectedSocket, listPacks, searchPack } from "$lib/compendium/compendiumApi.js";
  import { DocumentDetailsCache } from "$lib/compendium/documentDetails.js";
  import DocumentDetailsPanel from "../../sheets/pf2e/DocumentDetailsPanel.svelte";
  import { buildSpellDetailsResolver, type SpellDetailsResolver } from "$lib/sheets/pf2e/characterSheetVM.js";
  import {
    resolveClickerActors,
    showSaveButton,
    canRollDamage,
    buildSaveRollOp,
    buildDamageRollOp,
    resolveSpellCastUuid,
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

  // --- Spell details popup (r17.2) ------------------------------------------
  // Clicking the spell NAME opens the same details popup as the Spells tab
  // (r14-B4): resolve the card's spell (spellNameEn, then spellName) to a
  // spells-core pack Compendium uuid, fetch + cache the full doc, and render
  // it via the shared DocumentDetailsPanel. No pack match / offline → a
  // discrete "not found" message instead of an endless spinner.
  const detailsCache = new DocumentDetailsCache();
  let spellDetailsResolver = $state<SpellDetailsResolver | null>(null);
  let resolverLoaded = $state(false);
  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  let detailsOpen = $state(false);
  let detailsDoc = $state<Record<string, unknown> | null>(null);
  let detailsLoading = $state(false);
  let detailsNotFound = $state(false);
  let detailsFetchId = 0; // guards a stale fetch resolving after close/reopen

  /**
   * Load the spells-core pack index once (lazily, on first click) and build a
   * name→uuid resolver via the SAME `buildSpellDetailsResolver` the Spells tab
   * uses (characterSheetVM.ts, r14-B4) — identical bilingual (EN/pt-BR)
   * accent/case-insensitive matching, imported rather than duplicated.
   */
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

  async function openSpellNameDetails(): Promise<void> {
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
    const uuid = resolveSpellCastUuid(card, resolver);
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

  function closeSpellNameDetails(): void {
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
    <button
      type="button"
      class="spell-card__title spell-name-btn"
      aria-label={t("FUSION.Sheet.Spells.SpellDetailsOpen", { name: card.spellName })}
      onclick={() => void openSpellNameDetails()}
    >{card.spellName}</button>
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

<!--
  Spell details popup (r17.2): clicking the card's spell NAME opens the same
  details UX as the Spells tab (DocumentDetailsPanel, r14-B4). Rendered as a
  fixed-position overlay ABOVE the whole layout (z-index 110, matching the
  sheet's spell-details-modal) so it works from the chat sidebar without
  disturbing the log's scroll. ESC / click-outside close.
-->
{#if detailsOpen}
  <div
    class="spell-cast-details-backdrop"
    role="presentation"
    onclick={closeSpellNameDetails}
    onkeydown={(e) => { if (e.key === "Escape") closeSpellNameDetails(); }}
  >
    <div
      class="spell-cast-details-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t("FUSION.Sheet.Spells.SpellDetailsTitle")}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") closeSpellNameDetails(); }}
    >
      <button
        type="button"
        class="spell-cast-details-modal__close"
        aria-label={t("FUSION.Dialog.Close")}
        onclick={closeSpellNameDetails}
      >&times;</button>
      {#if detailsNotFound}
        <p class="spell-cast-details-modal__not-found">{t("FUSION.Chat.SpellCard.DetailsNotFound")}</p>
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

  /*
   * Clickable spell name (r17.2) — same reset + hover accent as the sheet's
   * .spell-name-btn (SpellsTab.svelte, r14-B4): a real <button> with no
   * chrome, reading as inline title text until hovered/focused.
   */
  .spell-card__title.spell-name-btn {
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

  .spell-card__title.spell-name-btn:hover,
  .spell-card__title.spell-name-btn:focus-visible {
    color: var(--fusion-accent-hover);
    text-decoration: underline;
    text-underline-offset: 2px;
    outline: none;
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

  /*
   * Spell details popup (r17.2) — fixed-position overlay ABOVE the whole
   * layout (z-index 110, matching the sheet's .mini-backdrop /
   * .spell-details-modal, SpellsTab.svelte r14-B4) so it renders correctly
   * from the chat sidebar without disturbing the chat log's own scroll.
   */
  .spell-cast-details-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 110;
  }

  .spell-cast-details-modal {
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

  .spell-cast-details-modal__close {
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

  .spell-cast-details-modal__close:hover {
    color: var(--fusion-text);
    background: var(--fusion-surface-alt);
  }

  .spell-cast-details-modal__not-found {
    padding: 32px 16px;
    text-align: center;
    font-size: 12.5px;
    color: var(--fusion-text-muted);
    margin: 0;
  }
</style>
