<script lang="ts">
  /**
   * SpellsTab.svelte — Spells tab body (DEC-R10-03, DEC-R10-04).
   *
   * Ports the design contract's MagiasTab.jsx
   * (.fusion-build/r10-design/claude-design/ui_kits/ficha-pf2e/MagiasTab.jsx)
   * to Svelte 5. Sub-tabs come from vm.spellTabs (one per non-focus
   * spellcasting entry + a collapsed "Focus" tab + a conditional "Rituals"
   * tab). Renders:
   *   - "entry" tab: stats bar (DC/Attack/Tradition/Ability/Proficiency),
   *     cantrips row, ranked slots (prepared/empty-dashed/expended states
   *     with Lançar/Trocar/Gastar), grimoire list with "+ Adicionar magia".
   *   - "focus" tab: focus pips (cap 3, DEC-R10-02) + focus spell(s) with Lançar.
   *   - "rituals" tab: empty state (REQ-PF2-087 is V2).
   *
   * Item ops (add/remove/prepare/unprepare/expend) are sent IMMEDIATELY (no
   * debounce) via sendOpFn — unlike field autosave, there's no "typing" to
   * coalesce and the UI needs instant feedback for slot state.
   *
   * GUIDED 2-STEP FLOW (UX decision):
   *   - "Adicionar ao grimório" (picker "add" mode) → the new grimoire row is
   *     highlighted briefly and a toast offers "Preparar agora" (first empty
   *     slot of the spell's rank; a mini-menu when several are empty).
   *   - An empty slot opens a "Preparar do grimório" mini-menu (eligible
   *     known spells, rank 1..slotRank) with a "buscar no compêndio…" link
   *     that opens the compendium picker pre-filtered to the slot's rank.
   *   - Picking from the compendium in "prepare" mode both adds the spell to
   *     the grimoire AND auto-prepares it into the originating slot once the
   *     created item arrives from the server (pendingPrepare effect below —
   *     the item id only exists after the server ack + mirror broadcast).
   */

  import type { CharacterSheetVM, SpellTabRow, SpellcastingEntryRow, SpellRow, SpellNameTranslator, SpellDetailsResolver } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import { buildSpellNameTranslator, buildSpellDetailsResolver } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import ProficiencyBadge from "./ProficiencyBadge.svelte";
  import SpellPickerDialog from "./SpellPickerDialog.svelte";
  import DocumentDetailsPanel from "./DocumentDetailsPanel.svelte";
  import { getDocument, requireConnectedSocket, listPacks, searchPack } from "../../../lib/compendium/compendiumApi.js";
  import { pickLocalizedName, DocumentDetailsCache, formatIndexActionCost } from "../../../lib/compendium/documentDetails.js";
  import type { RowActionCost } from "../../../lib/compendium/documentDetails.js";
  import { getSocket, session } from "../../../lib/session.svelte.js";
  import { sendChatOpForId } from "../../../lib/docs/sendOp.js";
  import type { ChatRollPayload } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import { t, i18n } from "../../../lib/i18n/i18n.js";

  interface Props {
    vm: CharacterSheetVM;
    sendOpFn: (op: unknown) => void;
  }

  let { vm, sendOpFn }: Props = $props();

  let activeTabKey = $state<string | null>(null);

  const tabs = $derived(vm.spellTabs);
  const activeTab = $derived.by((): SpellTabRow | null => {
    if (tabs.length === 0) return null;
    return tabs.find((tb) => tb.key === activeTabKey) ?? tabs[0] ?? null;
  });

  // Picker modal state — "add" (grimoire), "prepare" (into a specific slot),
  // or "focus" (add a focus spell to the focus-pool entry).
  let pickerOpen = $state(false);
  let pickerMode = $state<"add" | "prepare" | "focus">("add");
  let pickerEntryId = $state<string | null>(null);
  let pickerRank = $state<number | undefined>(undefined);
  let pickerSlotIndex = $state<number | null>(null);

  // "Preparar do grimório" mini-menu (opened from an empty slot).
  let prepareMenu = $state<{ entryId: string; rank: number; slotIndex: number } | null>(null);

  // Slot-choice mini-menu (toast's "Preparar agora" when several slots are empty).
  let slotChoice = $state<{ entryId: string; rank: number; spellName: string; slots: number[] } | null>(null);

  // Toast (bottom-center) after adding a spell to the grimoire.
  let toast = $state<{ message: string; spellName?: string; rank?: number; entryId?: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Briefly-highlighted grimoire row (the spell just added). Stored as the raw
  // picker doc name (EN or pt-BR); the flash comparison uses its TRANSLATED
  // form (see recentlyAddedDisplayName) because the grimoire/focus rows now
  // render translated names (T1 r13).
  let recentlyAddedName = $state<string | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  // Deferred prepare: the picker's "prepare" mode creates the spell item, but
  // its _id only exists after the server ack + mirror broadcast. This records
  // the intent; the $effect below completes it when the item shows up in vm.
  let pendingPrepare = $state<{
    entryId: string;
    rank: number;
    slotIndex: number;
    spellName: string;
    expiresAt: number;
  } | null>(null);

  $effect(() => {
    const pending = pendingPrepare;
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      pendingPrepare = null;
      return;
    }
    const entry = findEntry(pending.entryId);
    if (!entry) return;
    const spell = findGrimoireSpellByName(entry, pending.spellName);
    if (!spell) return; // not mirrored yet — re-runs when vm changes
    pendingPrepare = null;
    const op = vm.prepareSpell(pending.entryId, pending.rank, pending.slotIndex, spell.id);
    if (op) sendOpFn(op);
  });

  // --- Dangling prepared-ref name resolution (DEC-R12-05, layer 4) ---------
  // resolveSpellName crosses the 3 embedded layers in the VM; when it returns
  // null the id is dangling. Before declaring "spell removed", try an
  // on-demand compendium fetch keyed by the raw id (some slots stored a
  // compendium id that was never materialized as an embedded item). Results
  // are cached per id for this tab session: `string` = resolved name,
  // `null` = confirmed missing (render the removed state), `undefined` =
  // not looked up yet. $state so the template re-renders when a fetch lands.
  let compendiumNameCache = $state<Record<string, string | null>>({});
  const pendingNameLookups = new Set<string>();

  /**
   * Best-effort compendium name lookup for a dangling id. The prepared slot
   * stores an embedded item id, not a compendium uuid, so this only succeeds
   * when the id happens to be a resolvable compendium uuid; otherwise it
   * caches null (→ "spell removed"). Never throws to the UI.
   */
  async function lookupCompendiumName(id: string): Promise<void> {
    if (id in compendiumNameCache || pendingNameLookups.has(id)) return;
    pendingNameLookups.add(id);
    try {
      const { document } = await getDocument(requireConnectedSocket(getSocket()), id);
      // Prefer the server-attached pt-BR overlay (document.i18n.ptBR.name) when
      // the locale is pt-BR; pickLocalizedName falls back to the EN name (T1).
      const localized = pickLocalizedName(document, i18n.locale);
      compendiumNameCache = {
        ...compendiumNameCache,
        [id]: localized.length > 0 ? localized : null,
      };
    } catch {
      // Not a resolvable compendium id (the common dangling case) or offline —
      // treat as confirmed missing so the UI shows the removed state.
      compendiumNameCache = { ...compendiumNameCache, [id]: null };
    } finally {
      pendingNameLookups.delete(id);
    }
  }

  /**
   * Resolve a prepared slot's spell id to a display name. Returns the name
   * (embedded or compendium), or null when the reference is confirmed
   * dangling (→ render "spell removed" + clear-slot action). Triggers the
   * compendium lookup lazily the first time an id isn't found embedded.
   */
  function resolvedSlotName(entryId: string, id: string): string | null {
    const embedded = vm.resolveSpellName(entryId, id);
    // Embedded name found: translate EN → pt-BR via the pack index (T1 r13).
    // Falls back to the stored name when there's no pack match / not pt-BR.
    if (embedded !== null) return translateName(embedded);
    const cached = compendiumNameCache[id];
    if (cached !== undefined) return cached; // string (found) or null (confirmed missing)
    void lookupCompendiumName(id); // fire once; re-renders when it lands
    return null;
  }

  /** Clear a dangling prepared slot (feedback: never leave a raw id/broken ref). */
  function clearDanglingSlot(entryId: string, rank: number, slotIndex: number): void {
    const op = vm.unprepareSlot(entryId, rank, slotIndex);
    if (op) sendOpFn(op);
  }

  // --- Spell-name translation (T1 r13) --------------------------------------
  // The actor's embedded spell items were copied with mixed languages (cantrips
  // in pt-BR, slot/grimoire spells in EN — the copy happened before an i18n
  // overlay existed). The compendium index carries a denormalized pt-BR
  // `namePt` per entry; loading the spells-core index once lets us resolve
  // EVERY embedded spell's display name to pt-BR (EN fallback when no pack
  // match), independent of how the actor data was copied. Display-time only —
  // never mutates the actor. Names with no pack match stay EN.
  let spellNameTranslator = $state<SpellNameTranslator | null>(null);
  // Name/sourceId → pack UUID resolver for the details popup (r14-B4). Built
  // from the SAME spells-core index load as the translator (one round-trip).
  let spellDetailsResolver = $state<SpellDetailsResolver | null>(null);
  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  $effect(() => {
    // Re-run when the locale or system changes so a pt-BR ⇄ en switch (or a
    // world/system change) re-resolves names. EN locale still loads the map;
    // translate() below is gated on locale.
    void i18n.locale;
    void systemId;
    void loadSpellNameTranslator();
  });

  async function loadSpellNameTranslator(): Promise<void> {
    try {
      const sock = requireConnectedSocket(getSocket());
      const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
      const spellPack = packs.find((p) => p.id.endsWith(".spells-core")) ?? packs[0];
      if (!spellPack) return;
      const { entries } = await searchPack(sock, { packId: spellPack.id });
      spellNameTranslator = buildSpellNameTranslator(entries);
      // Same index feeds the details resolver: a clicked spell name resolves to
      // its pack doc uuid (by raw name / sourceId) so the popup can fetch the
      // full localized description. r14-B4.
      spellDetailsResolver = buildSpellDetailsResolver(entries);
    } catch {
      // Offline / no socket / no pack: leave the translator/resolver null →
      // names render EN and the popup falls back to embedded descriptions.
      // Never blocks the tab.
    }
  }

  // --- Spell details popup (r14-B4) -----------------------------------------
  // Clicking a spell's NAME (cantrip, prepared slot, grimoire row, focus spell)
  // opens a modal reusing the shared DocumentDetailsPanel — the same UX as the
  // Actions tab and the pickers. Resolution: embedded spell item id → pack doc
  // uuid (via spellDetailsResolver, by raw name / flags.fusion.sourceId) →
  // getDocument fetch (cached). No pack match → the spell's OWN embedded
  // description is shown. Fetch failures fall back to the embedded doc so the
  // popup is never an endless spinner. ESC / click-outside close.
  const detailsCache = new DocumentDetailsCache();
  let detailsOpen = $state(false);
  let detailsDoc = $state<Record<string, unknown> | null>(null);
  let detailsLoading = $state(false);
  let detailsError = $state(false);
  let detailsFetchId = 0; // guards against a stale fetch resolving after reopen

  /** Lookup of embedded spell items by _id — raw name, sourceId, fallback doc. */
  const embeddedSpellById = $derived(vm.embeddedSpellById);

  /**
   * Build a details-panel doc from an embedded spell item so DocumentDetailsPanel
   * can render the spell's OWN description without a compendium fetch (homebrew
   * / no-pack-match). Normalizes system.description to a flat HTML string
   * (vendor items wrap it as { value }); the panel sanitizes it identically to
   * pack docs. Kept local to avoid coupling to actionsVM (edited by another
   * batch in parallel). Returns null for a non-record item.
   */
  function buildEmbeddedSpellDoc(
    item: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    if (typeof item !== "object" || item === null) return null;
    const rawSystem = item["system"];
    const system: Record<string, unknown> =
      typeof rawSystem === "object" && rawSystem !== null
        ? { ...(rawSystem as Record<string, unknown>) }
        : {};
    const rawDesc = system["description"];
    let descHtml = "";
    if (typeof rawDesc === "string") {
      descHtml = rawDesc;
    } else if (typeof rawDesc === "object" && rawDesc !== null) {
      const value = (rawDesc as Record<string, unknown>)["value"];
      if (typeof value === "string") descHtml = value;
    }
    system["description"] = descHtml;
    const rawName = item["name"];
    const rawType = item["type"];
    return {
      name: typeof rawName === "string" ? rawName : "",
      type: typeof rawType === "string" ? rawType : "spell",
      system,
      flags: typeof item["flags"] === "object" && item["flags"] !== null ? item["flags"] : {},
    };
  }

  /**
   * Open the details popup for a clicked spell. `spellItemId` is the embedded
   * item's _id (the id the row already carries). Resolves the pack doc by the
   * item's RAW name / sourceId; on no match (or offline) renders the embedded
   * item's own description.
   */
  function openSpellDetails(spellItemId: string): void {
    const ref = embeddedSpellById.get(spellItemId) ?? null;
    detailsOpen = true;
    detailsError = false;
    const embeddedDoc = ref ? buildEmbeddedSpellDoc(ref.item) : null;
    const uuid = ref && spellDetailsResolver ? spellDetailsResolver(ref.name, ref.sourceId) : null;

    if (!uuid) {
      // Homebrew / no-pack-match / resolver not loaded: show the embedded
      // description immediately (no fetch). Never leaves the popup empty.
      detailsDoc = embeddedDoc;
      detailsLoading = false;
      return;
    }
    void loadSpellDetails(uuid, embeddedDoc);
  }

  async function loadSpellDetails(
    uuid: string,
    embeddedFallback: Record<string, unknown> | null,
  ): Promise<void> {
    const fetchId = ++detailsFetchId;
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
      if (fetchId === detailsFetchId) detailsDoc = document;
    } catch {
      // Fetch failed (offline / missing doc): degrade to the embedded
      // description rather than a dead error state, when one exists.
      if (fetchId === detailsFetchId) {
        if (embeddedFallback) {
          detailsDoc = embeddedFallback;
          detailsError = false;
        } else {
          detailsError = true;
          detailsDoc = null;
        }
      }
    } finally {
      if (fetchId === detailsFetchId) detailsLoading = false;
    }
  }

  function closeSpellDetails(): void {
    detailsOpen = false;
    detailsDoc = null;
    detailsLoading = false;
    detailsError = false;
    detailsFetchId++; // invalidate any in-flight fetch
  }

  function retrySpellDetails(): void {
    // Retry is only reachable when a uuid fetch errored with no fallback; the
    // panel's onRetry re-issues nothing actionable without the uuid, so simply
    // clearing the error lets the user re-click the name. Kept as a no-op-safe
    // reset so DocumentDetailsPanel always has a valid onRetry.
    detailsError = false;
  }

  /**
   * Resolve a spell's display name to pt-BR when the active locale is pt-BR and
   * the spells-core index is loaded; otherwise pass the stored name through.
   * The single choke-point every render helper below routes names through.
   */
  function translateName(name: string): string {
    if (i18n.locale !== "pt-BR" || !spellNameTranslator) return name;
    return spellNameTranslator(name);
  }

  // Translated form of the just-added spell name, for the flash-highlight
  // comparison against the (now translated) rendered row names.
  const recentlyAddedDisplayName = $derived(
    recentlyAddedName !== null ? translateName(recentlyAddedName) : null,
  );

  function selectTab(key: string): void {
    activeTabKey = key;
  }

  function traditionLabel(tradition: string): string {
    const key = `FUSION.Sheet.Spells.Tradition.${tradition}`;
    const resolved = t(key);
    return resolved === key ? tradition : resolved;
  }

  /** Localized archetype name (falls back to the derived English label). */
  function archetypeLabel(slug: string, fallback: string): string {
    const key = `FUSION.Sheet.Spells.ArchetypeName.${slug}`;
    const resolved = t(key);
    return resolved === key ? fallback : resolved;
  }

  /**
   * Main spellcasting DC label, naming the class so it's distinguishable from
   * an archetype's DC (feedback r15: "não tenho distinguido o CD Magus —
   * deveria indicar qual classe é"). Renders "CD MAGUS" when the character has
   * a class; falls back to the generic "CD DE MAGIA" otherwise. The class name
   * comes from the character's class item (kept in English for coined class
   * names like Magus — see glossary keepEnglish).
   */
  function spellDCLabel(): string {
    const className = vm.classLabel.trim();
    if (className.length === 0) return t("FUSION.Sheet.Spells.DC");
    return t("FUSION.Sheet.Spells.DCWithClass", { class: className });
  }

  function findEntry(entryId: string): SpellcastingEntryRow | null {
    return tabs.flatMap((tb) => tb.entries).find((e) => e.entryId === entryId) ?? null;
  }

  /** Known (grimoire) spell matching a name, with its item id and rank. */
  function findGrimoireSpellByName(
    entry: SpellcastingEntryRow,
    name: string,
  ): { id: string; rank: number } | null {
    for (const slot of entry.slots) {
      for (const sp of slot.spells) {
        if (sp.name === name && sp.id) return { id: sp.id, rank: slot.rank };
      }
    }
    return null;
  }

  /** Indices of empty (unprepared) slots for a rank in an entry. */
  function emptySlotIndices(entry: SpellcastingEntryRow, rank: number): number[] {
    const slot = entry.slots.find((s) => s.rank === rank && !s.isCantrip);
    if (!slot) return [];
    const out: number[] = [];
    for (let i = 0; i < slot.max; i++) {
      const prepared = vm.getPreparedSlot(entry.entryId, rank, i);
      if (!prepared || !prepared.id) out.push(i);
    }
    return out;
  }

  function showToast(toastData: NonNullable<typeof toast>, durationMs = 8000): void {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toast = toastData;
    toastTimer = setTimeout(() => {
      toast = null;
    }, durationMs);
  }

  function flashGrimoireRow(name: string): void {
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    recentlyAddedName = name;
    highlightTimer = setTimeout(() => {
      recentlyAddedName = null;
    }, 4000);
  }

  function openAddPicker(entry: SpellcastingEntryRow): void {
    pickerMode = "add";
    pickerEntryId = entry.entryId;
    pickerRank = undefined;
    pickerSlotIndex = null;
    pickerOpen = true;
  }

  function openPreparePicker(entryId: string, rank: number, slotIndex: number): void {
    prepareMenu = null;
    pickerMode = "prepare";
    pickerEntryId = entryId;
    pickerRank = rank;
    pickerSlotIndex = slotIndex;
    pickerOpen = true;
  }

  /** Empty slot click → "Preparar do grimório" mini-menu. */
  function openPrepareMenu(entry: SpellcastingEntryRow, rank: number, slotIndex: number): void {
    prepareMenu = { entryId: entry.entryId, rank, slotIndex };
  }

  /** Eligible grimoire spells for a slot: known, rank 1..slotRank. */
  function prepareMenuSpells(entryId: string, maxRank: number): Array<{ id: string; name: string; rank: number }> {
    const entry = findEntry(entryId);
    if (!entry) return [];
    const out: Array<{ id: string; name: string; rank: number }> = [];
    for (const slot of entry.slots) {
      if (slot.isCantrip || slot.rank > maxRank) continue;
      for (const sp of slot.spells) {
        if (sp.id) out.push({ id: sp.id, name: translateName(sp.name), rank: slot.rank });
      }
    }
    return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }

  function prepareFromMenu(spellId: string): void {
    if (!prepareMenu) return;
    const op = vm.prepareSpell(prepareMenu.entryId, prepareMenu.rank, prepareMenu.slotIndex, spellId);
    if (op) sendOpFn(op);
    prepareMenu = null;
  }

  function closePicker(): void {
    pickerOpen = false;
    pickerEntryId = null;
    pickerSlotIndex = null;
  }

  function handlePickerSelect(doc: Record<string, unknown>): void {
    if (!pickerEntryId) return;
    const rawName = doc["name"];
    const spellName = typeof rawName === "string" ? rawName : "";
    const sys = typeof doc["system"] === "object" && doc["system"] !== null
      ? (doc["system"] as Record<string, unknown>)
      : {};
    const rawLevel = sys["level"];
    const spellRank = typeof rawLevel === "number" ? rawLevel : 0;

    if (pickerMode === "focus") {
      // Add the focus spell as an embedded item linked to the focus-pool
      // entry. No slot/prepare step — focus spells cast from the pool, not
      // from ranked slots. Flash + toast the same way as a grimoire add.
      const op = vm.addSpellToEntry(pickerEntryId, doc);
      if (op) {
        sendOpFn(op);
        flashGrimoireRow(spellName);
        showToast({ message: t("FUSION.Sheet.Spells.Toast.FocusAdded", { name: spellName }) });
      }
    } else if (pickerMode === "add") {
      const op = vm.addSpellToEntry(pickerEntryId, doc);
      if (op) {
        sendOpFn(op);
        flashGrimoireRow(spellName);
        showToast({
          message: t("FUSION.Sheet.Spells.Toast.Added", { name: spellName }),
          spellName,
          rank: spellRank,
          entryId: pickerEntryId,
        });
      }
    } else if (pickerMode === "prepare" && pickerRank !== undefined && pickerSlotIndex !== null) {
      // Guided flow: add to the grimoire (unless already known), then
      // auto-prepare into the originating slot. If the spell is already in
      // the grimoire, prepare immediately; otherwise defer via
      // pendingPrepare until the created item arrives from the server.
      const entry = findEntry(pickerEntryId);
      const known = entry ? findGrimoireSpellByName(entry, spellName) : null;
      if (known) {
        const op = vm.prepareSpell(pickerEntryId, pickerRank, pickerSlotIndex, known.id);
        if (op) sendOpFn(op);
      } else {
        const op = vm.addSpellToEntry(pickerEntryId, doc);
        if (op) {
          sendOpFn(op);
          flashGrimoireRow(spellName);
          pendingPrepare = {
            entryId: pickerEntryId,
            rank: pickerRank,
            slotIndex: pickerSlotIndex,
            spellName,
            expiresAt: Date.now() + 10_000,
          };
        }
      }
    }
    closePicker();
  }

  /** Toast's "Preparar agora": first empty slot of the spell's rank; mini-menu when several. */
  function prepareNowFromToast(): void {
    if (!toast?.spellName || toast.rank === undefined || !toast.entryId) return;
    const entry = findEntry(toast.entryId);
    if (!entry) return;
    const { spellName, rank, entryId } = toast;
    const empty = emptySlotIndices(entry, rank);
    if (empty.length === 0) {
      showToast({ message: t("FUSION.Sheet.Spells.Toast.NoEmptySlot", { rank: String(rank) }) }, 5000);
      return;
    }
    if (empty.length === 1) {
      prepareIntoSlot(entryId, rank, empty[0] ?? 0, spellName);
      toast = null;
      return;
    }
    slotChoice = { entryId, rank, spellName, slots: empty };
    toast = null;
  }

  /** Prepare a named grimoire spell into a slot now (or defer if not mirrored yet). */
  function prepareIntoSlot(entryId: string, rank: number, slotIndex: number, spellName: string): void {
    const entry = findEntry(entryId);
    const known = entry ? findGrimoireSpellByName(entry, spellName) : null;
    if (known) {
      const op = vm.prepareSpell(entryId, rank, slotIndex, known.id);
      if (op) sendOpFn(op);
    } else {
      pendingPrepare = { entryId, rank, slotIndex, spellName, expiresAt: Date.now() + 10_000 };
    }
  }

  function chooseSlot(slotIndex: number): void {
    if (!slotChoice) return;
    prepareIntoSlot(slotChoice.entryId, slotChoice.rank, slotIndex, slotChoice.spellName);
    slotChoice = null;
  }

  /**
   * Emit a cast's announcement + optional attack roll, NESTING the attack under
   * the announcement (r18-N1). When the spell has an attack, we need the
   * announcement's server id to set `flags.parentMessageId` on the attack so the
   * chat groups them into ONE card. We therefore send the announcement over a
   * LIVE socket awaiting its ack (sendChatOpForId), then fire the attack with the
   * parent id. On any failure (no socket / ack error) we fall back to the old
   * un-nested fire-and-forget via sendOpFn so a roll is NEVER lost — it just
   * renders as separate top-level messages, exactly as before r18-N1.
   *
   * No-attack casts keep the original single fire-and-forget path (nothing to
   * nest), preserving the optimistic-echo behavior of sendOpFn.
   */
  function emitCast(cast: { announcement: ChatRollPayload; attack: ChatRollPayload | null }): void {
    if (!cast.attack) {
      sendOpFn(cast.announcement);
      return;
    }
    const attack = cast.attack;
    const sock = getSocket();
    if (!sock) {
      // No live socket — fall back to un-nested delivery (never drop the rolls).
      sendOpFn(cast.announcement);
      sendOpFn(attack);
      return;
    }
    void (async () => {
      try {
        const parentId = await sendChatOpForId(sock, cast.announcement);
        const nested: ChatRollPayload = parentId
          ? { ...attack, flags: { ...attack.flags, parentMessageId: parentId } }
          : attack;
        sendOpFn(nested);
      } catch {
        // Announcement ack failed — deliver both un-nested rather than lose them.
        sendOpFn(cast.announcement);
        sendOpFn(attack);
      }
    })();
  }

  function castSpell(entry: SpellcastingEntryRow, rank: number, slotIndex: number, spellId: string, spellName: string): void {
    const preparedOp = vm.toggleSlotExpended(entry.entryId, rank, slotIndex);
    if (preparedOp) sendOpFn(preparedOp);
    // r16: announce the cast in chat (pt-BR name + effective rank + ◆ glyphs +
    // save line) with Tobias as speaker; if it's an attack spell, also fire the
    // spell-attack roll (one click = announcement + attack). r18-N1: the attack
    // now nests under the announcement (emitCast). Damage stays on Dano.
    void spellName;
    const cast = vm.castSpell(spellId, entry.entryId, "prepared", rank);
    if (cast) emitCast(cast);
  }

  /**
   * Roll a spell's DAMAGE at its effective rank (r16-G3). `surface` selects the
   * heightening rule; `slotRank` is only used for prepared spells. The VM reads
   * the embedded spell's damage/heightening and emits "/r <formula> # <flavor>".
   * No-op (button hidden by the template) when the spell has no rollable damage.
   */
  function rollSpellDamage(spellId: string, surface: "cantrip" | "focus" | "prepared" | "grimoire", slotRank?: number): void {
    const op = vm.rollSpellDamage(spellId, surface, slotRank);
    if (op) sendOpFn(op);
  }

  /**
   * Inverse of castSpell — recover an already-expended slot without waiting
   * for a full Rest (feedback: "Ao usar uma magia, não consigo recuperar os
   * slots dela" — the UI previously had no button that flipped `expended`
   * back to false; toggleSlotExpended already supported both directions).
   */
  function recoverSlot(entry: SpellcastingEntryRow, rank: number, slotIndex: number): void {
    const op = vm.toggleSlotExpended(entry.entryId, rank, slotIndex);
    if (op) sendOpFn(op);
  }

  function unprepare(entry: SpellcastingEntryRow, rank: number, slotIndex: number): void {
    const op = vm.unprepareSlot(entry.entryId, rank, slotIndex);
    if (op) sendOpFn(op);
  }

  // --- Focus tab (DEC-R12-05 / feedback b) ----------------------------------

  /** Set focus points via a pip click (same toggle-down semantics as hero/focus pips). */
  function setFocusPip(index: number): void {
    const current = vm.focusPoints.value;
    const next = index + 1 === current ? index : index + 1;
    const op = vm.setFocusPoints(next);
    if (op) sendOpFn(op);
  }

  /**
   * Cast a cantrip (r16): no slot to spend — just announce it in chat (+ fire
   * the spell-attack roll for attack cantrips like Ignition). Cantrips
   * auto-heighten to ceil(level/2); the VM resolves the entry for DC/attack.
   */
  function castCantrip(entry: SpellcastingEntryRow, spellId: string): void {
    const cast = vm.castSpell(spellId, entry.entryId, "cantrip");
    if (cast) emitCast(cast);
  }

  /** Casting a focus spell spends one Focus Point (min 0) and announces it. */
  function castFocusSpell(spellId?: string): void {
    const op = vm.setFocusPoints(Math.max(0, vm.focusPoints.value - 1));
    if (op) sendOpFn(op);
    // r16: chat announcement (+ attack roll for attack focus spells). Focus
    // spells auto-heighten to ceil(level/2); the VM resolves the entry for DC.
    if (spellId && vm.focusEntryId) {
      const cast = vm.castSpell(spellId, vm.focusEntryId, "focus");
      if (cast) emitCast(cast);
    }
  }

  /** Open the picker to add a focus spell to the focus-pool entry. */
  function openFocusPicker(entry: SpellcastingEntryRow | null): void {
    const entryId = entry?.entryId ?? vm.focusEntryId;
    if (!entryId) return;
    pickerMode = "focus";
    pickerEntryId = entryId;
    pickerRank = undefined;
    pickerSlotIndex = null;
    pickerOpen = true;
  }

  function rollSpellAttack(entryId: string): void {
    const op = vm.rollSpellAttack(entryId);
    if (op) sendOpFn(op);
  }

  function removeFromGrimoire(spellItemId: string): void {
    const op = vm.removeSpell(spellItemId);
    if (op) sendOpFn(op);
  }

  /** Every known spell across all ranks for an entry — used for the Grimório section. */
  function grimoireSpells(
    entry: SpellcastingEntryRow,
  ): Array<{ id: string; name: string; rank: number; castTime: string | null }> {
    const out: Array<{ id: string; name: string; rank: number; castTime: string | null }> = [];
    for (const slot of entry.slots) {
      if (slot.isCantrip) continue;
      for (const sp of slot.spells) {
        out.push({ id: sp.id, name: translateName(sp.name), rank: slot.rank, castTime: sp.castTime });
      }
    }
    return out;
  }

  function cantrips(entry: SpellcastingEntryRow): SpellRow[] {
    const slot = entry.slots.find((s) => s.isCantrip);
    return slot?.spells ?? [];
  }
</script>

<!--
  Clickable spell name (r14-B4): opens the details popup. Rendered as a real
  <button> for keyboard/AT semantics (Enter/Space fire the click natively;
  cursor:pointer + hover accent signal it's actionable). `stopPropagation`
  keeps a name click from also triggering the enclosing slot/card handlers
  (Lançar/Trocar/Preparar live in separate buttons). `extraClass` lets each
  surface keep its own typographic style (chip / slot / focus row).

  `cost` (r20-X6, feedback: "Faltou adicionar o custo de ações na aba de
  magias") renders the same ◆/◇/⟳ badge the compendium pickers show (r20-X2,
  {@link formatIndexActionCost}) right after the name — null (passive/no cost
  data) renders nothing, keeping the row clean.
-->
{#snippet spellNameButton(displayName: string, spellItemId: string, extraClass: string, cost: RowActionCost | null)}
  <button
    type="button"
    class={`spell-name-btn ${extraClass}`}
    aria-label={t("FUSION.Sheet.Spells.SpellDetailsOpen", { name: displayName })}
    onclick={(e) => { e.stopPropagation(); openSpellDetails(spellItemId); }}
  >{displayName}</button>
  {#if cost}
    <span class="spell-cost-badge" class:spell-cost-badge--text={cost.isText} title={cost.title}>{cost.display}</span>
  {/if}
{/snippet}

<!--
  Heightening chrome for a spell row (r16-G3): a discrete "elevated" badge shown
  only when the effective rank differs from the spell's base, the auto-scaled
  damage formula, a "Dano" roll button (heightened formula), and — for fixed
  heightenings that change target/range/area — a "complex" badge routing to the
  details popup. `h` is the SpellHeighteningView; `spellId`/`surface`/`slotRank`
  drive the roll. All parts are conditional so plain spells render nothing extra.
-->
{#snippet heightenChrome(h: import("../../../lib/sheets/pf2e/characterSheetVM.js").SpellHeighteningView | null | undefined, spellId: string, surface: "cantrip" | "focus" | "prepared" | "grimoire", slotRank?: number, displayName?: string)}
  {#if h}
    {#if h.effectiveRank > h.baseRank}
      <span
        class="spell-heighten-badge"
        title={t("FUSION.Sheet.Spells.HeightenedBadgeTitle", { rank: String(h.effectiveRank), base: String(h.baseRank) })}
      >{t("FUSION.Sheet.Spells.HeightenedBadge", { rank: String(h.effectiveRank) })}</span>
    {/if}
    {#if h.rollFormula}
      <span class="spell-damage-chip">{h.damageDisplay ?? h.rollFormula}</span>
      {#if vm.editable}
        <button
          type="button"
          class="spell-btn spell-btn--damage"
          aria-label={t("FUSION.Sheet.Spells.RollDamageAria", { name: displayName ?? "", formula: h.rollFormula })}
          onclick={() => rollSpellDamage(spellId, surface, slotRank)}
        >{t("FUSION.Sheet.Spells.RollDamage")}</button>
      {/if}
    {/if}
    {#if h.hasComplexHeightening}
      <button
        type="button"
        class="spell-complex-badge"
        title={t("FUSION.Sheet.Spells.ComplexHeightenTitle")}
        onclick={(e) => { e.stopPropagation(); openSpellDetails(spellId); }}
      >{t("FUSION.Sheet.Spells.ComplexHeightenBadge", { rank: String(h.effectiveRank) })}</button>
    {/if}
  {/if}
{/snippet}

<div class="spells-tab">
  {#if tabs.length === 0}
    <p class="spells-empty">{t("FUSION.Sheet.Spells.NoEntries")}</p>
  {:else}
    <div class="spells-subtabs" role="tablist" aria-label={t("FUSION.Sheet.Tabs.Spells")}>
      {#each tabs as tab (tab.key)}
        <button
          type="button"
          class="spells-subtab"
          class:spells-subtab--active={activeTab?.key === tab.key}
          role="tab"
          aria-selected={activeTab?.key === tab.key}
          onclick={() => selectTab(tab.key)}
        >
          {tab.kind === "focus" ? t("FUSION.Sheet.Spells.FocusTab") : tab.kind === "rituals" ? t("FUSION.Sheet.Spells.RitualsTab") : tab.label}
        </button>
      {/each}
    </div>

    {#if activeTab?.kind === "entry"}
      {#if vm.archetypeClassDCs.length > 0}
        <!-- Archetype/multiclass dedication class DCs (DEC-R12-04) — shown
             alongside the spellcasting stats since a caster archetype's DC
             (e.g. Alchemist) is most relevant next to the spell DC/attack. -->
        <div class="archetype-dc-bar" aria-label={t("FUSION.Sheet.Spells.ArchetypeDCs")}>
          {#each vm.archetypeClassDCs as adc (adc.slug)}
            <div class="archetype-dc">
              <span class="archetype-dc__label">{t("FUSION.Sheet.Spells.ArchetypeDC", { archetype: archetypeLabel(adc.slug, adc.label) })}</span>
              <span class="archetype-dc__value">{adc.dc}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#each activeTab.entries as entry (entry.entryId)}
        <div class="spells-entry">
          <div class="spells-statsbar">
            <div class="spells-stat">
              <span class="spells-stat__label">{spellDCLabel()}</span>
              <span class="spells-stat__value">{entry.spellDC}</span>
            </div>
            <button
              type="button"
              class="spells-stat spells-stat--rollable"
              onclick={() => rollSpellAttack(entry.entryId)}
              aria-label={t("FUSION.Sheet.Spells.RollAttack", { value: entry.spellAttackFormatted })}
            >
              <span class="spells-stat__label">{t("FUSION.Sheet.Spells.Attack")}</span>
              <span class="spells-stat__value">{entry.spellAttackFormatted}</span>
            </button>
            <div class="spells-stat">
              <span class="spells-stat__label">{t("FUSION.Sheet.Spells.Tradition")}</span>
              <span class="spells-stat__value">{traditionLabel(entry.tradition)}</span>
            </div>
            <div class="spells-stat">
              <span class="spells-stat__label">{t("FUSION.Sheet.Labels.Ability." + entry.ability)}</span>
            </div>
            <div class="spells-stat">
              <span class="spells-stat__label">{t("FUSION.Sheet.Labels.Proficiency")}</span>
              <ProficiencyBadge rank={entry.proficiencyRankLabel as "U" | "T" | "E" | "M" | "L"} variant="filled" size={20} />
            </div>
          </div>

          {#if cantrips(entry).length > 0}
            <div class="spells-section">
              <h3 class="spells-section__label">
                {t("FUSION.Sheet.Spells.Cantrips")}
                <span class="spells-section__hint">{t("FUSION.Sheet.Spells.CantripsHeightenHint")}</span>
              </h3>
              <div class="spells-chips">
                {#each cantrips(entry) as cantrip (cantrip.id)}
                  {@const cName = translateName(cantrip.name)}
                  {@const cCost = formatIndexActionCost(cantrip.castTime, i18n.locale)}
                  <div class="spell-chip">
                    {@render spellNameButton(cName, cantrip.id, "spell-chip__name", cCost)}
                    {@render heightenChrome(cantrip.heightening, cantrip.id, "cantrip", undefined, cName)}
                    {#if vm.editable}
                      <button
                        type="button"
                        class="spell-btn spell-btn--primary spell-chip__cast"
                        onclick={() => castCantrip(entry, cantrip.id)}
                      >{t("FUSION.Sheet.Spells.Cast")}</button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#each entry.slots.filter((s) => !s.isCantrip) as slot (slot.rank)}
            <div class="spells-section">
              <h3 class="spells-section__label">{t("FUSION.Sheet.Spells.Rank", { rank: slot.rank })}</h3>
              <div class="spells-slots">
                {#each Array.from({ length: slot.max }) as _, slotIndex (slotIndex)}
                  {@const prepared = vm.getPreparedSlot(entry.entryId, slot.rank, slotIndex)}
                  {#if prepared && prepared.id}
                    {@const resolvedName = resolvedSlotName(entry.entryId, prepared.id)}
                    {#if resolvedName === null}
                      <!-- Dangling reference: the prepared id matches no embedded
                           spell (removed/never materialized). Show an explicit
                           error state with a clear action — NEVER the raw id. -->
                      <div class="spell-slot-card spell-slot-card--missing">
                        <div class="spell-slot-card__main">
                          <span class="spell-slot-card__name spell-slot-card__name--missing">
                            {t("FUSION.Sheet.Spells.SlotRemoved")}
                          </span>
                        </div>
                        <div class="spell-slot-card__actions">
                          {#if vm.editable}
                            <button
                              type="button"
                              class="spell-btn spell-btn--ghost"
                              onclick={() => clearDanglingSlot(entry.entryId, slot.rank, slotIndex)}
                            >
                              {t("FUSION.Sheet.Spells.ClearSlot")}
                            </button>
                          {/if}
                        </div>
                      </div>
                    {:else}
                    {@const preparedHeighten = vm.heightenedSpell(prepared.id, "prepared", slot.rank)}
                    {@const preparedCost = formatIndexActionCost(vm.resolveSpellCastTime(entry.entryId, prepared.id), i18n.locale)}
                    <div class="spell-slot-card" class:spell-slot-card--expended={prepared.expended}>
                      <div class="spell-slot-card__main">
                        <span class="spell-slot-card__name">
                          {@render spellNameButton(resolvedName, prepared.id, "spell-slot-card__name-text", preparedCost)}
                          {#if !prepared.expended}
                            <span class="spell-slot-card__dot" title={t("FUSION.Sheet.Spells.SlotAvailable")}></span>
                          {/if}
                        </span>
                        {@render heightenChrome(preparedHeighten, prepared.id, "prepared", slot.rank, resolvedName)}
                      </div>
                      <div class="spell-slot-card__actions">
                        {#if vm.editable}
                          {#if !prepared.expended}
                            <button
                              type="button"
                              class="spell-btn spell-btn--primary"
                              onclick={() => castSpell(entry, slot.rank, slotIndex, prepared.id, resolvedName)}
                            >
                              {t("FUSION.Sheet.Spells.Cast")}
                            </button>
                          {:else}
                            <span class="spell-slot-card__expended-label">{t("FUSION.Sheet.Spells.Expended")}</span>
                            <button
                              type="button"
                              class="spell-btn spell-btn--recover"
                              onclick={() => recoverSlot(entry, slot.rank, slotIndex)}
                            >
                              {t("FUSION.Sheet.Spells.Recover")}
                            </button>
                          {/if}
                          <button
                            type="button"
                            class="spell-btn spell-btn--ghost"
                            onclick={() => unprepare(entry, slot.rank, slotIndex)}
                          >
                            {t("FUSION.Sheet.Spells.Swap")}
                          </button>
                        {/if}
                      </div>
                    </div>
                    {/if}
                  {:else}
                    <button
                      type="button"
                      class="spell-slot-empty"
                      disabled={!vm.editable}
                      onclick={() => openPrepareMenu(entry, slot.rank, slotIndex)}
                    >
                      {t("FUSION.Sheet.Spells.PrepareEllipsis")}
                    </button>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}

          <div class="spells-section">
            <div class="spells-section__header">
              <h3 class="spells-section__label">{t("FUSION.Sheet.Spells.Grimoire")}</h3>
              {#if vm.editable}
                <button type="button" class="spell-btn spell-btn--primary" onclick={() => openAddPicker(entry)}>
                  {t("FUSION.Sheet.Spells.AddSpell")}
                </button>
              {/if}
            </div>
            {#if grimoireSpells(entry).length === 0}
              <p class="spells-empty spells-empty--inline">{t("FUSION.Sheet.Spells.GrimoireEmpty")}</p>
            {:else}
              <div class="spells-grimoire">
                {#each grimoireSpells(entry) as spell (spell.id)}
                  {@const gCost = formatIndexActionCost(spell.castTime, i18n.locale)}
                  <div
                    class="spell-chip spell-chip--row"
                    class:spell-chip--new={spell.name === recentlyAddedDisplayName}
                  >
                    {@render spellNameButton(spell.name, spell.id, "spell-chip__name", gCost)}
                    {#if vm.editable}
                      <button type="button" class="spell-btn spell-btn--ghost" onclick={() => removeFromGrimoire(spell.id)}>
                        {t("FUSION.Sheet.Spells.Remove")}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    {:else if activeTab?.kind === "focus"}
      <div class="spells-section">
        <div class="spells-statsbar">
          <div class="spells-stat">
            <span class="spells-stat__label">{t("FUSION.Sheet.Spells.FocusPoints")}</span>
            <div
              class="focus-pip-row"
              role="group"
              aria-label={t("FUSION.Sheet.Spells.FocusPoints") + " " + vm.focusPoints.value + "/" + vm.focusPoints.max}
            >
              {#each Array.from({ length: 3 }) as _, i (i)}
                {#if i < vm.focusPoints.max}
                  <button
                    type="button"
                    class="focus-pip"
                    class:focus-pip--filled={i < vm.focusPoints.value}
                    disabled={!vm.editable}
                    title={t("FUSION.Sheet.Spells.SetFocusPoints", { n: String(i < vm.focusPoints.value ? i : i + 1) })}
                    aria-label={t("FUSION.Sheet.Spells.FocusPip", { n: String(i + 1) })}
                    onclick={() => setFocusPip(i)}
                  ></button>
                {:else}
                  <span
                    class="focus-pip focus-pip--locked"
                    title={t("FUSION.Sheet.Spells.FocusPipLocked")}
                    aria-label={t("FUSION.Sheet.Spells.FocusPipLocked")}
                  ></span>
                {/if}
              {/each}
              <span class="focus-pip-count">{vm.focusPoints.value} / {t("FUSION.Sheet.Spells.MaxAbbrev")} {vm.focusPoints.max}</span>
            </div>
          </div>
          {#if vm.editable && vm.focusEntryId}
            <button
              type="button"
              class="spell-btn spell-btn--primary focus-add-btn"
              onclick={() => openFocusPicker(activeTab.entries[0] ?? null)}
            >
              {t("FUSION.Sheet.Spells.AddFocusSpell")}
            </button>
          {/if}
        </div>

        {#if vm.focusSpells.length === 0}
          <p class="spells-empty spells-empty--inline">{t("FUSION.Sheet.Spells.NoFocusSpells")}</p>
        {:else}
          {#each vm.focusSpells as spell (spell.id)}
            {@const focusName = translateName(spell.name)}
            {@const focusCost = formatIndexActionCost(spell.castTime, i18n.locale)}
            <div class="focus-spell-row" class:spell-chip--new={focusName === recentlyAddedDisplayName}>
              <div class="focus-spell-row__main">
                {@render spellNameButton(focusName, spell.id, "focus-spell-row__name", focusCost)}
                {@render heightenChrome(spell.heightening, spell.id, "focus", undefined, focusName)}
              </div>
              {#if vm.editable}
                <button
                  type="button"
                  class="spell-btn spell-btn--primary"
                  disabled={vm.focusPoints.value <= 0}
                  title={vm.focusPoints.value <= 0 ? t("FUSION.Sheet.Spells.NoFocusPoints") : ""}
                  onclick={() => castFocusSpell(spell.id)}
                >
                  {t("FUSION.Sheet.Spells.Cast")}
                </button>
                <button
                  type="button"
                  class="spell-btn spell-btn--ghost"
                  onclick={() => removeFromGrimoire(spell.id)}
                >
                  {t("FUSION.Sheet.Spells.Remove")}
                </button>
              {/if}
            </div>
          {/each}
        {/if}

        <div class="focus-refocus-note">
          <strong>{t("FUSION.Sheet.Spells.RefocusLabel")}:</strong> {t("FUSION.Sheet.Spells.RefocusHint")}
        </div>
      </div>
    {:else if activeTab?.kind === "rituals"}
      <p class="spells-empty">{t("FUSION.Sheet.Spells.NoRituals")}</p>
    {/if}
  {/if}
</div>

{#if pickerOpen && pickerEntryId}
  {@const entry = findEntry(pickerEntryId)}
  {#if entry}
    <SpellPickerDialog
      tradition={pickerMode === "focus" ? "" : entry.tradition}
      traditionLabel={traditionLabel(entry.tradition)}
      entryLabel={entry.label}
      maxRank={pickerMode === "prepare" ? pickerRank : undefined}
      initialRank={pickerMode === "prepare" ? pickerRank : undefined}
      initialTrait={pickerMode === "focus" ? "focus" : undefined}
      onClose={closePicker}
      onSelect={handlePickerSelect}
    />
  {/if}
{/if}

<!-- "Preparar do grimório" mini-menu (empty slot click) -->
{#if prepareMenu}
  {@const menuSpells = prepareMenuSpells(prepareMenu.entryId, prepareMenu.rank)}
  <div
    class="mini-backdrop"
    role="presentation"
    onclick={() => { prepareMenu = null; }}
    onkeydown={(e) => { if (e.key === "Escape") prepareMenu = null; }}
  >
    <div
      class="mini-menu"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t("FUSION.Sheet.Spells.PrepareMenu.Title", { rank: String(prepareMenu.rank) })}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") prepareMenu = null; }}
    >
      <h3 class="mini-menu__title">{t("FUSION.Sheet.Spells.PrepareMenu.Title", { rank: String(prepareMenu.rank) })}</h3>
      {#if menuSpells.length === 0}
        <p class="mini-menu__empty">{t("FUSION.Sheet.Spells.PrepareMenu.Empty")}</p>
      {:else}
        <div class="mini-menu__list">
          {#each menuSpells as sp (sp.id)}
            <button type="button" class="mini-menu__item" onclick={() => prepareFromMenu(sp.id)}>
              <span class="mini-menu__item-rank">{sp.rank}</span>
              <span class="mini-menu__item-name">{sp.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      <button
        type="button"
        class="mini-menu__link"
        onclick={() => {
          if (prepareMenu) openPreparePicker(prepareMenu.entryId, prepareMenu.rank, prepareMenu.slotIndex);
        }}
      >
        {t("FUSION.Sheet.Spells.PrepareMenu.SearchCompendium")}
      </button>
    </div>
  </div>
{/if}

<!-- Slot-choice mini-menu (toast's "Preparar agora" with several empty slots) -->
{#if slotChoice}
  <div
    class="mini-backdrop"
    role="presentation"
    onclick={() => { slotChoice = null; }}
    onkeydown={(e) => { if (e.key === "Escape") slotChoice = null; }}
  >
    <div
      class="mini-menu"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t("FUSION.Sheet.Spells.SlotChoice.Title", { rank: String(slotChoice.rank) })}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") slotChoice = null; }}
    >
      <h3 class="mini-menu__title">{t("FUSION.Sheet.Spells.SlotChoice.Title", { rank: String(slotChoice.rank) })}</h3>
      <div class="mini-menu__list">
        {#each slotChoice.slots as slotIndex (slotIndex)}
          <button type="button" class="mini-menu__item" onclick={() => chooseSlot(slotIndex)}>
            <span class="mini-menu__item-name">{t("FUSION.Sheet.Spells.SlotChoice.Option", { n: String(slotIndex + 1) })}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- Toast (bottom-center) -->
{#if toast}
  <div class="spells-toast" role="status">
    <span class="spells-toast__msg">{toast.message}</span>
    {#if toast.spellName && toast.rank !== undefined && toast.rank > 0}
      <button type="button" class="spells-toast__action" onclick={prepareNowFromToast}>
        {t("FUSION.Sheet.Spells.Toast.PrepareNow")}
      </button>
    {/if}
    <button
      type="button"
      class="spells-toast__close"
      aria-label={t("FUSION.Dialog.Close")}
      onclick={() => { toast = null; }}
    >&times;</button>
  </div>
{/if}

<!-- Spell details popup (r14-B4): the clicked spell's full description, reusing
     the shared DocumentDetailsPanel. ESC / click-outside close, consistent with
     the other sheet popups (mini-backdrop pattern). -->
{#if detailsOpen}
  <div
    class="mini-backdrop"
    role="presentation"
    onclick={closeSpellDetails}
    onkeydown={(e) => { if (e.key === "Escape") closeSpellDetails(); }}
  >
    <div
      class="spell-details-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t("FUSION.Sheet.Spells.SpellDetailsTitle")}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") closeSpellDetails(); }}
    >
      <button
        type="button"
        class="spell-details-modal__close"
        aria-label={t("FUSION.Dialog.Close")}
        onclick={closeSpellDetails}
      >&times;</button>
      <DocumentDetailsPanel
        document={detailsDoc}
        loading={detailsLoading}
        error={detailsError}
        onRetry={retrySpellDetails}
        loadingKey="FUSION.Sheet.Spells.Picker.Details.Loading"
        loadErrorKey="FUSION.Sheet.Spells.Picker.Details.LoadError"
        retryKey="FUSION.Sheet.Spells.Picker.Details.Retry"
        selectHintKey="FUSION.Sheet.Spells.Picker.Details.SelectHint"
        noDescriptionKey="FUSION.Sheet.Spells.Picker.Details.NoDescription"
      />
    </div>
  </div>
{/if}

<style>
  .spells-tab {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .spells-subtabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .spells-subtab {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--fusion-font);
    padding: 4px 11px;
    border-radius: var(--fusion-radius-pill);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    background: transparent;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .spells-subtab:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .spells-subtab--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .spells-entry {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .spells-statsbar {
    display: flex;
    align-items: center;
    gap: 18px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 10px 14px;
    flex-wrap: wrap;
  }

  .spells-stat {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .spells-stat__label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-subtle);
  }

  .spells-stat__value {
    font-size: 15px;
    font-weight: 700;
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
  }

  .spells-stat--rollable {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    font-family: var(--fusion-font);
    text-align: left;
  }

  .spells-stat--rollable:hover .spells-stat__value {
    color: var(--fusion-accent-hover);
  }

  .spells-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .spells-section__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .spells-section__label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-muted);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spells-section__hint {
    font-size: 10.5px;
    font-weight: 400;
    text-transform: none;
    color: var(--fusion-text-subtle);
    letter-spacing: 0;
  }

  .spells-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .spells-grimoire {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .spell-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 8px 10px;
  }

  .spell-chip--row {
    justify-content: space-between;
  }

  .spell-chip__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  /*
   * Clickable spell name (r14-B4). A real <button> reset to read as inline
   * name text: no button chrome, inherits the surface's typography via the
   * extraClass (spell-chip__name / spell-slot-card__name-text /
   * focus-spell-row__name). The hover accent + underline + cursor signal it
   * opens the details popup, without shouting over the row's own layout.
   */
  .spell-name-btn {
    display: inline;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    font-family: var(--fusion-font);
    text-align: left;
    cursor: pointer;
    color: inherit;
    transition: color 0.12s;
  }

  .spell-name-btn:hover,
  .spell-name-btn:focus-visible {
    color: var(--fusion-accent-hover);
    text-decoration: underline;
    text-underline-offset: 2px;
    outline: none;
  }

  /*
   * Action-cost badge (r20-X6, feedback: "Faltou adicionar o custo de ações na
   * aba de magias"): ◆/◆◆/◆◆◆/◇/⟳ glyphs (or a short text label for long
   * casts, e.g. "1 minuto") right after the spell name — same visual weight
   * and color as the compendium picker's row badge (r20-X2,
   * .picker-row__cost in SpellPickerDialog.svelte) for consistency.
   */
  .spell-cost-badge {
    display: inline-block;
    margin-left: 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--fusion-accent);
    letter-spacing: 0.02em;
    white-space: nowrap;
    vertical-align: middle;
  }

  .spell-cost-badge--text {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fusion-text-subtle);
    letter-spacing: 0;
  }

  /* Slot name variant: same typography as .spell-slot-card__name so the button
     is visually indistinguishable from the previous static text. */
  .spell-slot-card__name-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .spells-slots {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .spell-slot-card {
    flex: 1;
    min-width: 160px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Dim only the name/main area, not the action buttons — a fully-dimmed
     card (previous opacity:0.6 on the whole card) muddied the "Recuperar"
     button's contrast right when it needs to read as an available action. */
  .spell-slot-card--expended .spell-slot-card__main {
    opacity: 0.6;
  }

  .spell-slot-card__main {
    flex: 1;
    min-width: 0;
  }

  .spell-slot-card__name {
    font-size: 13px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .spell-slot-card__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--fusion-accent);
    display: inline-block;
    margin-left: 6px;
    vertical-align: middle;
  }

  .spell-slot-card__expended-label {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .spell-slot-card__actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .spell-slot-empty {
    flex: 1;
    min-width: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text-muted);
    font-size: 12.5px;
    padding: 14px;
    cursor: pointer;
    background: transparent;
    font-family: var(--fusion-font);
    transition: border-color 0.12s, color 0.12s;
  }

  .spell-slot-empty:hover:not(:disabled) {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent-hover);
  }

  .spell-slot-empty:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .spell-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--fusion-radius-sm);
    font-size: 11px;
    padding: 5px 11px;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .spell-btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: none;
  }

  .spell-btn--primary:hover {
    background: var(--fusion-accent-hover);
  }

  .spell-btn--ghost {
    background: transparent;
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .spell-btn--ghost:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent-hover);
  }

  /* Recover an expended slot — visually distinct (success/green) from the
     primary "Lançar" action so it reads as "undo the spend", not "cast". */
  .spell-btn--recover {
    background: var(--fusion-success-dim);
    border: 1px solid var(--fusion-success);
    color: var(--fusion-success);
  }

  .spell-btn--recover:hover {
    background: var(--fusion-success);
    color: var(--fusion-on-accent);
  }

  /* Heightening chrome (r16-G3) --------------------------------------------- */

  /* "Patamar N" badge — shown only when the effective rank exceeds the base. */
  .spell-heighten-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.6;
    border-radius: var(--fusion-radius-pill);
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent);
    border: 1px solid var(--fusion-accent);
    vertical-align: middle;
  }

  /* Auto-scaled damage formula, monospaced so dice read clearly. */
  .spell-damage-chip {
    display: inline-block;
    margin-left: 8px;
    font-family: var(--fusion-font-mono);
    font-size: 11px;
    color: var(--fusion-text-muted);
    vertical-align: middle;
  }

  /* "Dano" roll button — reuses the ghost look with a warm accent on hover. */
  .spell-btn--damage {
    background: transparent;
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    margin-left: 8px;
  }

  .spell-btn--damage:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent-hover);
  }

  /* Complex fixed-heightening badge — clickable, routes to the details popup. */
  .spell-complex-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.6;
    border-radius: var(--fusion-radius-pill);
    background: transparent;
    color: var(--fusion-text-subtle);
    border: 1px dashed var(--fusion-border);
    cursor: pointer;
    vertical-align: middle;
  }

  .spell-complex-badge:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .focus-spell-row {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 14px;
  }

  .focus-spell-row__main {
    flex: 1;
  }

  .focus-spell-row__name {
    font-size: 14px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .focus-refocus-note {
    font-size: 11.5px;
    color: var(--fusion-text-muted);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 8px 10px;
  }

  /* Archetype/dedication class DCs (DEC-R12-04) */
  .archetype-dc-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .archetype-dc {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 8px 12px;
  }

  .archetype-dc__label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-subtle);
  }

  .archetype-dc__value {
    font-size: 15px;
    font-weight: 700;
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
  }

  /* Dangling prepared-slot state (DEC-R12-05) */
  .spell-slot-card--missing {
    border-style: dashed;
    border-color: var(--fusion-danger);
  }

  .spell-slot-card__name--missing {
    color: var(--fusion-danger);
    font-style: italic;
  }

  /* Focus pips (Foco tab) — distinct magic-purple, separate from hero pips */
  .focus-pip-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .focus-pip {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid var(--fusion-color-magic, #aa66ff);
    background: transparent;
    padding: 0;
    cursor: pointer;
    transition: background 0.15s;
  }

  .focus-pip:disabled {
    cursor: default;
  }

  .focus-pip--filled {
    background: var(--fusion-color-magic, #aa66ff);
  }

  .focus-pip--locked {
    cursor: default;
    opacity: 0.4;
    border-style: dashed;
  }

  .focus-pip-count {
    font-size: 13px;
    font-weight: 700;
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    margin-left: 4px;
  }

  .focus-add-btn {
    margin-left: auto;
  }

  .focus-refocus-note strong {
    color: var(--fusion-text);
  }

  .spells-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 20px;
    color: var(--fusion-text-muted);
    text-align: center;
    font-size: 13px;
  }

  .spells-empty--inline {
    padding: 12px;
  }

  /* Recently-added grimoire row highlight (guided 2-step flow) */
  .spell-chip--new {
    animation: spell-chip-flash 4s ease-out;
  }

  @keyframes spell-chip-flash {
    0%,
    60% {
      border-color: var(--fusion-accent);
      background: var(--fusion-accent-dim);
    }
    100% {
      border-color: var(--fusion-border);
      background: var(--fusion-surface-alt);
    }
  }

  /* Toast (bottom-center, above windows; below nothing relevant) */
  .spells-toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius);
    box-shadow: var(--fusion-shadow-modal);
    padding: 10px 14px;
    z-index: 120;
    font-size: 12.5px;
    color: var(--fusion-text);
  }

  .spells-toast__action {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: none;
    border-radius: var(--fusion-radius-sm);
    font-family: var(--fusion-font);
    font-size: 11px;
    font-weight: 600;
    padding: 5px 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .spells-toast__action:hover {
    background: var(--fusion-accent-hover);
  }

  .spells-toast__close {
    background: transparent;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    font-family: var(--fusion-font);
  }

  .spells-toast__close:hover {
    color: var(--fusion-text);
  }

  /* Mini-menu (prepare-from-grimoire / slot choice) */
  .mini-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 110;
  }

  .mini-menu {
    width: 340px;
    max-width: 100%;
    max-height: 420px;
    overflow-y: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mini-menu__title {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .mini-menu__empty {
    font-size: 12px;
    color: var(--fusion-text-muted);
    margin: 0;
    padding: 8px 0;
  }

  .mini-menu__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mini-menu__item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    font-family: var(--fusion-font);
    text-align: left;
  }

  .mini-menu__item:hover {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-accent);
  }

  .mini-menu__item-rank {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
  }

  .mini-menu__item-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .mini-menu__link {
    background: transparent;
    border: none;
    color: var(--fusion-accent);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 12px;
    text-align: left;
    padding: 4px 0 0;
    text-decoration: underline;
  }

  .mini-menu__link:hover {
    color: var(--fusion-accent-hover);
  }

  /* Spell details popup (r14-B4) — wider than the mini-menus so the full
     description reads comfortably; reuses .mini-backdrop for ESC/click-out. */
  .spell-details-modal {
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

  .spell-details-modal__close {
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

  .spell-details-modal__close:hover {
    color: var(--fusion-text);
    background: var(--fusion-surface-alt);
  }
</style>
