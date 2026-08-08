<script lang="ts">
  /**
   * ActionsTab.svelte — Pathbuilder-style action browser for the PF2e sheet's
   * Actions tab (below the existing Strikes section, which lives in
   * CharacterSheet.svelte and is NOT owned here).
   *
   * LAYOUT
   *   - A filter grid of group checkboxes (Class, Skills, Gear, Basic,
   *     Exploration, Downtime, Ancestry, Archetype, Background, Other — all
   *     enabled by default), each rendered with its localized label.
   *   - A cost sub-filter row (◆ / ◆◆ / ◆◆◆ / ⟳ / ◇) toggling the action-cost
   *     kinds, plus a name search box.
   *   - The result list: each row shows name, cost glyphs, a group badge, and a
   *     "do personagem" badge when the action comes from an embedded actor item.
   *     Character actions sort first. Light client-side pagination caps the
   *     rendered rows (the pack has hundreds of actions) with a "show more".
   *   - Clicking a row opens the shared DocumentDetailsPanel with the full,
   *     sanitized description fetched on demand (pack rows only — character-only
   *     rows have no compendium uuid and show their inline info).
   *
   * DATA / SOCKET
   *   The actions-core pack is loaded through the SAME compendium socket API the
   *   pickers use (actionsVM.loadActionEntries), resolving the LIVE socket via
   *   getSocket() on demand — never a frozen prop (r10 lesson). Explicit
   *   loading / not-connected / load-error states with retry (never an endless
   *   spinner). Embedded actor actions are merged in from the `doc.items` array.
   *
   * Clean-room: description prose shown in the details panel is ORC/OGL-gated at
   * import time (W2-C1/stripFlavorProse) and only rendered here (sanitized,
   * allow-listed tags, @Tag[...] refs rewritten to text — documentDetails.ts).
   */

  import type { PackIndexEntry } from "@fusion/shared";
  import DocumentDetailsPanel from "./DocumentDetailsPanel.svelte";
  import { getDocument, requireConnectedSocket } from "../../../lib/compendium/compendiumApi.js";
  import {
    DocumentDetailsCache,
    traitDisplayName,
    translateDamageType,
  } from "../../../lib/compendium/documentDetails.js";
  import { makeSendOpFn, sendChatOpForId } from "../../../lib/docs/sendOp.js";
  import {
    loadActionEntries,
    loadActionNameIndexEntries,
    buildActionNameIndex,
    buildActionSourceIdIndex,
    classifyLoadError,
    mergeActionRows,
    filterActionRows,
    filterRelevantRows,
    deriveCharacterProfile,
    sortActionRows,
    actionRowNameParts,
    buildEmbeddedDetailsDoc,
    mergeEmbeddedNameOverlay,
    needsFallbackDescription,
    withFallbackDescription,
    descriptionHtmlOf,
    parseImpulseSaveCue,
    parseImpulseDamage,
    kineticistClassDc,
    buildImpulseCard,
    readElementalBlasts,
    buildElementalBlastCard,
    paginate,
    ACTIONS_PAGE_SIZE,
    GROUP_ORDER,
    type ActionRow,
    type ActionChatOp,
    type BlastRowVM,
    type ActionCostFilter,
    type ActionsLoadError,
  } from "../../../lib/sheets/pf2e/actionsVM.js";
  import {
    ACTION_GROUP_LABELS,
    groupLabelKey,
    type ActionGroup,
  } from "../../../lib/sheets/pf2e/actionCategories.js";
  import { session, getSocket } from "../../../lib/session.svelte.js";
  import { t, i18n } from "../../../lib/i18n/i18n.js";

  interface Props {
    /** The reactive actor document — its `items` array feeds character actions. */
    doc: Record<string, unknown>;
  }

  let { doc }: Props = $props();

  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  // The active world + this actor, for the "Usar" impulse chat announcement
  // (r19-W3). worldId MUST equal the connected world's id — the server rejects a
  // chat:send whose payload.worldId differs (chat-handler.ts). session.worldInfo.id
  // is the SAME source the spell-cast flow uses (ActorDirectory → CharacterSheet).
  const worldId = $derived(session.worldInfo?.id ?? "");
  const speakerActorId = $derived(typeof doc["_id"] === "string" ? (doc["_id"] as string) : "");
  // Lazy live-socket sender (frozen-socket safe, r10 lesson): resolves getSocket()
  // on every op. Fire-and-forget — a disconnected socket logs and drops (the tab
  // already shows its own not-connected state for the pack load).
  const sendOpFn = makeSendOpFn(getSocket);

  // --- Load state -----------------------------------------------------------
  let loading = $state(true);
  let errorKind = $state<ActionsLoadError>(null);
  let packEntries = $state<PackIndexEntry[]>([]);
  // Supplementary feats-core index for enriching embedded action rows with
  // pt-BR names + description-fallback uuids (B1 r14 #4/#5). Best-effort: a
  // failed/empty load simply leaves character-feat actions in EN (prior
  // behavior), never blocks the tab.
  let nameIndexEntries = $state<PackIndexEntry[]>([]);

  // --- Filter state ---------------------------------------------------------
  // Runes can't hold a Set reactively across mutation the way we want without a
  // reassign, so we mirror the group toggles / cost toggles as plain reactive
  // structures and rebuild the ActionFilterState in a $derived.
  let enabledGroups = $state<Set<ActionGroup>>(new Set(GROUP_ORDER));
  let enabledCosts = $state<Set<ActionCostFilter>>(new Set());
  let search = $state("");
  // Character-relevance filter (default ON): hide actions the character can't
  // take (other classes' / ancestries' / archetypes' actions). "Mostrar todas"
  // reveals the full pack.
  let showAll = $state(false);

  // --- Details panel state --------------------------------------------------
  const detailsCache = new DocumentDetailsCache();
  let selectedKey = $state<string | null>(null);
  let detailsDoc = $state<Record<string, unknown> | null>(null);
  let detailsLoading = $state(false);
  let detailsError = $state(false);

  // --- Pagination -----------------------------------------------------------
  let visibleCount = $state(ACTIONS_PAGE_SIZE);

  const COST_CHIPS: Array<{ cost: ActionCostFilter; glyphs: string; labelKey: string }> = [
    { cost: "1", glyphs: "◆", labelKey: "FUSION.Sheet.Actions.Cost.One" },
    { cost: "2", glyphs: "◆◆", labelKey: "FUSION.Sheet.Actions.Cost.Two" },
    { cost: "3", glyphs: "◆◆◆", labelKey: "FUSION.Sheet.Actions.Cost.Three" },
    { cost: "reaction", glyphs: "⟳", labelKey: "FUSION.Sheet.Actions.Cost.Reaction" },
    { cost: "free", glyphs: "◇", labelKey: "FUSION.Sheet.Actions.Cost.Free" },
  ];

  $effect(() => {
    void loadActions();
  });

  async function loadActions(): Promise<void> {
    loading = true;
    errorKind = null;
    try {
      packEntries = await loadActionEntries(getSocket, systemId);
    } catch (err) {
      errorKind = classifyLoadError(err);
      packEntries = [];
    } finally {
      loading = false;
    }
    // Load the supplementary name index separately — its failure must NOT
    // surface as an Actions load error (the main pack already loaded); worst
    // case, character feats stay EN.
    try {
      nameIndexEntries = await loadActionNameIndexEntries(getSocket, systemId);
    } catch {
      nameIndexEntries = [];
    }
  }

  const embeddedItems = $derived.by((): Array<Record<string, unknown>> => {
    const items = doc["items"];
    if (!Array.isArray(items)) return [];
    return items.filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null);
  });

  // Index embedded items by their _id so a selected character row can render
  // its OWN description without any compendium fetch (key is "embedded:<_id>").
  const embeddedById = $derived.by((): Map<string, Record<string, unknown>> => {
    const map = new Map<string, Record<string, unknown>>();
    for (const it of embeddedItems) {
      const id = it["_id"];
      if (typeof id === "string") map.set(id, it);
    }
    return map;
  });

  const nameIndex = $derived(buildActionNameIndex(nameIndexEntries));
  // sourceId index (issue #42): combines actions-core + feats-core entries,
  // actions-core listed first so it wins on a collision — the same
  // pack-priority order `nameIndex` has always used for its slug index.
  const sourceIdIndex = $derived(buildActionSourceIdIndex([...packEntries, ...nameIndexEntries]));
  const allRows = $derived(mergeActionRows(packEntries, embeddedItems, nameIndex, sourceIdIndex));

  // The character's class/ancestry/archetype identity, for the relevance filter.
  const profile = $derived(deriveCharacterProfile(embeddedItems));

  // Kineticist Elemental Blast shortcut rows, read from the actor's server-derived
  // system.derived.elementalBlasts (r19-W3 item 2). Empty for non-kineticists.
  const blastRows = $derived(readElementalBlasts(doc));

  // Rows surviving the character-relevance pre-filter (all rows when showAll).
  // Group counts derive from THIS set so each checkbox reflects the relevance
  // filter, not the raw 521-action pack.
  const relevantRows = $derived(filterRelevantRows(allRows, profile, showAll));

  // Per-group counts of the relevance-filtered set (independent of which groups
  // are currently toggled on), shown beside each group checkbox.
  const groupCounts = $derived.by((): Record<ActionGroup, number> => {
    const counts = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<ActionGroup, number>;
    for (const row of relevantRows) counts[row.group] += 1;
    return counts;
  });

  const filtered = $derived.by(() => {
    const rows = filterActionRows(relevantRows, {
      groups: enabledGroups,
      costs: enabledCosts,
      search,
    });
    return sortActionRows(rows);
  });

  const page = $derived(paginate(filtered, visibleCount));
  const visibleRows = $derived(page.visible);

  // Reset pagination whenever the filter result set changes shape.
  $effect(() => {
    // Touch the length so this re-runs when filters change.
    void filtered.length;
    visibleCount = ACTIONS_PAGE_SIZE;
  });

  function toggleGroup(group: ActionGroup): void {
    const next = new Set(enabledGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    enabledGroups = next;
  }

  function toggleCost(cost: ActionCostFilter): void {
    const next = new Set(enabledCosts);
    if (next.has(cost)) next.delete(cost);
    else next.add(cost);
    enabledCosts = next;
  }

  /**
   * Attach the row's pt-BR name overlay onto an embedded details doc so the
   * shared DocumentDetailsPanel header renders the translated name (with the EN
   * name as a subtitle) exactly like pack docs. Embedded items are EN of birth;
   * the pt-BR name was inherited from the deduped pack row on merge. When the
   * row has no translation (namePt null) the doc is returned unchanged (EN). T1.
   *
   * Delegates to {@link mergeEmbeddedNameOverlay} (actionsVM.ts), which MERGES
   * into any i18n bag already persisted on the doc rather than replacing it
   * (issue #10 — the prior inline version overwrote the whole bag with
   * `{ptBR:{name}}`, discarding a persisted `i18n.ptBR.description`).
   */
  function localizeEmbeddedDoc(
    rowItem: ActionRow,
    embeddedDoc: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    return mergeEmbeddedNameOverlay(embeddedDoc, rowItem.namePt);
  }

  function selectRow(rowItem: ActionRow): void {
    selectedKey = rowItem.key;
    if (rowItem.uuid) {
      void loadDetails(rowItem.key, rowItem.uuid);
      return;
    }
    // Character-only action with no compendium uuid — render the embedded
    // item's OWN description directly (no fetch). Key is "embedded:<_id>".
    const itemId = rowItem.key.startsWith("embedded:") ? rowItem.key.slice("embedded:".length) : "";
    const embeddedDoc = localizeEmbeddedDoc(rowItem, buildEmbeddedDetailsDoc(embeddedById.get(itemId)));
    // Prefer the pack doc's description over the embedded prose when a
    // fallbackUuid resolved, in two cases:
    //   (a) the embedded description is empty — heal-on-read for items embedded
    //       before the r11 ORC/OGL policy (they carry an empty description);
    //   (b) the active locale is pt-BR AND a pt-BR translation exists for this
    //       row (signaled by namePt !== null — the feats-core name enrichment
    //       sets namePt and fallbackUuid together, r14 #5). Embedded character
    //       feats (Magus's Analysis, Bon Mot) carry EN-only prose in their own
    //       system.description, so without this the panel would show EN even
    //       though the pack doc has i18n.ptBR.description. withFallbackDescription
    //       is locale-aware and falls back to EN when the pack has no
    //       translation, so this never regresses untranslated actions.
    // Either way the embedded identity (name / "Do personagem" badge) is kept.
    const wantsLocalizedFallback = i18n.locale === "pt-BR" && rowItem.namePt !== null;
    if (rowItem.fallbackUuid && (needsFallbackDescription(embeddedDoc) || wantsLocalizedFallback)) {
      void loadEmbeddedFallback(rowItem.key, rowItem.fallbackUuid, embeddedDoc);
      return;
    }
    detailsDoc = embeddedDoc;
    detailsLoading = false;
    detailsError = false;
  }

  async function loadDetails(key: string, uuid: string): Promise<void> {
    const cached = detailsCache.get(uuid);
    if (cached) {
      detailsDoc = cached;
      detailsLoading = false;
      detailsError = false;
      return;
    }
    detailsLoading = true;
    detailsError = false;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { document } = await getDocument(sock, uuid);
      detailsCache.set(uuid, document);
      if (selectedKey === key) detailsDoc = document;
    } catch {
      if (selectedKey === key) {
        detailsError = true;
        detailsDoc = null;
      }
    } finally {
      if (selectedKey === key) detailsLoading = false;
    }
  }

  /**
   * Fetch the pack doc behind an embedded row's fallbackUuid and render its
   * description under the embedded item's identity. Uses the SAME on-demand
   * cache/socket path as loadDetails, with visible loading/error/retry states
   * (never an endless spinner).
   */
  async function loadEmbeddedFallback(
    key: string,
    fallbackUuid: string,
    embeddedDoc: Record<string, unknown> | null,
  ): Promise<void> {
    const cached = detailsCache.get(fallbackUuid);
    if (cached) {
      detailsDoc = withFallbackDescription(embeddedDoc, cached, i18n.locale);
      detailsLoading = false;
      detailsError = false;
      return;
    }
    detailsLoading = true;
    detailsError = false;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { document } = await getDocument(sock, fallbackUuid);
      detailsCache.set(fallbackUuid, document);
      if (selectedKey === key) detailsDoc = withFallbackDescription(embeddedDoc, document, i18n.locale);
    } catch {
      if (selectedKey === key) {
        detailsError = true;
        detailsDoc = null;
      }
    } finally {
      if (selectedKey === key) detailsLoading = false;
    }
  }

  function retryDetails(): void {
    const rowItem = filtered.find((r) => r.key === selectedKey);
    if (!rowItem) return;
    if (rowItem.uuid) {
      void loadDetails(rowItem.key, rowItem.uuid);
      return;
    }
    if (rowItem.fallbackUuid) {
      const itemId = rowItem.key.startsWith("embedded:") ? rowItem.key.slice("embedded:".length) : "";
      const embeddedDoc = localizeEmbeddedDoc(rowItem, buildEmbeddedDetailsDoc(embeddedById.get(itemId)));
      void loadEmbeddedFallback(rowItem.key, rowItem.fallbackUuid, embeddedDoc);
    }
  }

  /**
   * Announce an impulse use in chat (r19-W3): a plain-text chat:send message
   * ("<verb> <name> <glyphs> (<traits pt-BR>)[ — CD X, <save>]") spoken by this
   * actor. NO structured card (that territory is the chat feature). When the
   * impulse's description carries an @Check save AND the actor has a derived
   * Kineticist class DC, a save line is appended (Shard Strike → "CD 19,
   * Reflexos básico"). Fire-and-forget via the live-socket sender.
   */
  function useImpulse(rowItem: ActionRow): void {
    if (!speakerActorId) return;
    const parts = actionRowNameParts(rowItem, i18n.locale);
    const traitLabels = rowItem.traits.map((tr) => traitDisplayName(tr, i18n.locale));

    // Resolve the impulse's own description (embedded item) for the save + damage
    // automation cues.
    const itemId = rowItem.key.startsWith("embedded:") ? rowItem.key.slice("embedded:".length) : "";
    const embItem = embeddedById.get(itemId);
    const sys =
      embItem && typeof embItem["system"] === "object" && embItem["system"] !== null
        ? (embItem["system"] as Record<string, unknown>)
        : {};
    const descriptionHtml = descriptionHtmlOf(sys);
    const cue = parseImpulseSaveCue(descriptionHtml);
    const damage = parseImpulseDamage(descriptionHtml);
    const dc = kineticistClassDc(doc);

    // Optional save line (text, old clients), only for save impulses with a DC.
    let saveLine: string | null = null;
    if (cue && dc !== null) {
      const saveLabel = t(
        `FUSION.Sheet.Actions.Save.${cue.save.charAt(0).toUpperCase()}${cue.save.slice(1)}`,
      );
      saveLine = t(cue.basic ? "FUSION.Sheet.Actions.UseSaveBasic" : "FUSION.Sheet.Actions.UseSave", {
        dc,
        save: saveLabel,
      });
    }

    // Build the interactive impulse card (r20-X1). Save/damage buttons on the
    // card nest under the announcement via its own message id (fire-and-forget
    // is fine — there is no auto-attack to chain).
    const op = buildImpulseCard({
      verb: t("FUSION.Sheet.Actions.UseVerb"),
      displayName: parts.display,
      nameEn: rowItem.nameEn,
      glyphs: rowItem.cost.glyphs,
      traitLabels,
      traitSlugs: rowItem.traits,
      saveCue: cue,
      classDc: dc,
      saveLine,
      damage,
      worldId,
      speakerActorId,
    });
    if (op) sendOpFn(op);
  }

  /** Localized element label for a blast row ("Ar", "Metal", …), slug fallback. */
  function blastElementLabel(element: string): string {
    return t(`FUSION.Sheet.Plan.KineticGate.Element.${element}`) || element;
  }

  /** Format an attack modifier with an explicit sign (+9 / -1 / +0). */
  function fmtSign(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  /**
   * Roll an Elemental Blast's MAP-0 attack in chat (r19-W3 item 2) using the
   * SERVER-DERIVED formula from doc.system.derived.elementalBlasts — no roll
   * logic is re-derived here (the RNG runs on the server). MAP variants + damage
   * live on the Main tab; this is the shortcut's single attack button.
   */
  function rollBlast(blast: BlastRowVM): void {
    if (!speakerActorId) return;
    const cardName = t("FUSION.Sheet.Chat.BlastFlavor", { element: blastElementLabel(blast.element) });
    const attackFlavor = t("FUSION.Sheet.Chat.BlastMap", { label: cardName, map: 0 });
    const built = buildElementalBlastCard({
      blast,
      cardName,
      attackFlavor,
      worldId,
      speakerActorId,
    });
    if (built) emitBlast(built);
  }

  /**
   * Emit a Rajada card announcement + its MAP-0 attack, NESTING the attack under
   * the announcement (r20-X1) so attack + (card) damage read as ONE card. Sends
   * the announcement over a live socket awaiting its ack (sendChatOpForId), then
   * fires the attack with `parentMessageId`. On any failure (no socket / ack
   * error) falls back to un-nested delivery so a roll is NEVER lost. Mirrors the
   * spell-cast emitCast (SpellsTab.svelte).
   */
  function emitBlast(built: { announcement: ActionChatOp; attack: ActionChatOp }): void {
    const sock = getSocket();
    if (!sock) {
      sendOpFn(built.announcement);
      sendOpFn(built.attack);
      return;
    }
    void (async () => {
      try {
        const parentId = await sendChatOpForId(sock, built.announcement);
        const nested: ActionChatOp = parentId
          ? { ...built.attack, flags: { ...built.attack.flags, parentMessageId: parentId } }
          : built.attack;
        sendOpFn(nested);
      } catch {
        sendOpFn(built.announcement);
        sendOpFn(built.attack);
      }
    })();
  }

  function groupBadgeLabel(group: ActionGroup): string {
    return t(groupLabelKey(group)) || ACTION_GROUP_LABELS[group];
  }
</script>

<div class="actions-browser">
  <div class="actions-browser__main">
    <!-- Elemental Blast shortcut (Kineticist) — points to the Main tab for the
         full attack (MAP variants) + damage; offers a quick MAP-0 attack roll. -->
    {#if blastRows.length > 0}
      <div class="actions-blasts" aria-label={t("FUSION.Sheet.Actions.Blast.Title")}>
        <div class="actions-blasts__header">
          <span class="actions-blasts__title">{t("FUSION.Sheet.Actions.Blast.Title")}</span>
          <span class="actions-blasts__hint">{t("FUSION.Sheet.Actions.Blast.MainTabHint")}</span>
        </div>
        {#each blastRows as blast (blast.element)}
          <div class="actions-blast-row">
            <div class="actions-blast-row__main">
              <span class="actions-blast-row__name">
                {t("FUSION.Sheet.Chat.BlastFlavor", { element: blastElementLabel(blast.element) })}
              </span>
              <div class="actions-blast-row__meta">
                {#if blast.damageType}
                  <span class="actions-blast-row__chip">{translateDamageType(blast.damageType, i18n.locale)}</span>
                {/if}
                {#if blast.attackFormula}
                  <span class="actions-blast-row__stat">
                    {t("FUSION.Sheet.Actions.Blast.Attack", { bonus: fmtSign(blast.attackTotal) })}
                  </span>
                {/if}
                {#if blast.damageFormula}
                  <span class="actions-blast-row__stat">
                    {t("FUSION.Sheet.Actions.Blast.Damage", { formula: blast.damageFormula })}
                  </span>
                {/if}
              </div>
            </div>
            {#if blast.attackFormula}
              <button type="button" class="actions-row__use" onclick={() => rollBlast(blast)}>
                {t("FUSION.Sheet.Actions.Blast.Roll")}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Group filter grid -->
    <div class="actions-filters" role="group" aria-label={t("FUSION.Sheet.Actions.GroupsLabel")}>
      {#each GROUP_ORDER as group (group)}
        <label class="actions-check" class:actions-check--on={enabledGroups.has(group)}>
          <input
            type="checkbox"
            checked={enabledGroups.has(group)}
            onchange={() => toggleGroup(group)}
          />
          <span>{groupBadgeLabel(group)}</span>
          <span class="actions-check__count">{groupCounts[group]}</span>
        </label>
      {/each}
    </div>

    <!-- Cost sub-filter + search -->
    <div class="actions-controls">
      <div class="actions-cost-filters" role="group" aria-label={t("FUSION.Sheet.Actions.CostLabel")}>
        {#each COST_CHIPS as chip (chip.cost)}
          <button
            type="button"
            class="actions-cost-chip"
            class:actions-cost-chip--active={enabledCosts.has(chip.cost)}
            aria-pressed={enabledCosts.has(chip.cost)}
            aria-label={t(chip.labelKey)}
            title={t(chip.labelKey)}
            onclick={() => toggleCost(chip.cost)}
          >
            <span class="actions-cost-chip__glyph">{chip.glyphs}</span>
          </button>
        {/each}
      </div>
      <div class="actions-search">
        <span class="actions-search__icon" aria-hidden="true">&#128269;</span>
        <input
          type="text"
          class="actions-search__input"
          placeholder={t("FUSION.Sheet.Actions.SearchPlaceholder")}
          bind:value={search}
        />
      </div>
      <button
        type="button"
        class="actions-showall"
        class:actions-showall--active={showAll}
        aria-pressed={showAll}
        title={t("FUSION.Sheet.Actions.ShowAllHint")}
        onclick={() => { showAll = !showAll; }}
      >
        {t("FUSION.Sheet.Actions.ShowAll")}
      </button>
    </div>

    <!-- Result list -->
    <div class="actions-results">
      {#if loading}
        <div class="actions-empty">{t("FUSION.Sheet.Actions.Loading")}</div>
      {:else if errorKind}
        <div class="actions-empty actions-empty--error">
          <span>
            {errorKind === "not-connected"
              ? t("FUSION.Sheet.Actions.NotConnected")
              : t("FUSION.Sheet.Actions.LoadError")}
          </span>
          <button type="button" class="actions-retry" onclick={() => void loadActions()}>
            {t("FUSION.Sheet.Actions.Retry")}
          </button>
        </div>
      {:else if filtered.length === 0}
        <div class="actions-empty">
          <span>{t("FUSION.Sheet.Actions.NoResults")}</span>
          <span class="actions-empty__hint">{t("FUSION.Sheet.Actions.NoResultsHint")}</span>
        </div>
      {:else}
        {#each visibleRows as rowItem (rowItem.key)}
          {@const nameParts = actionRowNameParts(rowItem, i18n.locale)}
          <div
            class="actions-row"
            class:actions-row--selected={selectedKey === rowItem.key}
            role="button"
            tabindex="0"
            onclick={() => selectRow(rowItem)}
            onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectRow(rowItem); } }}
          >
            <span class="actions-row__cost" aria-hidden="true">{rowItem.cost.glyphs}</span>
            <div class="actions-row__main">
              <div class="actions-row__name">
                {nameParts.display}
                {#if nameParts.subtitleEn}
                  <span class="actions-row__name-en" title={nameParts.subtitleEn}>{nameParts.subtitleEn}</span>
                {/if}
              </div>
              {#if rowItem.traits.length > 0}
                <div class="actions-row__traits">
                  {#each rowItem.traits as trait (trait)}
                    <span class="actions-row__trait">{traitDisplayName(trait, i18n.locale)}</span>
                  {/each}
                </div>
              {/if}
            </div>
            {#if rowItem.isImpulse}
              <button
                type="button"
                class="actions-row__use"
                aria-label={t("FUSION.Sheet.Actions.Use")}
                title={t("FUSION.Sheet.Actions.Use")}
                onclick={(e) => { e.stopPropagation(); useImpulse(rowItem); }}
                onkeydown={(e) => e.stopPropagation()}
              >
                {t("FUSION.Sheet.Actions.Use")}
              </button>
            {/if}
            <div class="actions-row__badges">
              {#if rowItem.isImpulse}
                <span class="actions-badge actions-badge--impulse">
                  {t("FUSION.Sheet.Actions.Impulse")}
                </span>
              {/if}
              {#if rowItem.fromCharacter}
                <span class="actions-badge actions-badge--character">
                  {t("FUSION.Sheet.Actions.FromCharacter")}
                </span>
              {/if}
              <span class="actions-badge actions-badge--group">{groupBadgeLabel(rowItem.group)}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if !loading && !errorKind && page.hasMore}
      <button
        type="button"
        class="actions-showmore"
        onclick={() => { visibleCount += ACTIONS_PAGE_SIZE; }}
      >
        {t("FUSION.Sheet.Actions.ShowMore", { count: page.remaining })}
      </button>
    {/if}
  </div>

  <div class="actions-browser__side">
    {#if selectedKey === null}
      <div class="actions-side-hint">{t("FUSION.Sheet.Actions.Details.SelectHint")}</div>
    {:else}
      <DocumentDetailsPanel
        document={detailsDoc}
        loading={detailsLoading}
        error={detailsError}
        onRetry={retryDetails}
        loadingKey="FUSION.Sheet.Actions.Details.Loading"
        loadErrorKey="FUSION.Sheet.Actions.Details.LoadError"
        retryKey="FUSION.Sheet.Actions.Details.Retry"
        selectHintKey="FUSION.Sheet.Actions.Details.SelectHint"
        noDescriptionKey="FUSION.Sheet.Actions.Details.NoDescription"
      />
    {/if}
  </div>
</div>

<style>
  .actions-browser {
    display: flex;
    flex-direction: row;
    gap: 14px;
    min-height: 0;
  }

  .actions-browser__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .actions-browser__side {
    width: 300px;
    flex-shrink: 0;
    border-left: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
    border-radius: var(--fusion-radius);
    overflow-y: auto;
    max-height: 480px;
  }

  @media (max-width: 720px) {
    .actions-browser {
      flex-direction: column;
    }

    .actions-browser__side {
      width: 100%;
      border-left: none;
      border-top: 1px solid var(--fusion-border);
      max-height: 260px;
    }
  }

  .actions-blasts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border: 1px solid var(--fusion-warning);
    background: var(--fusion-warning-dim);
    border-radius: var(--fusion-radius);
  }

  .actions-blasts__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .actions-blasts__title {
    font-family: var(--fusion-font);
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-warning);
  }

  .actions-blasts__hint {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
  }

  .actions-blast-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
  }

  .actions-blast-row__main {
    flex: 1;
    min-width: 0;
  }

  .actions-blast-row__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .actions-blast-row__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    flex-wrap: wrap;
  }

  .actions-blast-row__chip {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    padding: 1px 6px;
    border-radius: var(--fusion-radius-sm);
  }

  .actions-blast-row__stat {
    font-size: 10.5px;
    font-family: var(--fusion-font-mono);
    color: var(--fusion-text-muted);
  }

  .actions-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .actions-check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--fusion-font);
    padding: 4px 10px;
    border-radius: var(--fusion-radius-pill);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    background: transparent;
    cursor: pointer;
    user-select: none;
  }

  .actions-check input {
    accent-color: var(--fusion-accent);
    cursor: pointer;
    margin: 0;
  }

  .actions-check--on {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .actions-check__count {
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface);
    border-radius: var(--fusion-radius-pill);
    padding: 0 5px;
    min-width: 16px;
    text-align: center;
  }

  .actions-check--on .actions-check__count {
    color: var(--fusion-accent);
    background: var(--fusion-surface);
  }

  .actions-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .actions-cost-filters {
    display: flex;
    gap: 5px;
  }

  .actions-cost-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--fusion-radius);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-family: var(--fusion-font-mono);
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .actions-cost-chip:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .actions-cost-chip--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .actions-cost-chip__glyph {
    font-size: 11px;
    line-height: 1;
    letter-spacing: -1px;
  }

  .actions-search {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 160px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 6px 12px;
  }

  .actions-search:focus-within {
    border-color: var(--fusion-accent);
  }

  .actions-search__icon {
    color: var(--fusion-text-subtle);
    font-size: 13px;
    line-height: 1;
  }

  .actions-search__input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fusion-text);
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .actions-showall {
    flex-shrink: 0;
    font-family: var(--fusion-font);
    font-weight: 600;
    font-size: 11px;
    cursor: pointer;
    padding: 6px 12px;
    border-radius: var(--fusion-radius-pill);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
    white-space: nowrap;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .actions-showall:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .actions-showall--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .actions-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 4px;
    /*
     * No inner max-height/overflow: the whole list flows in the tab panel,
     * which is the single vertical scroller (.tab-panel: overflow-y: auto).
     * A nested scroller here buried the "show more" button (r12 blocker) and
     * fought the outer scroll — keeping one scroller lets the user reach every
     * row and the button below the list.
     */
  }

  .actions-empty {
    padding: 28px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .actions-empty--error {
    color: var(--fusion-danger);
  }

  .actions-empty__hint {
    font-size: 11.5px;
    color: var(--fusion-text-subtle);
  }

  .actions-retry {
    font-family: var(--fusion-font);
    font-weight: 600;
    cursor: pointer;
    padding: 6px 12px;
    font-size: 12px;
    border-radius: var(--fusion-radius);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .actions-retry:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
  }

  .actions-row:hover {
    background: var(--fusion-surface-alt);
  }

  .actions-row--selected {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .actions-row__cost {
    min-width: 30px;
    text-align: center;
    flex-shrink: 0;
    font-family: var(--fusion-font-mono);
    font-size: 11px;
    letter-spacing: -1px;
    color: var(--fusion-text-muted);
  }

  .actions-row--selected .actions-row__cost {
    color: var(--fusion-accent);
  }

  .actions-row__main {
    flex: 1;
    min-width: 0;
  }

  .actions-row__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .actions-row__name-en {
    margin-left: 6px;
    font-size: 10.5px;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }

  .actions-row__traits {
    display: flex;
    gap: 4px;
    margin-top: 3px;
    flex-wrap: wrap;
  }

  .actions-row__trait {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    padding: 1px 6px;
    border-radius: var(--fusion-radius-sm);
  }

  .actions-row__use {
    flex-shrink: 0;
    font-family: var(--fusion-font);
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    padding: 3px 10px;
    border-radius: var(--fusion-radius-pill);
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: 1px solid var(--fusion-accent);
    transition: filter 0.12s;
  }

  .actions-row__use:hover {
    filter: brightness(1.08);
  }

  .actions-row__badges {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .actions-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 7px;
    border-radius: var(--fusion-radius-sm);
    white-space: nowrap;
  }

  .actions-badge--group {
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
  }

  .actions-badge--character {
    color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
    border: 1px solid var(--fusion-accent);
  }

  .actions-badge--impulse {
    color: var(--fusion-warning);
    background: var(--fusion-warning-dim);
    border: 1px solid var(--fusion-warning);
  }

  .actions-showmore {
    align-self: center;
    margin: 2px 0;
    font-family: var(--fusion-font);
    font-weight: 600;
    font-size: 11.5px;
    cursor: pointer;
    padding: 6px 14px;
    border-radius: var(--fusion-radius-pill);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .actions-showmore:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .actions-side-hint {
    padding: 32px 14px;
    text-align: center;
    font-size: 12.5px;
    color: var(--fusion-text-muted);
  }
</style>
