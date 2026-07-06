<script lang="ts">
  /**
   * PlanColumn.svelte — the level-by-level character builder column
   * ("Plano", DEC-R10-05/DEC-R10-08, R10-D item D2).
   *
   * Ports the design contract's PlanColumn.jsx
   * (.fusion-build/r10-design/claude-design/ui_kits/ficha-pf2e/PlanColumn.jsx)
   * to Svelte 5: a 300px column with ABC cards (Ancestry/Heritage/Background/
   * Class) at the top, one LevelCard per level 1..current, and a
   * "Subir de nível → N+1" button at the bottom. Collapsible — the parent
   * (CharacterSheet.svelte) owns the collapsed/expanded state and renders
   * "Mostrar plano" in the sheet header when collapsed (contract: "Ocultar
   * plano" lives in THIS column's title bar; "Mostrar plano" lives in the
   * sheet header — see CharacterSheet.svelte).
   *
   * Navigable always (not gated by editMode) — only the WRITE actions
   * (clicking an empty slot, removing a filled slot, applying ABC picks,
   * level-up) require `editable`. Read-only visitors still see the whole
   * plan.
   *
   * All ops flow through planVM.ts's pure op builders; this component's only
   * job is deriving the PlanModel, wiring dialogs, and forwarding ops to
   * `sendOpFn` (same lazy-socket contract as CharacterSheet/SpellsTab — no
   * socket prop here either, planVM's op builders never touch the socket
   * directly; only the picker dialogs do, via getSocket()).
   */

  import {
    derivePlan,
    planContext,
    isFeatEligible,
    isHybridStudyOption,
    matchesGrantedFeatFilter,
    abilityBoostsSlotContext,
    applyClass,
    applyAncestry,
    applyHeritage,
    applyBackground,
    chooseFeat,
    chooseHybridStudy,
    setAbilityBoosts,
    markAbilityBoostsChoice,
    setFreeArchetype,
    removeChoice,
    levelUp,
    skillTrainingDialogContext,
    confirmSkillTraining,
    addLoreSkill,
    detailsRequestForSlot,
    detailsRequestForAutoFeature,
    buildContentNameTranslator,
    abilityBoostsGrid,
    SLOT_TYPE_LABELS_EN,
    type PlanSlotModel,
    type PlanSlotType,
    type PlanOpBuilderContext,
    type FeatDocLike,
    type SkillTrainingDialogKind,
    type PlanDetailsRequest,
    type AutoFeatureModel,
    type ContentNameTranslator,
    type PlanNameIndexEntry,
  } from "../../../../lib/sheets/pf2e/planVM.js";
  import type { DocOpPayload } from "../../../../lib/sheets/pf2e/characterSheetVM.js";
  import ABCCard from "./ABCCard.svelte";
  import LevelCard from "./LevelCard.svelte";
  import type { SlotDisplay, AutoFeatureDisplay } from "./LevelCard.svelte";
  import CompendiumPickerDialog from "./CompendiumPickerDialog.svelte";
  import PlanDetailsDialog from "./PlanDetailsDialog.svelte";
  import AbilityBoostsDialog from "./AbilityBoostsDialog.svelte";
  import SkillTrainingDialog from "./SkillTrainingDialog.svelte";
  import { t, i18n } from "../../../../lib/i18n/i18n.js";
  import { session, getSocket } from "../../../../lib/session.svelte.js";
  import {
    listPacks,
    searchPack,
    requireConnectedSocket,
  } from "../../../../lib/compendium/compendiumApi.js";

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    editable: boolean;
    sendOpFn: (op: DocOpPayload) => void;
    onHide: () => void;
  }

  let { doc, actorId, editable, sendOpFn, onHide }: Props = $props();

  const plan = $derived(derivePlan(doc));
  const ctx = $derived(planContext(doc));
  const opCtx = $derived<PlanOpBuilderContext>({ actorId, doc, editable });

  function sendAll(ops: DocOpPayload | DocOpPayload[] | null): void {
    if (!ops) return;
    for (const op of Array.isArray(ops) ? ops : [ops]) sendOpFn(op);
  }

  // ---------------------------------------------------------------------------
  // Content-name translation (B1 r14) — resolve every embedded pack item's
  // display name to pt-BR (main) + EN (subtitle), joining by normalized name
  // against the packs' compendium indexes (feats/class-features/ABC/spells).
  // Loaded once on demand via the LIVE socket (same lazy contract as SpellsTab/
  // ActionsTab); null until loaded → names render as stored (EN fallback).
  // ---------------------------------------------------------------------------

  const CONTENT_NAME_PACK_SLUGS = [
    "feats-core",
    "class-features-core",
    "ancestries-core",
    "heritages-core",
    "backgrounds-core",
    "spells-core",
  ];

  let contentTranslator = $state<ContentNameTranslator | null>(null);
  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  $effect(() => {
    void systemId;
    void loadContentTranslator();
  });

  async function loadContentTranslator(): Promise<void> {
    try {
      const sock = requireConnectedSocket(getSocket());
      const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
      const entriesByPack: PlanNameIndexEntry[][] = [];
      for (const slug of CONTENT_NAME_PACK_SLUGS) {
        const pack = packs.find((p) => p.id.endsWith(`.${slug}`));
        if (!pack) continue;
        const { entries } = await searchPack(sock, { packId: pack.id });
        entriesByPack.push(entries as PlanNameIndexEntry[]);
      }
      contentTranslator = buildContentNameTranslator(entriesByPack);
    } catch {
      // Offline / no socket / no pack: leave the translator null → names render
      // as stored (EN). Never blocks the column.
    }
  }

  /**
   * Resolve a stored (embedded) content name to its bilingual display parts,
   * honoring the active locale. On the "en" locale (or before the translator
   * loads) the EN name is shown alone (no redundant subtitle). On pt-BR the
   * translator yields `{ namePt, nameEn }` and BOTH are shown — even when
   * identical (r14 user rule).
   */
  function contentNameParts(stored: string): { name: string; subName?: string } {
    if (i18n.locale !== "pt-BR" || !contentTranslator) return { name: stored };
    const parts = contentTranslator(stored);
    return { name: parts.namePt, subName: parts.nameEn };
  }

  /** The pt-BR slot-type label (via i18n) + its EN counterpart as the always-shown subtitle (r14). */
  function slotTypeParts(slot: PlanSlotModel): { type: string; subType?: string } {
    const key = slot.grantFilter?.labelKey ?? `FUSION.Sheet.Plan.SlotLabel.${slot.type}`;
    const pt = t(key);
    // EN subtitle: for a normal slot type use SLOT_TYPE_LABELS_EN; a grantedFeat
    // sub-slot has no single EN type word, so fall back to its model label.
    const en = SLOT_TYPE_LABELS_EN[slot.type] ?? slot.label;
    if (i18n.locale !== "pt-BR" || !pt || pt === en) return { type: pt || en };
    return { type: pt, subType: en };
  }

  // pt-BR short ability labels for the abilityBoosts grid (r14 #6). Kept inline
  // (Plan-territory content, like the boost dialog's other pt-BR literals).
  const ABILITY_SHORT_LABELS_PT: Record<string, string> = {
    str: "FOR",
    dex: "DES",
    con: "CON",
    int: "INT",
    wis: "SAB",
    cha: "CAR",
  };

  /** Parse the level a slot id encodes (`<type>-<level>[-...]`), defaulting to the char level. */
  function levelOfSlot(slot: PlanSlotModel): number {
    const m = /-(\d+)/.exec(slot.slotId);
    return m ? Number(m[1]) : ctx.level;
  }

  /** Bilingual name + type parts for a FILLED slot (passed to LevelCard → PlanSlot). */
  function slotDisplay(slot: PlanSlotModel): SlotDisplay {
    const typeParts = slotTypeParts(slot);
    // Ability boosts render a 3×2 net-per-ability grid instead of a raw name
    // string (r14 #6) — the pick list "con, dex, int, …" is replaced by the
    // resulting modifiers (FOR/DES/CON/INT/SAB/CAR).
    if (slot.type === "abilityBoosts") {
      return {
        name: slot.choiceName ?? slot.label,
        type: typeParts.type,
        ...(typeParts.subType !== undefined ? { subType: typeParts.subType } : {}),
        grid: abilityBoostsGrid(doc, levelOfSlot(slot)),
        gridLabels: ABILITY_SHORT_LABELS_PT,
      };
    }
    const nameParts = contentNameParts(slot.choiceName ?? slot.label);
    return {
      name: nameParts.name,
      ...(nameParts.subName !== undefined ? { subName: nameParts.subName } : {}),
      type: typeParts.type,
      ...(typeParts.subType !== undefined ? { subType: typeParts.subType } : {}),
    };
  }

  /** Bilingual parts for a locked auto-feature chip. */
  function autoFeatureDisplay(feature: AutoFeatureModel): AutoFeatureDisplay {
    const parts = contentNameParts(feature.name);
    return {
      name: parts.name,
      ...(parts.subName !== undefined ? { subName: parts.subName } : {}),
    };
  }

  /** Bilingual name parts for an ABC card (ancestry/heritage/background/class). */
  function abcNameParts(name: string | undefined): { name: string | undefined; subName?: string } {
    if (name === undefined) return { name: undefined };
    return contentNameParts(name);
  }

  // ---------------------------------------------------------------------------
  // ABC cards — Ancestry / Heritage / Background / Class pickers
  // ---------------------------------------------------------------------------

  type AbcPickerKind = "ancestry" | "heritage" | "background" | "class" | null;
  let abcPicker = $state<AbcPickerKind>(null);

  function abcTypeLabel(kind: "ancestry" | "heritage" | "background" | "class"): string {
    switch (kind) {
      case "ancestry":
        return t("FUSION.Sheet.Plan.Abc.Ancestry");
      case "heritage":
        return t("FUSION.Sheet.Plan.Abc.Heritage");
      case "background":
        return t("FUSION.Sheet.Plan.Abc.Background");
      case "class":
        return t("FUSION.Sheet.Plan.Abc.Class");
    }
  }

  function abcPackSlug(kind: "ancestry" | "heritage" | "background" | "class"): string {
    switch (kind) {
      case "ancestry":
        return "ancestries-core";
      case "heritage":
        return "heritages-core";
      case "background":
        return "backgrounds-core";
      case "class":
        return "classes-core";
    }
  }

  function openAbcPicker(kind: "ancestry" | "heritage" | "background" | "class"): void {
    if (!editable) return;
    abcPicker = kind;
  }

  function handleAbcSelect(doc2: Record<string, unknown>): void {
    if (!abcPicker) return;
    switch (abcPicker) {
      case "ancestry":
        sendAll(applyAncestry(opCtx, doc2));
        break;
      case "heritage":
        sendAll(applyHeritage(opCtx, doc2));
        break;
      case "background":
        sendAll(applyBackground(opCtx, doc2));
        break;
      case "class":
        // The key-ability CHOICE is made in the "Dádivas de Atributo"
        // dialog's class group (build.abilities.classBoost) — the embedded
        // class item keeps the full keyAbility option list (r11 fix).
        sendAll(applyClass(opCtx, doc2));
        break;
    }
    abcPicker = null;
  }

  // ---------------------------------------------------------------------------
  // Level slot interactions
  // ---------------------------------------------------------------------------

  type SlotPicker = { level: number; slot: PlanSlotModel } | null;
  let slotPicker = $state<SlotPicker>(null);
  let boostsDialogTarget = $state<{ level: number; slot: PlanSlotModel } | null>(null);

  function slotLabel(slot: PlanSlotModel): string {
    // A grantedFeat sub-slot (W1-D) uses its grant's OWN i18n key (e.g.
    // "...grantedFeat.basicConcoction") instead of the generic
    // "...grantedFeat" fallback — every grant in GRANTED_FEAT_CHOICES names a
    // specific i18n key precisely so each nested pick's label describes what
    // it actually grants ("Talento de Alquimista (Nível 1-2)"), not a vague
    // "Talento Concedido".
    const key = slot.grantFilter?.labelKey ?? `FUSION.Sheet.Plan.SlotLabel.${slot.type}`;
    const base = t(key);
    // Collapsed skillTraining/skillIncrease group slot (R11 item 3): show the
    // "(x/N)" progress even while it's still the EMPTY-slot affordance (a
    // partially-filled group — e.g. 2/4 — isn't `filled` yet, so it renders
    // via PlanEmptySlot, but the player still needs the count to know how
    // many picks remain before opening the dialog).
    if (slot.totalCount !== undefined) {
      return `${base} (${String(slot.filledCount ?? 0)}/${String(slot.totalCount)})`;
    }
    return base;
  }

  function handleSlotClick(level: number, slot: PlanSlotModel): void {
    if (!editable) return;
    if (slot.type === "abilityBoosts") {
      boostsDialogTarget = { level, slot };
      return;
    }
    if (slot.type === "skillTraining" || slot.type === "skillIncrease") {
      skillDialogLevel = level;
      skillDialogKind = slot.type;
      return;
    }
    slotPicker = { level, slot };
  }

  function handleSlotRemove(_level: number, slot: PlanSlotModel): void {
    if (!editable) return;
    sendAll(removeChoice(opCtx, slot));
  }

  // ---------------------------------------------------------------------------
  // Inline details dialog (R12 — explain locked auto-feature chips and filled
  // feat/hybrid-study slots). Read-only: no editable gate, since even
  // visitors benefit from reading what a granted feature does.
  // ---------------------------------------------------------------------------

  let detailsRequest = $state<PlanDetailsRequest | null>(null);

  function handleSlotDetails(slot: PlanSlotModel): void {
    const req = detailsRequestForSlot(slot);
    if (req) detailsRequest = req;
  }

  function handleAutoFeatureClick(feature: AutoFeatureModel): void {
    detailsRequest = detailsRequestForAutoFeature(feature);
  }

  /** Reconstruct just enough of the FeatDocLike shape from a PackIndexEntry's flat dot-path index to run a feat predicate against it. */
  function featDocFromIndex(e: { index: Record<string, unknown> }): FeatDocLike {
    const category = e.index["system.category"];
    const level2 = e.index["system.level"];
    const traits = e.index["system.traits.value"];
    return {
      system: {
        ...(typeof category === "string" ? { category } : {}),
        ...(typeof level2 === "number" ? { level: level2 } : {}),
        traits: { value: Array.isArray(traits) ? traits.filter((v): v is string => typeof v === "string") : [] },
      },
    };
  }

  function pickerConfigFor(slot: PlanSlotModel): { packSlug: string; title: string; filterFn?: (e: { name: string; index: Record<string, unknown> }) => boolean } {
    const level = slotPicker?.level ?? ctx.level;
    if (slot.type === "hybridStudy") {
      return {
        packSlug: "class-features-core",
        title: t("FUSION.Sheet.Plan.Picker.HybridStudyTitle"),
        filterFn: (e) => isHybridStudyOption({ system: { traits: { otherTags: e.index["system.traits.otherTags"] } } }),
      };
    }
    if (slot.type === "grantedFeat" && slot.grantFilter) {
      const grant = slot.grantFilter;
      return {
        packSlug: "feats-core",
        title: t(grant.labelKey),
        // A granted-feat sub-slot's eligibility comes from the grant's OWN
        // declarative predicates (category/trait/level<=N) — NOT from
        // isFeatEligible's slot-type/class/ancestry rules, which only make
        // sense for the character's own class/ancestry feat slots (W1-D:
        // Basic Concoction's grant is an alchemist feat regardless of the
        // character's actual class).
        filterFn: (e) => matchesGrantedFeatFilter(featDocFromIndex(e), grant),
      };
    }
    return {
      packSlug: "feats-core",
      title: t(`FUSION.Sheet.Plan.SlotLabel.${slot.type}`),
      filterFn: (e) => {
        const featDoc = featDocFromIndex(e);
        return isFeatEligible(featDoc, slot.type, level, {
          ...(ctx.classSlug ? { classSlug: ctx.classSlug } : {}),
          ...(ctx.ancestrySlug ? { ancestrySlug: ctx.ancestrySlug } : {}),
        });
      },
    };
  }

  function handleSlotPickerSelect(selectedDoc: Record<string, unknown>): void {
    if (!slotPicker) return;
    const { level, slot } = slotPicker;
    if (slot.type === "hybridStudy") {
      sendAll(chooseHybridStudy(opCtx, level, selectedDoc));
    } else {
      sendAll(chooseFeat(opCtx, slot, level, selectedDoc));
    }
    slotPicker = null;
  }

  // ---------------------------------------------------------------------------
  // Ability boosts dialog
  // ---------------------------------------------------------------------------

  function abilityBoostsDialogTitle(level: number): string {
    return level === 1
      ? t("FUSION.Sheet.Plan.AbilityBoosts.TitleLevel1")
      : t("FUSION.Sheet.Plan.AbilityBoosts.TitleMilestone", { level: String(level) });
  }

  function handleAbilityBoostsConfirm(level: number, slot: PlanSlotModel, freeSlugsByGroup: string[][]): void {
    const boostCtx = abilityBoostsSlotContext(doc, level);
    for (let i = 0; i < boostCtx.groups.length; i++) {
      const group = boostCtx.groups[i];
      if (!group || group.freeCount === 0) continue;
      const slugs = freeSlugsByGroup[i] ?? [];
      const op = setAbilityBoosts(opCtx, group.origin, slugs, group.origin === "levelled" ? level : undefined);
      if (op) sendOpFn(op);
    }
    const marker = markAbilityBoostsChoice(opCtx, slot.slotId, level);
    if (marker) sendOpFn(marker);
    boostsDialogTarget = null;
  }

  // ---------------------------------------------------------------------------
  // Skill training / increase dialog (R11 item 1 — Pathbuilder-style mass
  // picker). One dialog instance covers EVERY skillTraining-<level>-*/
  // skillIncrease-<level> slot of a level at once (the Plan card already
  // collapses them into a single "Treinamento de Perícias (x/N)" entry via
  // derivePlan's collapseSkillSlotGroups) — see planVM.ts's
  // `skillTrainingDialogContext`/`confirmSkillTraining`.
  // ---------------------------------------------------------------------------

  let skillDialogLevel = $state<number | null>(null);
  let skillDialogKind = $state<SkillTrainingDialogKind | null>(null);

  const skillDialogCtx = $derived(
    skillDialogLevel !== null && skillDialogKind !== null
      ? skillTrainingDialogContext(doc, skillDialogLevel, skillDialogKind)
      : null,
  );

  function skillDialogTitle(kind: SkillTrainingDialogKind): string {
    return kind === "skillIncrease"
      ? t("FUSION.Sheet.Plan.SlotLabel.skillIncrease")
      : t("FUSION.Sheet.Plan.SlotLabel.skillTraining");
  }

  function closeSkillDialog(): void {
    skillDialogLevel = null;
    skillDialogKind = null;
  }

  function handleSkillDialogConfirm(picks: string[]): void {
    if (!skillDialogCtx) return;
    const op = confirmSkillTraining(opCtx, skillDialogCtx, picks);
    if (op) sendOpFn(op);
  }

  function handleAddLore(name: string): void {
    const op = addLoreSkill(opCtx, name);
    if (op) sendOpFn(op);
  }

  // ---------------------------------------------------------------------------
  // Free Archetype toggle + level up
  // ---------------------------------------------------------------------------

  function toggleFreeArchetype(): void {
    const isOn = doc["system"] && typeof doc["system"] === "object"
      ? Boolean(((doc["system"] as Record<string, unknown>)["build"] as Record<string, unknown> | undefined)?.["freeArchetype"])
      : false;
    const op = setFreeArchetype(opCtx, !isOn);
    if (op) sendOpFn(op);
  }

  function handleLevelUp(): void {
    sendAll(levelUp(opCtx));
  }

  const freeArchetypeOn = $derived(
    Boolean(
      doc["system"] && typeof doc["system"] === "object"
        ? ((doc["system"] as Record<string, unknown>)["build"] as Record<string, unknown> | undefined)?.["freeArchetype"]
        : false,
    ),
  );
</script>

<div class="plan-column">
  <div class="plan-column__titlebar">
    <h2 class="plan-column__title">{t("FUSION.Sheet.Plan.Title")}</h2>
    <button type="button" class="plan-column__hide" onclick={onHide}>
      {t("FUSION.Sheet.Plan.Hide")}
    </button>
  </div>

  <div class="plan-column__abc">
    <ABCCard
      typeLabel={abcTypeLabel("ancestry")}
      name={abcNameParts(plan.abc[0]?.name).name}
      subName={abcNameParts(plan.abc[0]?.name).subName}
      subLine={plan.abc[0]?.subLine}
      filled={plan.abc[0]?.filled ?? false}
      {editable}
      onClick={() => openAbcPicker("ancestry")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("heritage")}
      name={abcNameParts(plan.abc[1]?.name).name}
      subName={abcNameParts(plan.abc[1]?.name).subName}
      subLine={plan.abc[1]?.subLine}
      filled={plan.abc[1]?.filled ?? false}
      {editable}
      onClick={() => openAbcPicker("heritage")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("background")}
      name={abcNameParts(plan.abc[2]?.name).name}
      subName={abcNameParts(plan.abc[2]?.name).subName}
      subLine={plan.abc[2]?.subLine}
      filled={plan.abc[2]?.filled ?? false}
      {editable}
      onClick={() => openAbcPicker("background")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("class")}
      name={abcNameParts(plan.abc[3]?.name).name}
      subName={abcNameParts(plan.abc[3]?.name).subName}
      subLine={plan.abc[3]?.subLine}
      filled={plan.abc[3]?.filled ?? false}
      {editable}
      onClick={() => openAbcPicker("class")}
    />
  </div>

  {#if editable}
    <label class="plan-column__toggle">
      <input type="checkbox" checked={freeArchetypeOn} onchange={toggleFreeArchetype} />
      {t("FUSION.Sheet.Plan.FreeArchetypeToggle")}
    </label>
  {/if}

  {#if plan.needsClass}
    <div class="plan-column__cta">
      <p>{t("FUSION.Sheet.Plan.NeedsClassHint")}</p>
      {#if editable}
        <button type="button" class="plan-column__cta-btn" onclick={() => openAbcPicker("class")}>
          {t("FUSION.Sheet.Plan.ChooseClass")}
        </button>
      {/if}
    </div>
  {:else}
    <div class="plan-column__levels">
      {#each plan.levels as levelPlan (levelPlan.level)}
        <LevelCard
          {levelPlan}
          {editable}
          {slotLabel}
          {slotDisplay}
          {autoFeatureDisplay}
          onSlotClick={(slot) => handleSlotClick(levelPlan.level, slot)}
          onSlotRemove={(slot) => handleSlotRemove(levelPlan.level, slot)}
          onSlotDetails={handleSlotDetails}
          onAutoFeatureClick={handleAutoFeatureClick}
        />
      {/each}
    </div>

    {#if editable}
      <div class="plan-column__footer">
        <button type="button" class="plan-column__levelup" onclick={handleLevelUp} disabled={ctx.level >= 20}>
          {t("FUSION.Sheet.Plan.LevelUp", { next: String(ctx.level + 1) })}
        </button>
      </div>
    {/if}
  {/if}
</div>

{#if abcPicker}
  <CompendiumPickerDialog
    packSlug={abcPackSlug(abcPicker)}
    title={t("FUSION.Sheet.Plan.Picker.AbcTitle", { type: abcTypeLabel(abcPicker) })}
    showTraitFilter={abcPicker === "heritage"}
    filterFn={
      abcPicker === "heritage" && ctx.ancestrySlug
        ? (e) => {
            const slug = e.index["system.ancestry.slug"];
            return typeof slug === "string" && slug === ctx.ancestrySlug;
          }
        : undefined
    }
    onClose={() => { abcPicker = null; }}
    onSelect={handleAbcSelect}
  />
{/if}

{#if slotPicker}
  {@const cfg = pickerConfigFor(slotPicker.slot)}
  <CompendiumPickerDialog
    packSlug={cfg.packSlug}
    title={cfg.title}
    showTraitFilter={true}
    filterFn={cfg.filterFn}
    onClose={() => { slotPicker = null; }}
    onSelect={handleSlotPickerSelect}
  />
{/if}

{#if detailsRequest}
  <PlanDetailsDialog request={detailsRequest} onClose={() => { detailsRequest = null; }} />
{/if}

{#if boostsDialogTarget}
  {@const boostCtx = abilityBoostsSlotContext(doc, boostsDialogTarget.level)}
  <AbilityBoostsDialog
    title={abilityBoostsDialogTitle(boostsDialogTarget.level)}
    fixedSlugs={boostCtx.fixedSlugs}
    groups={boostCtx.groups}
    level={boostsDialogTarget.level}
    {doc}
    onClose={() => { boostsDialogTarget = null; }}
    onConfirm={(freeSlugsByGroup) => {
      if (boostsDialogTarget) handleAbilityBoostsConfirm(boostsDialogTarget.level, boostsDialogTarget.slot, freeSlugsByGroup);
    }}
  />
{/if}

{#if skillDialogCtx && skillDialogKind}
  <SkillTrainingDialog
    title={skillDialogTitle(skillDialogKind)}
    dialogCtx={skillDialogCtx}
    onClose={closeSkillDialog}
    onConfirm={handleSkillDialogConfirm}
    onAddLore={handleAddLore}
  />
{/if}

<style>
  .plan-column {
    width: 300px;
    flex-shrink: 0;
    border-right: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 12px;
    gap: 8px;
  }

  .plan-column__titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .plan-column__title {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .plan-column__hide {
    font-family: var(--fusion-font);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
  }

  .plan-column__hide:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .plan-column__abc {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .plan-column__toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--fusion-text-muted);
    padding: 2px 2px;
    cursor: pointer;
  }

  .plan-column__cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px 12px;
    text-align: center;
    color: var(--fusion-text-muted);
    font-size: 12.5px;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius);
  }

  .plan-column__cta-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    font-size: 12.5px;
    padding: 7px 14px;
    border-radius: var(--fusion-radius);
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: none;
    cursor: pointer;
  }

  .plan-column__cta-btn:hover {
    background: var(--fusion-accent-hover);
  }

  .plan-column__levels {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .plan-column__footer {
    margin-top: auto;
    padding-top: 8px;
  }

  .plan-column__levelup {
    width: 100%;
    font-family: var(--fusion-font);
    font-weight: 700;
    font-size: 13px;
    padding: 10px 14px;
    border-radius: var(--fusion-radius);
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: none;
    cursor: pointer;
    transition: background 0.12s;
  }

  .plan-column__levelup:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  .plan-column__levelup:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
