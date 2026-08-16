<script lang="ts">
  /**
   * CharacterSheet.svelte — PF2e Character Sheet component.
   *
   * Thin Svelte 5 wrapper over CharacterSheetVM.
   * All logic lives in characterSheetVM.ts; this file only handles rendering
   * and user events (REQ-PF2-110, REQ-UIF-021..025, spec 11 §DEC-UIF-01).
   *
   * Opens via windowManager.open() with singletonKey = "sheet:Actor:<actorId>".
   * Autosave: field changes debounce → doc:update via sendOp.
   *
   * Props:
   *   doc        — reactive actor document from DocumentMirror
   *   actorId    — actor._id
   *   ownership  — OwnershipLevel for the current user
   *   userId     — current user's id
   *   isGm       — true if current user is GM
   *   sendOpFn   — callback to emit ops via socket (injected for testability)
   *
   * NOTE: no `socket` prop — the Spells tab's compendium picker resolves the
   * LIVE socket itself via getSocket() (frozen-socket fix: componentProps are
   * captured once at window-open time and outlive socket reconnects, so a
   * prop-passed Socket reference goes stale). A caller-provided `socket` in
   * componentProps is simply ignored.
   */

  import { CharacterSheetVM, translatedStrikeDamageFormula, SCAFFOLDING_CONDITION_CATALOG } from "$lib/sheets/pf2e/characterSheetVM.js";
  import type { ChatRollPayload, DocUpdatePayload, DocOpPayload, CharacterSheetTab, SpellHealResolver } from "$lib/sheets/pf2e/characterSheetVM.js";
  import { buildSpellHealResolver } from "$lib/sheets/pf2e/spellHeal.js";
  import { skillNamePt } from "$lib/sheets/pf2e/skillNames.js";
  import { traitDisplayName } from "$lib/compendium/documentDetails.js";
  import { getSocket, session } from "$lib/session.svelte.js";
  import { sendChatOpForId } from "$lib/docs/sendOp.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import SpellsTab from "./SpellsTab.svelte";
  import ActionsTab from "./ActionsTab.svelte";
  import ProficiencyBadge from "./ProficiencyBadge.svelte";
  import PlanColumn from "./plan/PlanColumn.svelte";
  import PetsTab from "./pets/PetsTab.svelte";
  import CompendiumPickerDialog from "./plan/CompendiumPickerDialog.svelte";
  import FilePicker from "../../assets/FilePicker.svelte";
  import ActorPortrait from "../../common/ActorPortrait.svelte";
  import { detectFamiliarGrant, linkedFamiliars } from "$lib/sheets/pf2e/petsVM.js";
  import { isPortraitPlaceholder } from "$lib/common/portrait.js";
  import { fusionApi } from "$lib/api.js";
  import { t, i18n } from "$lib/i18n/i18n.js";

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    worldId?: string;
    sendOpFn?: (op: ChatRollPayload | DocOpPayload) => void;
  }

  let {
    doc,
    actorId,
    ownership,
    userId,
    isGm,
    worldId = "",
    sendOpFn = () => {},
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // Reactivity (REQ-UIF-025) — the sheet must react to doc:update broadcasts
  // that arrive after the window was opened, not just render a frozen
  // snapshot captured at open time (WindowHost stores componentProps once).
  // liveDoc starts as the initial doc and is refreshed from worldMirror
  // whenever an Actor document batch changes; vm is re-derived from liveDoc.
  // ---------------------------------------------------------------------------

  let liveDoc = $state(doc);

  $effect(() => {
    const unsub = worldMirror.subscribe<Record<string, unknown>>("Actor", (docs) => {
      const fresh = docs.find((d) => (d as { _id?: unknown })._id === actorId);
      if (fresh) liveDoc = fresh;
    });
    return unsub;
  });

  // ---------------------------------------------------------------------------
  // View-model — recreated whenever the live document changes
  // ---------------------------------------------------------------------------

  // Pack-spell heal resolver (r16): overlays each embedded spell's lost
  // heightening/damage/traits from the spells-core pack so automatic
  // heightening works. Loaded once per doc (the embedded spell set is stable
  // for a snapshot); null until loaded (spells render at base meanwhile).
  let spellHeal = $state<SpellHealResolver | null>(null);
  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");
  $effect(() => {
    // Re-run when the embedded spell names change (add/remove a spell) or the
    // system changes. Reads the RAW names + sourceIds directly off the doc to
    // avoid depending on the VM (which we're about to construct with the result).
    void systemId;
    const items = (liveDoc["items"] as Array<Record<string, unknown>> | undefined) ?? [];
    const embedded = items
      .filter((it) => it["type"] === "spell")
      .map((it) => {
        const flags = it["flags"] as Record<string, unknown> | undefined;
        const fusion = flags?.["fusion"] as Record<string, unknown> | undefined;
        return {
          name: typeof it["name"] === "string" ? (it["name"] as string) : "",
          sourceId: typeof fusion?.["sourceId"] === "string" ? (fusion["sourceId"] as string) : null,
        };
      });
    if (embedded.length === 0) {
      spellHeal = null;
      return;
    }
    let cancelled = false;
    void buildSpellHealResolver(() => getSocket(), embedded, systemId).then((resolver) => {
      if (!cancelled) spellHeal = resolver;
    });
    return () => {
      cancelled = true;
    };
  });

  const vm = $derived(
    new CharacterSheetVM({
      doc: liveDoc,
      actorId,
      ownership,
      userId,
      isGm,
      worldId,
      ...(spellHeal ? { spellHeal } : {}),
    }),
  );

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------

  // "pets" is now a canonical CharacterSheetTab (folded into the VM type, r16).
  let activeTab = $state<CharacterSheetTab>("main");

  // Pets tab visibility (REQ-PET-050): shown when the character already has a
  // linked familiar OR has a feat that grants one. worldMirror gives the live
  // actor list so linked familiars are detected reactively. Seed with the
  // current snapshot — subscribe only fires on future changes, so an existing
  // familiar wouldn't show the tab on open without the getByType seed (r16).
  let allActors = $state<Array<Record<string, unknown>>>(
    worldMirror.getByType<Record<string, unknown>>("Actor"),
  );
  $effect(() => {
    allActors = worldMirror.getByType<Record<string, unknown>>("Actor");
    const unsub = worldMirror.subscribe<Record<string, unknown>>("Actor", (docs) => {
      allActors = docs;
    });
    return unsub;
  });
  const showPetsTab = $derived(
    detectFamiliarGrant(liveDoc).canHaveFamiliar ||
      linkedFamiliars(allActors, actorId).length > 0,
  );

  // Rendered tabs (r14 #8 pt-BR labels; r14 #16: "feats" REMOVED — the Plan
  // column covers everything the Feats tab showed, at the correct levels).
  const SHEET_TABS: ReadonlyArray<{ id: CharacterSheetTab; labelKey: string }> = $derived([
    { id: "main", labelKey: "FUSION.Sheet.Tabs.Main" },
    { id: "skills", labelKey: "FUSION.Sheet.Tabs.Skills" },
    { id: "actions", labelKey: "FUSION.Sheet.Tabs.Actions" },
    { id: "spells", labelKey: "FUSION.Sheet.Tabs.Spells" },
    ...(showPetsTab ? [{ id: "pets" as const, labelKey: "FUSION.Sheet.Tabs.Pets" }] : []),
    { id: "inventory", labelKey: "FUSION.Sheet.Tabs.Inventory" },
    { id: "bio", labelKey: "FUSION.Sheet.Tabs.Bio" },
  ]);

  // ---------------------------------------------------------------------------
  // Play / Edit mode toggle (REQ-UIF-023) — local UI state, does not persist.
  // ---------------------------------------------------------------------------

  let editMode = $state(false);

  // ---------------------------------------------------------------------------
  // Plan column visibility (DEC-R10-05) — local UI state, does not persist.
  // The column is navigable regardless of editMode; only its write actions
  // are gated by vm.editable (ownership), not by the Play/Edit toggle.
  // ---------------------------------------------------------------------------

  let planVisible = $state(true);

  // ---------------------------------------------------------------------------
  // Autosave state
  // ---------------------------------------------------------------------------

  let saveStatus = $state<"idle" | "saving" | "saved">("idle");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 400;

  function scheduleUpdate(op: DocUpdatePayload | null): void {
    if (!op) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    saveStatus = "saving";
    debounceTimer = setTimeout(() => {
      sendOpFn(op);
      saveStatus = "saved";
      setTimeout(() => { saveStatus = "idle"; }, 1500);
    }, DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  // Roll helpers
  // ---------------------------------------------------------------------------

  function rollSkill(slug: string): void {
    sendOpFn(vm.rollSkill(slug));
  }

  /**
   * Localized tradition name, used to qualify a spell DC when the server could
   * not attribute the entry to a class (two casting classes, no `classKey`).
   * Mirrors SpellsTab's own helper — same key space, same fallback.
   */
  function traditionLabel(tradition: string): string {
    const key = `FUSION.Sheet.Spells.Tradition.${tradition}`;
    const resolved = t(key);
    return resolved === key ? tradition : resolved;
  }

  function rollSave(name: "fortitude" | "reflex" | "will"): void {
    sendOpFn(vm.rollSave(name));
  }

  function rollPerception(): void {
    sendOpFn(vm.rollPerception());
  }

  /**
   * Emit an ability announcement (card) + its attack, NESTING the attack under
   * the announcement (r20-X1) so attack + (card) damage read as ONE card. Sends
   * the announcement over a live socket awaiting its ack (sendChatOpForId), then
   * fires the attack with `parentMessageId`. On any failure falls back to
   * un-nested delivery so a roll is NEVER lost. Mirrors SpellsTab.emitCast.
   */
  function emitAbility(built: { announcement: ChatRollPayload; attack: ChatRollPayload }): void {
    const sock = getSocket();
    if (!sock) {
      sendOpFn(built.announcement);
      sendOpFn(built.attack);
      return;
    }
    void (async () => {
      try {
        const parentId = await sendChatOpForId(sock, built.announcement);
        const nested: ChatRollPayload = parentId
          ? { ...built.attack, flags: { ...built.attack.flags, parentMessageId: parentId } }
          : built.attack;
        sendOpFn(nested);
      } catch {
        sendOpFn(built.announcement);
        sendOpFn(built.attack);
      }
    })();
  }

  function rollStrike(sourceId: string, mapIndex: 0 | 1 | 2): void {
    // r20-X1: rolling an attack posts a strike card with the attack nested + a
    // "Rolar dano" button. Falls back to a loose attack roll if the derived
    // strike is unavailable (defensive).
    const built = vm.strikeCard(sourceId, mapIndex);
    if (built) emitAbility(built);
    else sendOpFn(vm.rollStrike(sourceId, mapIndex));
  }

  function rollStrikeDamage(sourceId: string, crit: boolean): void {
    const op = vm.rollStrikeDamage(sourceId, crit);
    if (op) sendOpFn(op);
  }

  function rollBlast(element: string, mapIndex: 0 | 1 | 2): void {
    // r20-X1: rolling a blast attack posts a Rajada card with the attack nested.
    const built = vm.blastCard(element, mapIndex);
    if (built) emitAbility(built);
  }

  function rollBlastDamage(element: string, twoAction: boolean): void {
    const op = vm.rollElementalBlastDamage(element, twoAction);
    if (op) sendOpFn(op);
  }

  // Inventory — add from compendium (r18-N2c). One picker, selectable pack
  // (equipment vs weapons); the chosen doc is added UNEQUIPPED.
  let inventoryPickerPack = $state<string | null>(null);

  function handleInventoryPick(itemDoc: Record<string, unknown>): void {
    const op = vm.addInventoryItem(itemDoc);
    if (op) sendOpFn(op);
    inventoryPickerPack = null;
  }

  function toggleEquip(itemId: string): void {
    const op = vm.toggleEquipItem(itemId);
    if (op) sendOpFn(op);
  }

  function removeInventoryItem(itemId: string): void {
    const op = vm.removeInventoryItem(itemId);
    if (op) sendOpFn(op);
  }

  function toggleCondition(slug: string): void {
    const op = vm.toggleCondition(slug);
    if (op) sendOpFn(op);
  }

  // SCAFFOLDING (T034): conditions not already active, for the "+ Condition"
  // add picker below (see SCAFFOLDING_CONDITION_CATALOG docstring).
  const availableConditions = $derived(
    SCAFFOLDING_CONDITION_CATALOG.filter(
      (c) => !vm.conditions.some((active) => active.slug === c.slug),
    ),
  );

  function handleAddCondition(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const slug = select.value;
    select.value = "";
    if (slug) toggleCondition(slug);
  }

  // ---------------------------------------------------------------------------
  // Portrait (r19-W4) — owner/GM can swap the actor's img via the shared asset
  // FilePicker/upload or remove it (back to the initials fallback). Persisted
  // as `doc.img` through the standard debounced doc:update (vm.fieldUpdate,
  // normalized to the wire's { updates:[{ _id, diff }] } by sendOp). Gated by
  // vm.editable (ownership), independent of the Play/Edit toggle.
  // ---------------------------------------------------------------------------

  let showPortraitPicker = $state(false);

  function handlePortraitSelect(path: string): void {
    scheduleUpdate(vm.fieldUpdate("img", path));
    showPortraitPicker = false;
  }

  function removePortrait(): void {
    scheduleUpdate(vm.fieldUpdate("img", ""));
  }

  // ---------------------------------------------------------------------------
  // Rest (header "Descansar" button — Pathbuilder "Rest" reference).
  // Recovers every expended spell slot, refills Focus Points, and heals HP
  // (CON mod × level, min 1 × level — r16). Emits a chat summary card.
  // ---------------------------------------------------------------------------

  function rest(): void {
    const ops = vm.restAll();
    if (ops.length === 0) return;
    if (!confirm(t("FUSION.Sheet.Rest.Confirm"))) return;
    for (const op of ops) sendOpFn(op);
  }

  // HP inline editing
  function handleHpInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const newValue = parseInt(input.value, 10);
    if (!Number.isNaN(newValue)) {
      const op = vm.fieldUpdate("system.attributes.hp.value", Math.max(0, Math.min(newValue, vm.hpMax)));
      scheduleUpdate(op);
    }
  }

  // ---------------------------------------------------------------------------
  // Hero / Focus points — clickable pips
  // ---------------------------------------------------------------------------

  function clickHeroPip(index: number): void {
    // index is 0-based; clicking pip N sets value to N+1, unless that pip is
    // already the highest filled one, in which case it decrements to N.
    const current = vm.heroPoints.value;
    const newValue = index + 1 === current ? index : index + 1;
    const op = vm.setHeroPoints(newValue);
    if (op) scheduleUpdate(op);
  }

  function clickFocusPip(index: number): void {
    const current = vm.focusPoints.value;
    const newValue = index + 1 === current ? index : index + 1;
    const op = vm.setFocusPoints(newValue);
    if (op) scheduleUpdate(op);
  }

  // ---------------------------------------------------------------------------
  // Edit-mode field handlers (REQ-UIF-023)
  // ---------------------------------------------------------------------------

  function handleNameInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    scheduleUpdate(vm.updateName(input.value));
  }

  function handleLevelInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateLevel(val));
  }

  function handleSpeedInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateSpeed(val));
  }

  function handleHpMaxInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateHpMax(val));
  }

  function handleAbilityScoreInput(slug: string, e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateAbilityScore(slug, val));
  }

  function handleSaveRankChange(name: "fortitude" | "reflex" | "will", e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const val = parseInt(select.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateSaveRank(name, val));
  }

  function handlePerceptionRankChange(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const val = parseInt(select.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updatePerceptionRank(val));
  }

  function handleSkillRankChange(slug: string, e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const val = parseInt(select.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateSkillRank(slug, val));
  }

  function handleHeroMaxInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.fieldUpdate("system.resources.heroPoints.max", val));
  }

  function handleHeroValueInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.setHeroPoints(val));
  }

  function handleFocusMaxInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.fieldUpdate("system.resources.focusPoints.max", val));
  }

  function handleFocusValueInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.setFocusPoints(val));
  }

  // TEML rank options shared by the Saves/Perception/Skills edit selects.
  const RANK_OPTIONS = [
    { value: 0, label: "U" },
    { value: 1, label: "T" },
    { value: 2, label: "E" },
    { value: 3, label: "M" },
    { value: 4, label: "L" },
  ];
</script>

<!-- ======================================================================
  Character Sheet
  REQ-UIF-061: container queries for responsive layout within the window.
  DEC-R10-05: the Plan column sits to the left of the sheet body, always
  navigable (editMode does not hide it) — only its write actions require
  vm.editable. "Ocultar plano"/"Mostrar plano" is local UI state, not
  persisted.
====================================================================== -->
<div class="pf2e-sheet-shell">
  {#if planVisible}
    <PlanColumn
      doc={liveDoc}
      {actorId}
      editable={vm.editable}
      sendOpFn={(op) => sendOpFn(op)}
      onHide={() => { planVisible = false; }}
    />
  {/if}

  <div class="pf2e-sheet pf2e-character-sheet" role="document" aria-label="Character Sheet: {vm.name}">

  <!-- ---- Header ---- -->
  <header class="sheet-header">
    {#if !planVisible}
      <button type="button" class="show-plan-btn" onclick={() => { planVisible = true; }}>
        {t("FUSION.Sheet.Plan.Show")}
      </button>
    {/if}
    <!-- Portrait (r19-W4): circular, with an initials fallback. Owner/GM can
         click to swap via the FilePicker, or remove (back to fallback). -->
    <div class="sheet-portrait-wrap">
      {#if vm.editable}
        <button
          type="button"
          class="sheet-portrait-edit"
          style="width:56px;height:56px;"
          onclick={() => { showPortraitPicker = true; }}
          title={t("FUSION.Sheet.Portrait.Change")}
          aria-label={t("FUSION.Sheet.Portrait.Change")}
        >
          <ActorPortrait
            img={vm.img}
            docRef={{ table: "actors", id: actorId }}
            name={vm.name}
            size={56}
          />
          <span class="sheet-portrait-edit__overlay" aria-hidden="true">✎</span>
        </button>
        {#if !isPortraitPlaceholder(vm.img)}
          <button
            type="button"
            class="sheet-portrait-remove"
            onclick={removePortrait}
            title={t("FUSION.Sheet.Portrait.Remove")}
            aria-label={t("FUSION.Sheet.Portrait.Remove")}
          >×</button>
        {/if}
      {:else}
        <ActorPortrait
          img={vm.img}
          docRef={{ table: "actors", id: actorId }}
          name={vm.name}
          size={56}
          label={t("FUSION.Sheet.Portrait.Alt", { name: vm.name })}
        />
      {/if}
    </div>

    <div class="sheet-header__info">
      <h2 class="sheet-header__name">{vm.name}</h2>
      <div class="sheet-header__subtitle">
        {vm.ancestryLabel}
        {#if vm.ancestryLabel && vm.classLabel} · {/if}
        {vm.classLabel}
        {t("FUSION.Sheet.Header.Level", { level: String(vm.level) })}
      </div>
    </div>

    <!-- Play/Edit toggle (REQ-UIF-023) — visible only to editors; local UI state -->
    {#if vm.editable}
      <button
        class="mode-toggle"
        aria-pressed={editMode}
        aria-label={editMode ? "Switch to Play mode" : "Switch to Edit mode"}
        onclick={() => { editMode = !editMode; }}
      >
        {editMode ? t("FUSION.Sheet.Mode.Play") : t("FUSION.Sheet.Mode.Edit")}
      </button>
      <button
        type="button"
        class="rest-btn"
        onclick={rest}
        aria-label={t("FUSION.Sheet.Rest.Button")}
        title={t("FUSION.Sheet.Rest.Confirm")}
      >
        {t("FUSION.Sheet.Rest.Button")}
      </button>
    {/if}

    <!-- HP editor -->
    <div class="sheet-hp" aria-label="Hit Points">
      <label class="sheet-hp__label" for="hp-input-{actorId}">{t("FUSION.Sheet.Labels.HP")}</label>
      <div class="sheet-hp__row">
        {#if vm.editable}
          <input
            id="hp-input-{actorId}"
            class="sheet-hp__value"
            type="number"
            min="0"
            max={vm.hpMax}
            value={vm.hpCurrent}
            oninput={handleHpInput}
            aria-label="Current HP"
          />
        {:else}
          <span class="sheet-hp__value sheet-hp__value--readonly">{vm.hpCurrent}</span>
        {/if}
        <span class="sheet-hp__sep">/</span>
        <span class="sheet-hp__max">{vm.hpMax}</span>
        {#if vm.hpTemp > 0}
          <span class="sheet-hp__temp">(+{vm.hpTemp})</span>
        {/if}
      </div>
      {#if saveStatus === "saving"}
        <span class="sheet-save-status sheet-save-status--saving" aria-live="polite">{t("FUSION.Sheet.Autosave.Saving")}</span>
      {:else if saveStatus === "saved"}
        <span class="sheet-save-status sheet-save-status--saved" aria-live="polite">{t("FUSION.Sheet.Autosave.Saved")}</span>
      {/if}
    </div>

    <!-- AC / Perception row -->
    <div class="sheet-defenses">
      <div class="defense-block" aria-label="Armor Class {vm.ac}">
        <span class="defense-block__value">{vm.ac}</span>
        <span class="defense-block__label">{t("FUSION.Sheet.Labels.AC")}</span>
      </div>
      <button
        class="defense-block defense-block--rollable"
        onclick={rollPerception}
        aria-label="Roll Perception {vm.perception.totalFormatted}"
      >
        <span class="defense-block__value">{vm.perception.totalFormatted}</span>
        <span class="defense-block__label">{t("FUSION.Sheet.Labels.Perception")}</span>
      </button>
    </div>

    <!-- Dying / Wounded / Doomed badges (visible only when > 0) -->
    {#if vm.dying > 0 || vm.wounded > 0 || vm.doomed > 0}
      <div class="sheet-status-badges" role="status" aria-label="Character status">
        {#if vm.dying > 0}
          <span class="status-badge status-badge--dying">{t("FUSION.Sheet.Status.Dying", { value: String(vm.dying), max: String(vm.dyingMax) })}</span>
        {/if}
        {#if vm.wounded > 0}
          <span class="status-badge status-badge--wounded">{t("FUSION.Sheet.Status.Wounded", { value: String(vm.wounded) })}</span>
        {/if}
        {#if vm.doomed > 0}
          <span class="status-badge status-badge--doomed">{t("FUSION.Sheet.Status.Doomed", { value: String(vm.doomed) })}</span>
        {/if}
      </div>
    {/if}

    <!-- Hero / Focus Points -->
    <div class="sheet-resources">
      <div
        class="resource-pip-group"
        title={t("FUSION.Sheet.HeroPoints.Tooltip")}
        aria-label={t("FUSION.Sheet.HeroPoints.Group", { value: String(vm.heroPoints.value), max: String(vm.heroPoints.max) })}
      >
        {#each { length: vm.heroPoints.max } as _, i}
          <button
            class="resource-pip resource-pip--hero"
            class:resource-pip--filled={i < vm.heroPoints.value}
            title={t("FUSION.Sheet.HeroPoints.SetTo", { n: String(i < vm.heroPoints.value ? i : i + 1) })}
            aria-label={t("FUSION.Sheet.HeroPoints.Pip", { n: String(i + 1) })}
            onclick={() => clickHeroPip(i)}
          ></button>
        {/each}
        <span class="resource-label">{t("FUSION.Sheet.HeroPoints.Label")}</span>
      </div>
      {#if vm.focusPoints.max > 0 || vm.focusPoints.value > 0}
        <!-- Focus pips always render up to the DEC-R10-02 hard cap (3), even
             when the character's current max is lower — pips beyond `max`
             render locked/hatched (unclickable), matching the design
             contract's PipRow "locked" state (guidelines/pips.card.html). -->
        <div
          class="resource-pip-group"
          aria-label={t("FUSION.Sheet.Spells.FocusPointsGroup", { value: String(vm.focusPoints.value), max: String(vm.focusPoints.max) })}
        >
          {#each { length: 3 } as _, i}
            {#if i < vm.focusPoints.max}
              <button
                class="resource-pip resource-pip--focus"
                class:resource-pip--filled={i < vm.focusPoints.value}
                title={t("FUSION.Sheet.Spells.SetFocusPoints", { n: String(i < vm.focusPoints.value ? i : i + 1) })}
                aria-label={t("FUSION.Sheet.Spells.FocusPip", { n: String(i + 1) })}
                onclick={() => clickFocusPip(i)}
              ></button>
            {:else}
              <span
                class="resource-pip resource-pip--focus resource-pip--locked"
                title={t("FUSION.Sheet.Spells.FocusPipLocked")}
                aria-label={t("FUSION.Sheet.Spells.FocusPipLockedAria", { n: String(i + 1) })}
              ></span>
            {/if}
          {/each}
          <span class="resource-label">{t("FUSION.Sheet.Spells.FocusTab")}</span>
        </div>
      {/if}
    </div>
  </header>

  <!-- ---- Ability Scores row ---- -->
  <div class="ability-row" role="list" aria-label="Ability Scores">
    {#each vm.abilities as ability (ability.slug)}
      <div class="ability-block" role="listitem" aria-label="{ability.longLabel} {ability.score}">
        <span class="ability-block__label">{ability.label}</span>
        <span class="ability-block__score">{ability.score}</span>
        <span class="ability-block__mod">{ability.modFormatted}</span>
      </div>
    {/each}
  </div>

  <!-- ---- Saves row ---- -->
  <div class="saves-row" role="list" aria-label="Saving Throws">
    {#each vm.saves as save (save.slug)}
      <button
        class="save-block"
        role="listitem"
        onclick={() => rollSave(save.slug as "fortitude" | "reflex" | "will")}
        aria-label="Roll {save.label} save ({save.totalFormatted})"
      >
        <span class="save-block__mod">{save.totalFormatted}</span>
        <span class="save-block__label">{save.label}</span>
        <span class="save-block__rank" aria-label="Rank: {save.rankLabel}">{save.rankLabel}</span>
      </button>
    {/each}

    <!--
      Multiclass strip: one block per class, sharing the saves row so the
      division is always on screen without costing vertical space. Only shown
      when there IS a division — a single-class sheet already says its class in
      the header and would just get a redundant box.
    -->
    {#if vm.classLevelSummary.length > 1}
      {#each vm.classLevelSummary as klass (klass.label)}
        <div
          class="save-block save-block--class"
          role="listitem"
          title="{klass.label} {klass.classLevel} — CD de classe {klass.dc}"
        >
          <span class="save-block__mod">{klass.dc}</span>
          <span class="save-block__label">{klass.label} {klass.classLevel}</span>
          <span class="save-block__rank">CD</span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- ---- Active Conditions ---- -->
  {#if vm.conditions.length > 0 || vm.editable}
    <div class="conditions-bar" role="list" aria-label="Active Conditions">
      {#each vm.conditions as cond (cond.itemId)}
        <button
          class="condition-chip"
          role="listitem"
          onclick={() => toggleCondition(cond.slug)}
          aria-label="{cond.label}{cond.value != null ? ' ' + String(cond.value) : ''} — click to remove"
          title="Click to remove {cond.label}"
        >
          {cond.label}{cond.value != null ? ` ${String(cond.value)}` : ""}
          <span class="condition-chip__remove" aria-hidden="true">✕</span>
        </button>
      {/each}
      {#if vm.editable && availableConditions.length > 0}
        <!--
          SCAFFOLDING (T034): minimal add-condition control — makes
          vm.toggleCondition's "add" branch reachable from the UI. Not a real
          picker (no valued-condition value input, small hand-picked slug
          list); see SCAFFOLDING_CONDITION_CATALOG in characterSheetVM.ts.
        -->
        <select
          class="condition-add-select"
          aria-label="Add condition"
          onchange={handleAddCondition}
        >
          <option value="">+ Condition…</option>
          {#each availableConditions as c (c.slug)}
            <option value={c.slug}>{c.label}</option>
          {/each}
        </select>
      {/if}
    </div>
  {/if}

  <!-- ---- Tab bar ---- -->
  <!--
    r14 #8: labels em pt-BR (Principal/Perícias/Ações/Magias/Inventário/Bio).
    r14 #16: a aba "Feats" foi REMOVIDA — o Plano cobre 100% do que ela mostrava
    (e mostrava níveis errados). Ver auditoria r14 §4.
  -->
  <div class="tab-bar" role="tablist" aria-label="Character sheet sections">
    {#each SHEET_TABS as tab (tab.id)}
      <button
        class="tab-btn"
        class:tab-btn--active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        aria-controls="tab-panel-{tab.id}"
        id="tab-{tab.id}"
        onclick={() => { activeTab = tab.id; }}
      >
        {t(tab.labelKey)}
      </button>
    {/each}
  </div>

  <!-- ---- Tab panels ---- -->

  <!-- MAIN tab: Speed, Class DC, Spell DC, Senses -->
  {#if activeTab === "main"}
    <section
      id="tab-panel-main"
      role="tabpanel"
      aria-labelledby="tab-main"
      class="tab-panel tab-panel--main"
    >
      {#if editMode}
        <div class="edit-field">
          <label for="edit-name-{actorId}">{t("FUSION.Sheet.Labels.Name")}</label>
          <input id="edit-name-{actorId}" type="text" value={vm.name} oninput={handleNameInput} />
        </div>
        <div class="edit-field-row">
          <div class="edit-field">
            <label for="edit-level-{actorId}">{t("FUSION.Sheet.Labels.Level")}</label>
            <input id="edit-level-{actorId}" type="number" min="1" max="20" value={vm.level} oninput={handleLevelInput} />
          </div>
          <div class="edit-field">
            <label for="edit-speed-{actorId}">{t("FUSION.Sheet.Labels.Speed")}</label>
            <input id="edit-speed-{actorId}" type="number" min="0" value={vm.speed} oninput={handleSpeedInput} />
          </div>
          <div class="edit-field">
            <label for="edit-hpmax-{actorId}">{t("FUSION.Sheet.Labels.HPMax")}</label>
            <input id="edit-hpmax-{actorId}" type="number" min="0" value={vm.hpMax} oninput={handleHpMaxInput} />
          </div>
        </div>

        <h3 class="section-header">{t("FUSION.Sheet.Labels.Abilities")}</h3>
        <div class="edit-field-row edit-field-row--abilities">
          {#each vm.abilities as ability (ability.slug)}
            <div class="edit-field">
              <label for="edit-ability-{ability.slug}-{actorId}">{ability.label}</label>
              <input
                id="edit-ability-{ability.slug}-{actorId}"
                type="number"
                value={ability.score}
                oninput={(e) => handleAbilityScoreInput(ability.slug, e)}
              />
            </div>
          {/each}
        </div>

        <h3 class="section-header">{t("FUSION.Sheet.Labels.SavesAndPerception")}</h3>
        <div class="edit-field-row">
          {#each vm.saves as save (save.slug)}
            <div class="edit-field">
              <label for="edit-save-{save.slug}-{actorId}">{save.label}</label>
              <select
                id="edit-save-{save.slug}-{actorId}"
                value={save.rank}
                onchange={(e) => handleSaveRankChange(save.slug as "fortitude" | "reflex" | "will", e)}
              >
                {#each RANK_OPTIONS as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
          {/each}
          <div class="edit-field">
            <label for="edit-perception-{actorId}">{t("FUSION.Sheet.Labels.Perception")}</label>
            <select id="edit-perception-{actorId}" value={vm.perception.rank} onchange={handlePerceptionRankChange}>
              {#each RANK_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <h3 class="section-header">{t("FUSION.Sheet.Labels.Resources")}</h3>
        <div class="edit-field-row">
          <div class="edit-field">
            <label for="edit-hero-value-{actorId}">{t("FUSION.Sheet.Labels.HeroPoints")}</label>
            <input id="edit-hero-value-{actorId}" type="number" min="0" value={vm.heroPoints.value} oninput={handleHeroValueInput} />
          </div>
          <div class="edit-field">
            <label for="edit-hero-max-{actorId}">{t("FUSION.Sheet.Labels.HeroPointsMax")}</label>
            <input id="edit-hero-max-{actorId}" type="number" min="0" value={vm.heroPoints.max} oninput={handleHeroMaxInput} />
          </div>
          <div class="edit-field">
            <label for="edit-focus-value-{actorId}">{t("FUSION.Sheet.Spells.FocusPoints")}</label>
            <input id="edit-focus-value-{actorId}" type="number" min="0" value={vm.focusPoints.value} oninput={handleFocusValueInput} />
          </div>
          <div class="edit-field">
            <label for="edit-focus-max-{actorId}">{t("FUSION.Sheet.Labels.FocusPointsMax")}</label>
            <input id="edit-focus-max-{actorId}" type="number" min="0" value={vm.focusPoints.max} oninput={handleFocusMaxInput} />
          </div>
        </div>
      {:else}
        <div class="stat-row">
          <div class="stat-block">
            <span class="stat-block__value">{vm.speed} {t("FUSION.Sheet.Pets.Feet")}</span>
            <span class="stat-block__label">{t("FUSION.Sheet.Labels.Speed")}</span>
          </div>
          <div class="stat-block">
            <span class="stat-block__value">{vm.perception.totalFormatted}</span>
            <span class="stat-block__label">{t("FUSION.Sheet.Labels.PerceptionAbbrev")} ({vm.perception.rankLabel})</span>
          </div>
          <div class="stat-block">
            <span class="stat-block__value">{vm.classDC.dc}</span>
            <!-- With more than one class this number is the HIGHEST of them —
                 what an effect saying "your class DC" without naming one uses.
                 Saying so beats printing an unqualified number the player
                 cannot reconcile with the per-class strip above. -->
            <span class="stat-block__label">
              {vm.classLevelSummary.length > 1
                ? t("FUSION.Sheet.Labels.ClassDCBest")
                : t("FUSION.Sheet.Labels.ClassDC")}
            </span>
          </div>
          <!-- One block per casting entry, each labelled with the class that
               owns it: a single unlabelled "Spell DC" is ambiguous the moment
               a character casts from two classes. -->
          {#each vm.spellcastingEntries.filter((e) => !e.isFocusPool) as entry (entry.entryId)}
            <div class="stat-block">
              <span class="stat-block__value">{entry.spellDC}</span>
              <!-- Class first; tradition as the fallback qualifier. Two blocks
                   both reading just "CD de Magia" is the confusion this
                   replaces — and the tradition is always on the entry even
                   when the server declined to attribute the class. -->
              <span class="stat-block__label">
                {entry.ownerClassLabel
                  ? t("FUSION.Sheet.Labels.SpellDCOf", { class: entry.ownerClassLabel })
                  : entry.tradition
                    ? t("FUSION.Sheet.Labels.SpellDCOf", { class: traditionLabel(entry.tradition) })
                    : t("FUSION.Sheet.Labels.SpellDC")}
              </span>
            </div>
          {/each}
        </div>
        {#if vm.senses.length > 0}
          <div class="senses-row" aria-label="Senses">
            <span class="senses-row__label">{t("FUSION.Sheet.Labels.Senses")}:</span>
            <span class="senses-row__value">{vm.senses.join(", ")}</span>
          </div>
        {/if}
      {/if}
    </section>

  <!-- SKILLS tab -->
  {:else if activeTab === "skills"}
    <section
      id="tab-panel-skills"
      role="tabpanel"
      aria-labelledby="tab-skills"
      class="tab-panel tab-panel--skills"
    >
      {#if editMode}
        <ul class="skill-list" aria-label="Skills">
          {#each vm.skills as skill (skill.slug)}
            <li class="skill-row skill-row--edit">
              <span class="skill-row__name">
                {skillNamePt(skill.slug)}
                <span class="skill-row__name-en">{skill.label}</span>
              </span>
              <select
                aria-label="{skill.label} rank"
                value={skill.rank}
                onchange={(e) => handleSkillRankChange(skill.slug, e)}
              >
                {#each RANK_OPTIONS as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </li>
          {/each}
        </ul>
      {:else}
        <!-- All 16 canonical skills + lores, untrained included (feedback item
             2 / DEC-R10-07) — every row stays clickable via rollSkill,
             untrained rows just get a slightly reduced opacity so the eye
             still lands on trained+ skills first. -->
        <ul class="skill-list" aria-label="Skills">
          {#each vm.skills as skill (skill.slug)}
            <li class="skill-row" class:skill-row--untrained={skill.rank === 0}>
              <ProficiencyBadge rank={skill.rankLabel as "U" | "T" | "E" | "M" | "L"} size={18} title={skill.rankLabelFull} />
              <button
                class="skill-row__name skill-row__rollable"
                onclick={() => rollSkill(skill.slug)}
                aria-label="Roll {skill.label} ({skill.totalFormatted})"
              >
                {skillNamePt(skill.slug)}
                <span class="skill-row__name-en">{skill.label}</span>
              </button>
              <span class="skill-row__ability">{skill.abilityLabel}</span>
              <span class="skill-row__total">{skill.totalFormatted}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

  <!-- ACTIONS tab: Strikes -->
  {:else if activeTab === "actions"}
    <section
      id="tab-panel-actions"
      role="tabpanel"
      aria-labelledby="tab-actions"
      class="tab-panel tab-panel--actions"
    >
      {#if vm.strikes.length > 0}
        <h3 class="section-header">{t("FUSION.Sheet.Actions.Strikes.Header")}</h3>
        <ul class="strike-list" aria-label={t("FUSION.Sheet.Actions.Strikes.Header")}>
          {#each vm.strikes as strike (strike.sourceId)}
            <li class="strike-row">
              <div class="strike-row__header">
                <span class="strike-row__name">{strike.label}</span>
                {#if strike.isRanged}
                  <span class="trait-badge">{t("FUSION.Sheet.Actions.Strikes.Ranged")}</span>
                {/if}
                {#if strike.isAgile}
                  <span class="trait-badge">{t("FUSION.Sheet.Actions.Strikes.Agile")}</span>
                {/if}
              </div>
              <div class="strike-row__variants" role="group" aria-label="Attack rolls for {strike.label}">
                {#each strike.variants as variant, i}
                  <button
                    class="map-btn"
                    onclick={() => rollStrike(strike.sourceId, i as 0 | 1 | 2)}
                    aria-label="Roll {strike.label} at MAP {String(i)} ({variant.totalFormatted})"
                  >
                    <span class="map-btn__total">{variant.totalFormatted}</span>
                    <span class="map-btn__label">MAP {String(i)}</span>
                  </button>
                {/each}
                {#if vm.rollStrikeDamage(strike.sourceId, false)}
                  <button
                    class="map-btn map-btn--damage"
                    onclick={() => rollStrikeDamage(strike.sourceId, false)}
                    aria-label="Roll {strike.label} damage"
                  >
                    <span class="map-btn__label">{t("FUSION.Sheet.Actions.Strikes.DamageLabel")}</span>
                  </button>
                {/if}
                {#if vm.rollStrikeDamage(strike.sourceId, true)}
                  <button
                    class="map-btn map-btn--crit"
                    onclick={() => rollStrikeDamage(strike.sourceId, true)}
                    aria-label="Roll {strike.label} critical damage"
                  >
                    <span class="map-btn__label">{t("FUSION.Sheet.Actions.Strikes.CritLabel")}</span>
                  </button>
                {/if}
              </div>
              <div class="strike-row__damage">
                <!-- translatedStrikeDamageFormula() swaps the raw EN damage-type
                     word (always the last token) for its pt-BR translation. -->
                {t("FUSION.Sheet.Actions.Strikes.DamagePrefix")} <span class="damage-formula">{translatedStrikeDamageFormula(strike)}</span>
              </div>
              {#if strike.traits.length > 0}
                <div class="strike-row__traits">
                  {#each strike.traits as trait}
                    <span class="trait-badge">{traitDisplayName(trait, i18n.locale)}</span>
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">{t("FUSION.Sheet.Actions.Strikes.Empty")}</p>
      {/if}

      {#if vm.elementalBlasts.length > 0}
        <h3 class="section-header">{t("FUSION.Sheet.Blasts.Header")}</h3>
        <ul class="strike-list" aria-label={t("FUSION.Sheet.Blasts.Header")}>
          {#each vm.elementalBlasts as blast (blast.element)}
            <li class="strike-row">
              <div class="strike-row__header">
                <span class="strike-row__name">{blast.label}</span>
                {#if blast.isRanged && blast.range !== null}
                  <span class="trait-badge">{t("FUSION.Sheet.Blasts.RangeFeet", { range: String(blast.range) })}</span>
                {/if}
                <span class="trait-badge">{t("FUSION.Sheet.Actions.Impulse")}</span>
              </div>
              <div class="strike-row__variants" role="group" aria-label="Attack rolls for {blast.label}">
                {#each blast.variants as variant, i}
                  <button
                    class="map-btn"
                    onclick={() => rollBlast(blast.element, i as 0 | 1 | 2)}
                    aria-label="Roll {blast.label} at MAP {String(i)} ({variant.totalFormatted})"
                  >
                    <span class="map-btn__total">{variant.totalFormatted}</span>
                    <span class="map-btn__label">MAP {String(i)}</span>
                  </button>
                {/each}
                <button
                  class="map-btn map-btn--damage"
                  onclick={() => rollBlastDamage(blast.element, false)}
                  aria-label="Roll {blast.label} damage"
                >
                  <span class="map-btn__label">{t("FUSION.Sheet.Actions.Strikes.DamageLabel")}</span>
                </button>
                {#if blast.twoActionDamageBonus !== 0}
                  <button
                    class="map-btn map-btn--crit"
                    onclick={() => rollBlastDamage(blast.element, true)}
                    aria-label="Roll {blast.label} 2-action damage"
                  >
                    <span class="map-btn__label">{t("FUSION.Sheet.Blasts.TwoAction")}</span>
                  </button>
                {/if}
              </div>
              <div class="strike-row__damage">
                {t("FUSION.Sheet.Actions.Strikes.DamagePrefix")} <span class="damage-formula">{blast.damageFormula}</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <h3 class="section-header">{t("FUSION.Sheet.Actions.Title")}</h3>
      <ActionsTab doc={liveDoc} />
    </section>

  <!-- SPELLS tab (DEC-R10-03/04) -->
  {:else if activeTab === "spells"}
    <section
      id="tab-panel-spells"
      role="tabpanel"
      aria-labelledby="tab-spells"
      class="tab-panel tab-panel--spells"
    >
      <SpellsTab {vm} sendOpFn={(op) => sendOpFn(op as ChatRollPayload | DocOpPayload)} />
    </section>

  <!-- PETS tab (spec 29 / REQ-PET-050) -->
  {:else if activeTab === "pets"}
    <section
      id="tab-panel-pets"
      role="tabpanel"
      aria-labelledby="tab-pets"
      class="tab-panel tab-panel--pets"
    >
      <PetsTab
        masterDoc={liveDoc}
        masterId={actorId}
        editable={vm.editable}
        {userId}
        {isGm}
        {ownership}
        {worldId}
      />
    </section>

  <!-- INVENTORY tab -->
  {:else if activeTab === "inventory"}
    <section
      id="tab-panel-inventory"
      role="tabpanel"
      aria-labelledby="tab-inventory"
      class="tab-panel tab-panel--inventory"
    >
      {#if editMode}
        <div class="inventory-actions">
          <button type="button" class="inventory-add-btn" onclick={() => { inventoryPickerPack = "equipment-core"; }}>
            {t("FUSION.Sheet.Inventory.AddEquipment")}
          </button>
          <button type="button" class="inventory-add-btn" onclick={() => { inventoryPickerPack = "weapons-core"; }}>
            {t("FUSION.Sheet.Inventory.AddWeapon")}
          </button>
        </div>
      {/if}
      {#if vm.inventory.length > 0}
        <ul class="inventory-list" aria-label="Inventory">
          {#each vm.inventory as item (item.id)}
            <li class="inventory-row">
              {#if item.img}
                <img class="inventory-row__icon" src={item.img} alt="" width="24" height="24" aria-hidden="true" />
              {/if}
              <span class="inventory-row__name">{item.name}</span>
              <span class="inventory-row__qty">×{item.quantity}</span>
              <span class="inventory-row__bulk">{t("FUSION.Sheet.Inventory.Bulk", { bulk: String(item.bulk) })}</span>
              <button
                type="button"
                class="inventory-row__equip"
                class:inventory-row__equip--on={item.equipped}
                disabled={!editMode}
                onclick={() => toggleEquip(item.id)}
                aria-pressed={item.equipped}
                aria-label={item.equipped
                  ? t("FUSION.Sheet.Inventory.Unequip", { name: item.name })
                  : t("FUSION.Sheet.Inventory.Equip", { name: item.name })}
              >
                {item.equipped ? t("FUSION.Sheet.Inventory.Equipped") : t("FUSION.Sheet.Inventory.Unequipped")}
              </button>
              {#if editMode}
                <button
                  type="button"
                  class="inventory-row__remove"
                  onclick={() => removeInventoryItem(item.id)}
                  aria-label={t("FUSION.Sheet.Inventory.Remove", { name: item.name })}
                >
                  &times;
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">{t("FUSION.Sheet.Inventory.Empty")}</p>
      {/if}
    </section>

  <!-- BIO tab -->
  {:else if activeTab === "bio"}
    <section
      id="tab-panel-bio"
      role="tabpanel"
      aria-labelledby="tab-bio"
      class="tab-panel tab-panel--bio"
    >
      <div class="bio-details">
        <div class="bio-details__row"><strong>{t("FUSION.Sheet.Plan.Abc.Ancestry")}:</strong> {vm.detailsInfo.ancestry || "—"}</div>
        <div class="bio-details__row"><strong>{t("FUSION.Sheet.Plan.Abc.Background")}:</strong> {vm.detailsInfo.background || "—"}</div>
        <div class="bio-details__row"><strong>{t("FUSION.Sheet.Plan.Abc.Class")}:</strong> {vm.detailsInfo.class || "—"}</div>
        <div class="bio-details__row"><strong>{t("FUSION.Sheet.Bio.KeyAbility")}:</strong> {vm.detailsInfo.keyAbility || "—"}</div>
      </div>
      <p class="bio-text">{vm.biography}</p>
    </section>
  {/if}

  </div>
</div>

{#if inventoryPickerPack}
  <CompendiumPickerDialog
    packSlug={inventoryPickerPack}
    title={t("FUSION.Sheet.Inventory.PickerTitle")}
    showTraitFilter={true}
    onClose={() => { inventoryPickerPack = null; }}
    onSelect={handleInventoryPick}
  />
{/if}

{#if showPortraitPicker}
  <FilePicker
    token={fusionApi.getToken() ?? ""}
    onSelect={handlePortraitSelect}
    onClose={() => { showPortraitPicker = false; }}
  />
{/if}

<style>
  /* ---- Shell: Plan column + sheet body side by side (DEC-R10-05) ---- */
  .pf2e-sheet-shell {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .show-plan-btn {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-secondary, #b0b0cc);
    cursor: pointer;
    flex-shrink: 0;
  }

  .show-plan-btn:hover,
  .show-plan-btn:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  /* ---- Container query: adapt to the window width ---- */
  .pf2e-character-sheet {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 13px;
  }

  /* ---- Header ---- */
  .sheet-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--fusion-color-surface-raised, #16213e);
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  /* Portrait (r19-W4) — circular, with an owner/GM edit affordance. */
  .sheet-portrait-wrap {
    position: relative;
    flex-shrink: 0;
    width: 56px;
    height: 56px;
  }

  .sheet-portrait-edit {
    position: relative;
    display: block;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    line-height: 0;
  }

  .sheet-portrait-edit__overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 16px;
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }

  .sheet-portrait-edit:hover .sheet-portrait-edit__overlay,
  .sheet-portrait-edit:focus-visible .sheet-portrait-edit__overlay {
    opacity: 1;
  }

  .sheet-portrait-edit:focus-visible {
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
    outline-offset: 2px;
  }

  .sheet-portrait-remove {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-secondary, #b0b0cc);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
  }

  .sheet-portrait-wrap:hover .sheet-portrait-remove,
  .sheet-portrait-wrap:focus-within .sheet-portrait-remove {
    opacity: 1;
  }

  .sheet-portrait-remove:hover,
  .sheet-portrait-remove:focus-visible {
    color: #ff8080;
    border-color: #ff8080;
    outline: none;
  }

  .sheet-header__info {
    flex: 1;
    min-width: 120px;
  }

  .sheet-header__name {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--fusion-color-text-primary, #e0e0ff);
  }

  .sheet-header__subtitle {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    margin-top: 2px;
  }

  /* HP */
  .sheet-hp {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .sheet-hp__label {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sheet-hp__row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sheet-hp__value {
    width: 44px;
    text-align: center;
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 16px;
    font-weight: 700;
    padding: 2px 4px;
  }

  .sheet-hp__value--readonly {
    background: transparent;
    border-color: transparent;
  }

  .sheet-hp__sep {
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .sheet-hp__max,
  .sheet-hp__temp {
    font-size: 14px;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .sheet-hp__temp {
    color: var(--fusion-color-info, #66aaff);
    font-size: 12px;
  }

  .sheet-save-status {
    font-size: 10px;
  }
  .sheet-save-status--saving { color: var(--fusion-color-warning, #ffcc00); }
  .sheet-save-status--saved { color: var(--fusion-color-success, #44cc88); }

  /* Defenses */
  .sheet-defenses {
    display: flex;
    gap: 8px;
  }

  .defense-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 48px;
    padding: 4px 8px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    cursor: default;
  }

  .defense-block--rollable {
    cursor: pointer;
    transition: background 0.15s;
  }

  .defense-block--rollable:hover,
  .defense-block--rollable:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .defense-block__value {
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
  }

  .defense-block__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    margin-top: 2px;
  }

  /* Status badges */
  .sheet-status-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
  }

  .status-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .status-badge--dying { background: rgba(200, 40, 40, 0.35); color: #ff8080; }
  .status-badge--wounded { background: rgba(200, 120, 40, 0.35); color: #ffcc88; }
  .status-badge--doomed { background: rgba(100, 40, 140, 0.35); color: #cc88ff; }

  /* Resources */
  .sheet-resources {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .resource-pip-group {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .resource-pip {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: transparent;
    transition: background 0.15s;
  }

  .resource-pip--filled {
    background: var(--fusion-color-accent, #5b8dee);
  }

  .resource-pip--focus {
    border-color: var(--fusion-color-magic, #aa66ff);
  }

  .resource-pip--focus.resource-pip--filled {
    background: var(--fusion-color-magic, #aa66ff);
  }

  /* Hero pips: amber/gold — visually distinct from focus (purple) and from
     any red death/dying UI, so a filled hero pip never reads as damage or a
     death save (feedback item 8). */
  .resource-pip--hero {
    border-color: var(--fusion-color-hero, #e0a92e);
  }

  .resource-pip--hero.resource-pip--filled {
    background: var(--fusion-color-hero, #e0a92e);
  }

  .resource-pip--locked {
    cursor: default;
    opacity: 0.4;
    background: repeating-linear-gradient(
      45deg,
      var(--fusion-surface-alt),
      var(--fusion-surface-alt) 2px,
      transparent 2px,
      transparent 4px
    );
  }

  .resource-label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    margin-left: 2px;
  }

  /* ---- Abilities ---- */
  .ability-row {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
    background: var(--fusion-color-surface, #1a1a2e);
  }

  .ability-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 2px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .ability-block__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  .ability-block__score {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.1;
  }

  .ability-block__mod {
    font-size: 11px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  /* ---- Saves ---- */
  .saves-row {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .save-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 4px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    cursor: pointer;
    transition: background 0.15s;
  }

  /* Class DC blocks sit in the same row but are read-only — no pointer, no
     hover affordance, and a left rule so the eye separates "my saves" from
     "my classes" without a second row. */
  .save-block--class {
    cursor: default;
    border-left: 3px solid var(--fusion-color-accent, #5b8dee);
  }

  .save-block--class:hover {
    background: var(--fusion-color-surface-raised, #16213e);
    outline: none;
  }

  .save-block:hover,
  .save-block:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .save-block__mod {
    font-size: 14px;
    font-weight: 700;
  }

  .save-block__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  .save-block__rank {
    font-size: 9px;
    color: var(--fusion-color-accent, #5b8dee);
  }

  /* ---- Conditions bar ---- */
  .conditions-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .condition-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 10px;
    background: rgba(255, 120, 60, 0.25);
    border: 1px solid rgba(255, 120, 60, 0.5);
    color: #ffaa88;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .condition-chip:hover,
  .condition-chip:focus-visible {
    background: rgba(255, 120, 60, 0.4);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .condition-chip__remove {
    font-size: 9px;
    opacity: 0.7;
  }

  /* ---- Condition add picker (SCAFFOLDING, T034) ---- */
  .condition-add-select {
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 10px;
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-secondary, #b0b0cc);
    border: 1px dashed var(--fusion-color-border, #3a3a5c);
    cursor: pointer;
  }

  /* ---- Tab bar ---- */
  .tab-bar {
    display: flex;
    border-bottom: 2px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
    background: var(--fusion-color-surface-raised, #16213e);
    overflow-x: auto;
  }

  .tab-btn {
    padding: 7px 14px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    color: var(--fusion-color-text-muted, #9999cc);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tab-btn:hover,
  .tab-btn:focus-visible {
    color: var(--fusion-color-text-primary, #e0e0ff);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
    outline-offset: -2px;
  }

  .tab-btn--active {
    color: var(--fusion-color-text-primary, #e0e0ff);
    border-bottom-color: var(--fusion-color-accent, #5b8dee);
  }

  /* ---- Tab panels ---- */
  .tab-panel {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .section-header {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fusion-color-text-muted, #9999cc);
    margin: 0 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  /* Stat row (main tab) */
  .stat-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .stat-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 14px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .stat-block__value {
    font-size: 16px;
    font-weight: 700;
  }

  .stat-block__label {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  /* Skills */
  .skill-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .skill-row {
    display: grid;
    grid-template-columns: 20px 1fr 40px 44px;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .skill-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .skill-row--untrained {
    opacity: 0.82;
  }

  .skill-row__rollable {
    background: transparent;
    border: none;
    text-align: left;
    color: var(--fusion-color-text-primary, #e0e0ff);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }

  .skill-row__rollable:hover,
  .skill-row__rollable:focus-visible {
    color: var(--fusion-color-accent, #5b8dee);
    text-decoration: underline;
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  /* EN subtitle beside the pt-BR skill name (r14 #7). */
  .skill-row__name-en {
    margin-left: 6px;
    font-size: 10px;
    font-weight: 400;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .skill-row__ability {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-align: center;
  }

  .skill-row__total {
    font-size: 12px;
    font-weight: 600;
    text-align: right;
  }

  /* Strikes */
  .strike-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .strike-row {
    padding: 8px 10px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .strike-row__header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .strike-row__name {
    font-size: 13px;
    font-weight: 600;
  }

  .strike-row__variants {
    display: flex;
    gap: 6px;
  }

  .map-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 10px;
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    transition: background 0.15s;
    min-width: 54px;
  }

  .map-btn:hover,
  .map-btn:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .map-btn__total {
    font-size: 14px;
    font-weight: 700;
    color: var(--fusion-color-text-primary, #e0e0ff);
  }

  .map-btn__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  .strike-row__damage {
    font-size: 12px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  .damage-formula {
    font-family: var(--fusion-font-mono, monospace);
    color: var(--fusion-color-text-primary, #e0e0ff);
  }

  .damage-type {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    margin-left: 2px;
  }

  .strike-row__traits {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .trait-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(91, 141, 238, 0.15);
    border: 1px solid rgba(91, 141, 238, 0.3);
    color: #8ab0f0;
  }

  /* Inventory */
  .inventory-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .inventory-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .inventory-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .inventory-row__icon {
    width: 22px;
    height: 22px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .inventory-row__name {
    flex: 1;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inventory-row__qty {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    min-width: 24px;
    text-align: right;
  }

  .inventory-row__bulk {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    min-width: 44px;
    text-align: right;
  }

  .inventory-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }

  .inventory-add-btn {
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    background: transparent;
    color: var(--fusion-text, #ddd);
    cursor: pointer;
  }

  .inventory-add-btn:hover {
    border-color: var(--fusion-accent, #7a7aff);
    color: var(--fusion-accent, #7a7aff);
  }

  .inventory-row__equip {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--fusion-border, #444);
    background: transparent;
    color: var(--fusion-color-text-muted, #9999cc);
    cursor: pointer;
  }

  .inventory-row__equip--on {
    border-color: var(--fusion-color-success, #44cc88);
    color: var(--fusion-color-success, #44cc88);
  }

  .inventory-row__equip:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .inventory-row__remove {
    font-size: 14px;
    line-height: 1;
    padding: 0 6px;
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    background: transparent;
    color: var(--fusion-text-muted, #999);
    cursor: pointer;
  }

  .inventory-row__remove:hover {
    border-color: var(--fusion-danger, #cc4444);
    color: var(--fusion-danger, #cc4444);
  }

  /* Empty state */
  .empty-state {
    color: var(--fusion-color-text-muted, #9999cc);
    font-size: 12px;
    text-align: center;
    padding: 24px 0;
  }

  /* ---- Play/Edit toggle ---- */
  .mode-toggle {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-secondary, #b0b0cc);
    cursor: pointer;
    transition: background 0.15s;
    flex-shrink: 0;
  }

  .mode-toggle:hover,
  .mode-toggle:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .mode-toggle[aria-pressed="true"] {
    background: var(--fusion-color-accent, #5b8dee);
    color: #fff;
    border-color: var(--fusion-color-accent, #5b8dee);
  }

  /* ---- Rest button (header) ---- */
  .rest-btn {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-success, #3ddc84);
    background: var(--fusion-success-dim, rgba(61, 220, 132, 0.14));
    color: var(--fusion-success, #3ddc84);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .rest-btn:hover,
  .rest-btn:focus-visible {
    background: var(--fusion-success, #3ddc84);
    color: var(--fusion-on-accent, #fff);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  /* ---- Edit-mode fields (main tab) ---- */
  .edit-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 64px;
  }

  .edit-field label {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .edit-field input,
  .edit-field select {
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 12px;
    padding: 4px 6px;
  }

  .edit-field-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
  }

  .edit-field-row--abilities {
    gap: 6px;
  }

  .skill-row--edit {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 4px;
  }

  .skill-row--edit select {
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 11px;
    padding: 2px 4px;
  }

  /* ---- Senses row (main tab) ---- */
  .senses-row {
    margin-top: 8px;
    font-size: 12px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  .senses-row__label {
    color: var(--fusion-color-text-muted, #9999cc);
    margin-right: 4px;
  }

  /* ---- Strike damage/crit buttons ---- */
  .map-btn--damage,
  .map-btn--crit {
    min-width: 44px;
  }

  .map-btn--crit .map-btn__label {
    color: var(--fusion-color-warning, #ffcc00);
  }

  /* ---- Bio tab ---- */
  .bio-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    font-size: 12px;
  }

  .bio-details__row strong {
    color: var(--fusion-color-text-muted, #9999cc);
    margin-right: 4px;
  }

  .bio-text {
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  /* ---- Container query: narrow layout (<400px) ---- */
  @container (max-width: 400px) {
    .ability-row {
      gap: 2px;
    }

    .ability-block {
      padding: 3px 1px;
    }

    .tab-btn {
      padding: 6px 8px;
      font-size: 11px;
    }

    .skill-row {
      grid-template-columns: 18px 1fr 32px 38px;
    }
  }
</style>
