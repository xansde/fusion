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
    featElegivel,
    isHybridStudyOption,
    abilityBoostsSlotContext,
    applyClass,
    applyAncestry,
    applyHeritage,
    applyBackground,
    chooseFeat,
    chooseHybridStudy,
    chooseSkillTraining,
    chooseSkillIncrease,
    setAbilityBoosts,
    markAbilityBoostsChoice,
    setFreeArchetype,
    removeChoice,
    levelUp,
    type PlanSlotModel,
    type PlanSlotType,
    type PlanOpBuilderContext,
    type FeatDocLike,
  } from "../../../../lib/sheets/pf2e/planVM.js";
  import type { DocOpPayload } from "../../../../lib/sheets/pf2e/characterSheetVM.js";
  import ABCCard from "./ABCCard.svelte";
  import LevelCard from "./LevelCard.svelte";
  import CompendiumPickerDialog from "./CompendiumPickerDialog.svelte";
  import AbilityBoostsDialog from "./AbilityBoostsDialog.svelte";
  import { t } from "../../../../lib/i18n/i18n.js";

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
        // Key ability: default to the class's first listed keyAbility choice
        // (e.g. Magus: dex or str) — a full "choose key ability" sub-step is
        // future work; picking the first keeps applyClass always callable.
        {
          const sys = doc2["system"];
          const keyAbilityList =
            typeof sys === "object" && sys !== null && Array.isArray((sys as Record<string, unknown>)["keyAbility"])
              ? ((sys as Record<string, unknown>)["keyAbility"] as unknown[]).filter(
                  (v): v is string => typeof v === "string",
                )
              : [];
          sendAll(applyClass(opCtx, doc2, keyAbilityList[0] ?? "str"));
        }
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
    const key = `FUSION.Sheet.Plan.SlotLabel.${slot.type}`;
    return t(key);
  }

  function handleSlotClick(level: number, slot: PlanSlotModel): void {
    if (!editable) return;
    if (slot.type === "abilityBoosts") {
      boostsDialogTarget = { level, slot };
      return;
    }
    if (slot.type === "skillTraining" || slot.type === "skillIncrease") {
      skillDialogTarget = { level, slot };
      return;
    }
    slotPicker = { level, slot };
  }

  function handleSlotRemove(_level: number, slot: PlanSlotModel): void {
    if (!editable) return;
    sendAll(removeChoice(opCtx, slot));
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
    return {
      packSlug: "feats-core",
      title: t(`FUSION.Sheet.Plan.SlotLabel.${slot.type}`),
      filterFn: (e) => {
        // PackIndexEntry stores index fields as a flat dot-path map
        // (e.index["system.category"], ...) — featElegivel expects the
        // nested FeatDocLike shape (system.category/level/traits.value), so
        // reconstruct just enough of that shape from the index here (same
        // pattern the hybridStudy branch above uses for otherTags).
        const category = e.index["system.category"];
        const level2 = e.index["system.level"];
        const traits = e.index["system.traits.value"];
        const featDoc: FeatDocLike = {
          system: {
            ...(typeof category === "string" ? { category } : {}),
            ...(typeof level2 === "number" ? { level: level2 } : {}),
            traits: { value: Array.isArray(traits) ? traits.filter((v): v is string => typeof v === "string") : [] },
          },
        };
        return featElegivel(featDoc, slot.type, level, {
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

  function handleAbilityBoostsConfirm(level: number, slot: PlanSlotModel, freeSlugs: string[]): void {
    const boostCtx = abilityBoostsSlotContext(doc, level);
    const op = setAbilityBoosts(opCtx, boostCtx.origin, freeSlugs, boostCtx.origin === "levelled" ? level : undefined);
    if (op) sendOpFn(op);
    const marker = markAbilityBoostsChoice(opCtx, slot.slotId, level);
    if (marker) sendOpFn(marker);
    boostsDialogTarget = null;
  }

  // ---------------------------------------------------------------------------
  // Skill training / increase dialog — a compact inline list, no compendium
  // needed (the 16 canonical skills + lores are a fixed, small set already
  // known client-side via characterSheetVM's SKILL_LABELS-equivalent).
  // ---------------------------------------------------------------------------

  let skillDialogTarget = $state<{ level: number; slot: PlanSlotModel } | null>(null);

  // Skill names are PF2e game terms and stay in English everywhere in the
  // sheet (see characterSheetVM.ts's SKILL_LABELS — the Skills tab does the
  // same, never routes these through t()).
  const SKILL_LABELS: Record<string, string> = {
    acrobatics: "Acrobatics",
    arcana: "Arcana",
    athletics: "Athletics",
    crafting: "Crafting",
    deception: "Deception",
    diplomacy: "Diplomacy",
    intimidation: "Intimidation",
    medicine: "Medicine",
    nature: "Nature",
    occultism: "Occultism",
    performance: "Performance",
    religion: "Religion",
    society: "Society",
    stealth: "Stealth",
    survival: "Survival",
    thievery: "Thievery",
  };
  const SKILL_CHOICES: Array<{ slug: string; label: string }> = Object.entries(SKILL_LABELS).map(
    ([slug, label]) => ({ slug, label }),
  );

  function handleSkillChoice(skillSlug: string): void {
    if (!skillDialogTarget) return;
    const { level, slot } = skillDialogTarget;
    const op =
      slot.type === "skillIncrease"
        ? chooseSkillIncrease(opCtx, slot, level, skillSlug, 1)
        : chooseSkillTraining(opCtx, slot, level, skillSlug);
    if (op) sendOpFn(op);
    skillDialogTarget = null;
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
      name={plan.abc[0]?.name}
      subLine={plan.abc[0]?.subLine}
      filled={plan.abc[0]?.filled ?? false}
      {editable}
      onClick={() => openAbcPicker("ancestry")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("heritage")}
      name={plan.abc[1]?.name}
      subLine={plan.abc[1]?.subLine}
      filled={plan.abc[1]?.filled ?? false}
      {editable}
      onClick={() => openAbcPicker("heritage")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("background")}
      name={plan.abc[2]?.name}
      subLine={plan.abc[2]?.subLine}
      filled={plan.abc[2]?.filled ?? false}
      {editable}
      onClick={() => openAbcPicker("background")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("class")}
      name={plan.abc[3]?.name}
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
          onSlotClick={(slot) => handleSlotClick(levelPlan.level, slot)}
          onSlotRemove={(slot) => handleSlotRemove(levelPlan.level, slot)}
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

{#if boostsDialogTarget}
  {@const boostCtx = abilityBoostsSlotContext(doc, boostsDialogTarget.level)}
  <AbilityBoostsDialog
    title={abilityBoostsDialogTitle(boostsDialogTarget.level)}
    fixedSlugs={boostCtx.fixedSlugs}
    freeCount={boostCtx.freeCount}
    initialFreeSlugs={boostCtx.initialFreeSlugs}
    onClose={() => { boostsDialogTarget = null; }}
    onConfirm={(freeSlugs) => {
      if (boostsDialogTarget) handleAbilityBoostsConfirm(boostsDialogTarget.level, boostsDialogTarget.slot, freeSlugs);
    }}
  />
{/if}

{#if skillDialogTarget}
  <div
    class="skill-dialog-backdrop"
    role="presentation"
    onclick={() => { skillDialogTarget = null; }}
    onkeydown={(e) => { if (e.key === "Escape") skillDialogTarget = null; }}
  >
    <div
      class="skill-dialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t(`FUSION.Sheet.Plan.SlotLabel.${skillDialogTarget.slot.type}`)}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") skillDialogTarget = null; }}
    >
      <h3 class="skill-dialog__title">{t(`FUSION.Sheet.Plan.SlotLabel.${skillDialogTarget.slot.type}`)}</h3>
      <div class="skill-dialog__list">
        {#each SKILL_CHOICES as choice (choice.slug)}
          <button type="button" class="skill-dialog__item" onclick={() => handleSkillChoice(choice.slug)}>
            {choice.label}
          </button>
        {/each}
      </div>
    </div>
  </div>
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

  /* Skill choice mini-dialog */
  .skill-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 110;
  }

  .skill-dialog {
    width: 320px;
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

  .skill-dialog__title {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .skill-dialog__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .skill-dialog__item {
    text-align: left;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 12.5px;
    cursor: pointer;
  }

  .skill-dialog__item:hover {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-accent);
  }
</style>
