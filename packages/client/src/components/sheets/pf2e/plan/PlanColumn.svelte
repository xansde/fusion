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
    isClassChoiceOption,
    CLASS_CHOICE_SLOT_OPTIONS,
    matchesGrantedFeatFilter,
    abilityBoostsSlotContext,
    applyClass,
    applyAncestry,
    applyHeritage,
    applyBackground,
    chooseFeat,
    isFeatAtRepeatCap,
    chooseClassChoice,
    chooseKineticGate,
    chooseDivineFont,
    chooseAdoptedAncestry,
    readGateElements,
    isAncestryAdoptable,
    type KineticGatePick,
    setAbilityBoosts,
    markAbilityBoostsChoice,
    setFreeArchetype,
    setClassLevelsVariant,
    getClassLevelsVariant,
    classOptionsAt,
    chooseClassLevel,
    classOwnerAt,
    buildChoicesOf,
    nameToSlug,
    removeChoice,
    levelUp,
    skillTrainingDialogContext,
    confirmSkillTraining,
    addLoreSkill,
    detailsRequestForSlot,
    detailsRequestForAutoFeature,
    getIsekaiVariant,
    getIsekaiArchetypes,
    setIsekaiVariant,
    toggleIsekaiArchetype,
    detailsRequestForAbcChip,
    buildContentNameTranslator,
    abilityBoostsGrid,
    SLOT_TYPE_LABELS_EN,
    planGhostEntryCleanup,
    healGranterRefs,
    classFeatureGrantRefs,
    classGrantRefsFromClassDoc,
    backgroundLoreHealOps,
    loreSlugHealOps,
    actorSpellEntries,
    type AbcChip,
    type ClassGrantRef,
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
  import {
    materializeGrants,
    type GrantIndexEntry,
    type GrantFailure,
    type MaterializeContext,
  } from "../../../../lib/sheets/pf2e/grantMaterializer.js";
  import type { DocOpPayload } from "../../../../lib/sheets/pf2e/characterSheetVM.js";
  import { heritageMatchesAncestry } from "../../../../lib/sheets/pf2e/heritageFilter.js";
  import ABCCard from "./ABCCard.svelte";
  import type { AbcChipDisplay } from "./ABCCard.svelte";
  import LevelCard from "./LevelCard.svelte";
  import type { SlotDisplay, AutoFeatureDisplay } from "./LevelCard.svelte";
  import CompendiumPickerDialog from "./CompendiumPickerDialog.svelte";
  import PlanDetailsDialog from "./PlanDetailsDialog.svelte";
  import AbilityBoostsDialog from "./AbilityBoostsDialog.svelte";
  import SkillTrainingDialog from "./SkillTrainingDialog.svelte";
  import KineticGateDialog from "./KineticGateDialog.svelte";
  import DivineFontDialog from "./DivineFontDialog.svelte";
  import IsekaiArchetypeSelector from "./IsekaiArchetypeSelector.svelte";
  import IsekaiBlessingDialog from "./IsekaiBlessingDialog.svelte";
  import type { IsekaiChipInfo } from "../../../../lib/sheets/pf2e/planVM.js";
  import { t, i18n } from "../../../../lib/i18n/i18n.js";
  import { session, getSocket } from "../../../../lib/session.svelte.js";
  import {
    listPacks,
    searchPack,
    getDocument,
    requireConnectedSocket,
  } from "../../../../lib/compendium/compendiumApi.js";
  import type { PackIndexEntry } from "@fusion/shared";

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
    // A3 (r21 achados-do-usuario): the CLASS ABC card shares abcNameParts()
    // with ancestry/heritage/background, but the "classes-core" pack was
    // never in this list — class names rendered raw EN (e.g. "Barbarian")
    // even though systems/pf2e/packs/classes-core/i18n.pt-BR.json has the
    // pt-BR translations. Must load before "class-features-core" is fine
    // (different pack, no name collisions expected with class FEATURES).
    "classes-core",
    // r20-X5: materialized ancestry FEATURES (Sharp Teeth, Unusual Anatomy…)
    // need their pt-BR chip labels too, else the chip renders raw EN. Placed
    // BEFORE spells-core because the translator is first-wins and the SPELL
    // "Unusual Anatomy" (spells-core, "Anatomia Inusitada") shares the feature's
    // EN name — the feature's pt-BR ("Anatomia Incomum") must win here so the
    // chip label matches the details dialog (which resolves in this pack).
    "ancestry-features-core",
    "spells-core",
    // r15 A2 surfaced ACTION grants (e.g. Alchemist Dedication → Quick Alchemy)
    // as nested chips; their names must translate too, else the chip renders the
    // raw EN name ("Quick Alchemy" instead of "Alquimia Rápida").
    "actions-core",
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
   * translator yields `{ namePt, nameEn }` and both are shown — EXCEPT when the
   * pt-BR and EN names are identical (case/trim-insensitive), where the EN
   * subtitle is SUPPRESSED (r15 user decision: no redundant "Bon Mot / Bon Mot"
   * — aligns the Plan with the Actions tab's behavior).
   */
  function contentNameParts(stored: string, docId?: string): { name: string; subName?: string } {
    if (i18n.locale !== "pt-BR" || !contentTranslator) return { name: stored };
    const parts = contentTranslator(stored, docId);
    if (sameName(parts.namePt, parts.nameEn)) return { name: parts.namePt };
    return { name: parts.namePt, subName: parts.nameEn };
  }

  /** True when two display names are equal ignoring case + surrounding whitespace. */
  function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Fixed-grant materialization (B2 r14) — when a feat/feature is applied (or
  // when the Plan opens for an owner/GM), read its pack doc's `GrantItem` rule
  // elements and materialize each granted feat/action/spell as an embedded item
  // tagged `flags.fusion.grantedBy`. Async (compendium socket) + idempotent.
  // The pure engine lives in grantMaterializer.ts; here we inject the socket-
  // backed resolvers and forward the resulting doc:create ops through sendOpFn.
  // ---------------------------------------------------------------------------

  /** Per-open cache of pack indexes (pack slug → entries) so a heal touches each pack once. */
  const packIndexCache = new Map<string, GrantIndexEntry[]>();

  async function resolvePackIndex(packSlug: string): Promise<GrantIndexEntry[]> {
    const cached = packIndexCache.get(packSlug);
    if (cached) return cached;
    const sock = requireConnectedSocket(getSocket());
    const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
    const pack = packs.find((p) => p.id.endsWith(`.${packSlug}`));
    if (!pack) {
      packIndexCache.set(packSlug, []);
      return [];
    }
    const { entries } = await searchPack(sock, { packId: pack.id });
    const mapped: GrantIndexEntry[] = (entries as PackIndexEntry[]).map((e) => ({
      name: e.name,
      uuid: e.uuid,
      ...(typeof e.type === "string" ? { type: e.type } : {}),
    }));
    packIndexCache.set(packSlug, mapped);
    return mapped;
  }

  async function resolveGrantDoc(uuid: string): Promise<Record<string, unknown> | null> {
    try {
      const sock = requireConnectedSocket(getSocket());
      const { document } = await getDocument(sock, uuid);
      return document;
    } catch {
      return null;
    }
  }

  function materializeContext(onGrantFailure?: (f: GrantFailure) => void): MaterializeContext {
    return {
      actorId,
      existingItems: (doc["items"] as Array<Record<string, unknown>> | undefined) ?? [],
      spellEntries: actorSpellEntries(doc),
      resolveIndex: resolvePackIndex,
      resolveDoc: resolveGrantDoc,
      ...(onGrantFailure ? { onGrantFailure } : {}),
    };
  }

  /**
   * Collect the grants materialization dropped and report them ONCE per pass
   * (issue #35). Materialization skipping an unresolvable grant is correct — a
   * missing clean-room equivalent must never break a build — but it used to be
   * invisible: 43 grants fail per class build with nothing in the console. The
   * summary is grouped by reason so a build stays readable instead of emitting
   * one line per failure.
   */
  function grantFailureCollector(): {
    sink: (f: GrantFailure) => void;
    flush: (label: string) => void;
  } {
    const failures: GrantFailure[] = [];
    return {
      sink: (f) => failures.push(f),
      flush: (label) => {
        if (failures.length === 0) return;
        const byReason = new Map<string, GrantFailure[]>();
        for (const f of failures) {
          const list = byReason.get(f.reason) ?? [];
          list.push(f);
          byReason.set(f.reason, list);
        }
        /* eslint-disable no-console */
        console.warn(
          `[Plan grants] ${label}: ${String(failures.length)} grant(s) did not resolve`,
        );
        for (const [reason, list] of byReason) {
          console.warn(
            `  ${reason} (${String(list.length)}):`,
            list.map((f) => `${f.granterName ?? f.granterSourceId} → ${f.name ?? f.uuid}`),
          );
        }
        /* eslint-enable no-console */
        failures.length = 0;
      },
    };
  }

  /**
   * Materialize the fixed grants of a just-applied granter doc (from the
   * picker) and send the resulting create ops. `granterSourceId`/`slot` come
   * from the granter's `flags.fusion` (the picker doc carries the pack
   * sourceId). Best-effort: any socket failure leaves the actor unchanged.
   */
  async function materializeAppliedGrants(
    granterDoc: Record<string, unknown>,
    slot: string | undefined,
  ): Promise<void> {
    if (!editable) return;
    const fusion = ((granterDoc["flags"] as Record<string, unknown> | undefined)?.["fusion"] ?? {}) as Record<string, unknown>;
    const sourceId = typeof fusion["sourceId"] === "string" ? fusion["sourceId"] : undefined;
    if (!sourceId) return;
    const collector = grantFailureCollector();
    try {
      const ops = await materializeGrants(
        granterDoc,
        sourceId,
        slot,
        materializeContext(collector.sink),
      );
      for (const op of ops) sendOpFn(op);
      collector.flush(`applied ${String(granterDoc["name"] ?? sourceId)}`);
    } catch {
      // Offline / no socket: grants simply don't materialize now — the on-open
      // heal will pick them up next time the owner opens the Plan.
    }
  }

  /**
   * Resolve a granter's full pack doc within a Fusion pack, or null.
   *
   * Identity is the document ID when we have one (issue #14) — matching by name
   * broke 5 of the 12 classes' features, because the class table and the
   * feature document disagree on the label: "Debilitating Strikes" vs
   * "Debilitating Strike", "Deity" vs "Deity (Cleric)", "Lightning Reflexes" vs
   * "Reflex Expertise". The Rogue case cost a whole action: the feature doc
   * grants the Debilitating Strike ACTION, and a never-resolved doc grants
   * nothing.
   *
   * The name stays as fallback for data with no id (homebrew).
   */
  async function resolveGranterByName(
    packSlug: string,
    name: string,
    docId?: string,
  ): Promise<Record<string, unknown> | null> {
    const entries = await resolvePackIndex(packSlug);
    const byId = docId === undefined ? undefined : entries.find((e) => e._id === docId);
    const entry = byId ?? entries.find((e) => normalizeForMatch(e.name) === normalizeForMatch(name));
    if (!entry) return null;
    return resolveGrantDoc(entry.uuid);
  }

  /**
   * Materialize the ACTIONS a class's features concede (r20-X4). The class's
   * features (Impulses, Kinetic Aura, Spellstrike, Arcane Cascade…) are NOT
   * embedded on the actor — they're named by the class doc — so we resolve each
   * feature's own pack doc and run materializeGrants on it, tagging every
   * conceded action with the CLASS as root granter (grantedBy=<classSourceId>,
   * grantedSlot=`classFeature:<level>:<name>`). Idempotent + best-effort.
   */
  async function materializeClassGrants(classDoc: Record<string, unknown>): Promise<void> {
    if (!editable) return;
    const fusion = ((classDoc["flags"] as Record<string, unknown> | undefined)?.["fusion"] ?? {}) as Record<string, unknown>;
    const classSourceId = typeof fusion["sourceId"] === "string" ? fusion["sourceId"] : undefined;
    if (!classSourceId) return;
    const refs = classGrantRefsFromClassDoc(classDoc["system"], classSourceId, ctx.level);
    await runClassGrantRefs(refs);
  }

  /**
   * Shared: resolve each class-feature ref's doc and materialize its conceded
   * actions. `failureSink` lets a caller that owns a wider pass (runHeal)
   * aggregate these drops into its own summary instead of emitting a second one.
   */
  async function runClassGrantRefs(
    refs: ClassGrantRef[],
    failureSink?: (f: GrantFailure) => void,
  ): Promise<number> {
    if (refs.length === 0) return 0;
    const own = failureSink ? null : grantFailureCollector();
    const mctx = materializeContext(failureSink ?? own?.sink);
    let created = 0;
    for (const ref of refs) {
      try {
        const featureDoc = await resolveGranterByName(ref.packSlug, ref.name, ref.docId);
        if (!featureDoc) continue;
        const ops = await materializeGrants(featureDoc, ref.classSourceId, ref.slot, mctx);
        for (const op of ops) {
          sendOpFn(op);
          created++;
        }
      } catch {
        // best-effort per feature; a socket failure just defers to next open.
      }
    }
    own?.flush("class feature grants");
    return created;
  }

  // ---------------------------------------------------------------------------
  // On-open heal (B2 r14, gaps #11 + #12) — for an owner/GM, scan already-
  // applied granters for missing fixed grants and materialize them, and remove
  // the narrow ghost spellcasting-entry duplicate. Runs ONCE per opened actor
  // (guarded by `healedActorId`), idempotent (re-running is a no-op).
  // ---------------------------------------------------------------------------

  let healedActorId = $state<string | null>(null);

  $effect(() => {
    void doc;
    if (!editable) return;
    if (healedActorId === actorId) return;
    healedActorId = actorId;
    void runHeal();
  });

  async function runHeal(): Promise<void> {
    // Ghost entry cleanup first (pure, synchronous) — narrow criteria, logged.
    const ghostOps = planGhostEntryCleanup(opCtx);
    for (const op of ghostOps) {
      // eslint-disable-next-line no-console
      console.log("[Plan heal] removing ghost spellcasting entry", op.id);
      sendOpFn(op);
    }

    let created = 0;
    const collector = grantFailureCollector();
    const mctx = materializeContext(collector.sink);

    // (1) Feat/classFeature granters — re-scan each applied granter's pack doc
    // for missing fixed grants (B2 r14).
    try {
      for (const ref of healGranterRefs(doc)) {
        const granterDoc = await resolveGranterByName(ref.packSlug, ref.name);
        if (!granterDoc) continue;
        const ops = await materializeGrants(granterDoc, ref.sourceId, ref.slot, mctx);
        for (const op of ops) { sendOpFn(op); created++; }
      }
    } catch { /* deferred to next open */ }

    // (2) ABC feature grants (r20-X4/X5) — the embedded ancestry/heritage/
    // background items carry a `system.items` feature map + a stable sourceId.
    // We re-resolve each ABC from its CURRENT pack before materializing, because
    // an actor built before a pack update has a STALE embedded copy: e.g. the
    // real Finn's embedded Aeronaut predates r20-X5's Assurance grant (empty
    // `system.items`), and every embedded ABC predated ancestry-features-core.
    // Falling back to the embedded item keeps homebrew / unresolvable ABCs
    // working. The granter sourceId stays the EMBEDDED one (grants are tagged/
    // matched by it in abcChipsFor); the pack doc only supplies system.items.
    // Resolvable features materialize; unresolved ones skip → informative chip.
    const ABC_PACK_SLUG: Record<"ancestry" | "heritage" | "background", string> = {
      ancestry: "ancestries-core",
      heritage: "heritages-core",
      background: "backgrounds-core",
    };
    try {
      for (const kind of ["ancestry", "heritage", "background"] as const) {
        const abcItem = (doc["items"] as Array<Record<string, unknown>> | undefined)?.find((i) => i["type"] === kind);
        if (!abcItem) continue;
        const sid = ((abcItem["flags"] as Record<string, unknown> | undefined)?.["fusion"] as Record<string, unknown> | undefined)?.["sourceId"];
        if (typeof sid !== "string") continue;
        const abcName = typeof abcItem["name"] === "string" ? abcItem["name"] : undefined;
        const abcDoc = (abcName ? await resolveGranterByName(ABC_PACK_SLUG[kind], abcName) : null) ?? abcItem;
        const ops = await materializeGrants(abcDoc, sid, undefined, mctx);
        for (const op of ops) { sendOpFn(op); created++; }
      }
    } catch { /* deferred */ }

    // (3a) Lore SLUG migration — sheets built before loreSlug.ts hold their Lore
    // under the legacy `<subject>-lore` key, which no reader understands (the
    // row renders as the raw slug). Rename to the canonical `lore-<subject>`,
    // preserving the proficiency. Idempotent: a healed sheet yields no ops.
    let migratedLore = false;
    try {
      const ops = loreSlugHealOps(opCtx);
      migratedLore = ops.length > 0;
      for (const op of ops) { sendOpFn(op); created++; }
    } catch { /* deferred to next open */ }

    // (3b) Background LORE heal (r20-X4) — the real Finn/Tobias were built before
    // the lore branch, so their Piloting/Fireworks Lore was never trained.
    // Re-resolve the background from the CURRENT pack (its embedded copy may be
    // a stale import) and add the missing lore training. Idempotent.
    //
    // Skipped in the same pass as a slug migration: `doc` is the PRE-heal
    // snapshot, so this heal would rebuild `system.build.choices` from the
    // stale array and undo (3a)'s repointing. Next open sees the migrated doc
    // and (3a) is a no-op, so nothing is lost — only deferred.
    try {
      const bgItem = (doc["items"] as Array<Record<string, unknown>> | undefined)?.find((i) => i["type"] === "background");
      const bgName = bgItem ? (typeof bgItem["name"] === "string" ? bgItem["name"] : undefined) : undefined;
      if (bgName && !migratedLore) {
        const bgDoc = (await resolveGranterByName("backgrounds-core", bgName)) ?? bgItem!;
        for (const op of backgroundLoreHealOps(opCtx, bgDoc)) { sendOpFn(op); created++; }
      }
    } catch { /* deferred */ }

    // (4) Class action grants (r20-X4) — materialize the actions the class's
    // non-choice features concede (Elemental Blast/Base Kinesis/Channel
    // Elements/Spellstrike/Arcane Cascade), tagged by the class.
    try {
      created += await runClassGrantRefs(classFeatureGrantRefs(doc), collector.sink);
    } catch { /* deferred */ }

    // One summary for the whole heal pass — every grant this build could not
    // resolve, grouped by reason (issue #35).
    collector.flush("on-open heal");

    if (created > 0 || ghostOps.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[Plan heal] materialized ${String(created)} missing grant(s), removed ${String(ghostOps.length)} ghost entrie(s)`);
    }
  }

  /** Accent/case-insensitive name normalize (mirrors planVM's normalizeName). */
  function normalizeForMatch(name: string): string {
    return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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
    // "Nível de classe" reads "<Classe> <n>" — only the class NAME goes through
    // the content translator; the running class level is a number and must be
    // kept out of the lookup, or the join fails and the name stays in English.
    if (slot.type === "classLevel" && slot.choiceName) {
      const match = /^(.*?)\s+(\d+)$/.exec(slot.choiceName);
      const rawName = match?.[1] ?? slot.choiceName;
      const classLevel = match?.[2];
      const parts = contentNameParts(rawName);
      const suffix = classLevel === undefined ? "" : ` ${classLevel}`;
      return {
        name: `${parts.name}${suffix}`,
        ...(parts.subName !== undefined ? { subName: `${parts.subName}${suffix}` } : {}),
        type: typeParts.type,
        ...(typeParts.subType !== undefined ? { subType: typeParts.subType } : {}),
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
    // Resolve by docId first (issue #65): `featuresByLevel` stores a literal
    // name that can differ from the referenced document's own — the Cleric's
    // "Deity" points at a document named "Deity (Cleric)", so matching by name
    // misses and the chip renders in EN even though the translation exists.
    const parts = contentNameParts(feature.name, feature.docId);
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

  /**
   * The locked chips (bilingual, clickable when resolvable) shown under an ABC
   * card (r20-X4). A chip that maps to a compendium doc opens the read-only
   * details dialog; an informative chip (scalar / unresolved feature) is static.
   */
  function abcChipDisplays(chips: AbcChip[] | undefined): AbcChipDisplay[] {
    if (!chips) return [];
    return chips.map((chip) => {
      const parts = contentNameParts(chip.name);
      const req = detailsRequestForAbcChip(chip);
      return {
        key: chip.key,
        name: parts.name,
        ...(parts.subName !== undefined ? { subName: parts.subName } : {}),
        ...(req ? { onClick: () => { detailsRequest = req; } } : {}),
      };
    });
  }

  /** Frente 3 (DEC-BC-05): render an ABC card's requirement-issue reason (if any) via i18n. */
  function abcIssueText(card: { requirementIssue?: { reasonKey: string; params?: Record<string, string> } } | undefined): string | undefined {
    if (!card?.requirementIssue) return undefined;
    return t(card.requirementIssue.reasonKey, card.requirementIssue.params);
  }

  /** Read `flags.fusion.sourceId` off an embedded item (matches CompendiumPickerDialog's `currentSourceId` uuid-suffix match). */
  function itemSourceId(item: Record<string, unknown> | undefined): string | undefined {
    const fusion = (item?.["flags"] as Record<string, unknown> | undefined)?.["fusion"] as Record<string, unknown> | undefined;
    const sid = fusion?.["sourceId"];
    return typeof sid === "string" ? sid : undefined;
  }

  /** Frente 3: the pack sourceId of the currently-applied ancestry/heritage/background/class item, for pre-selecting it in the reopened ABC picker. */
  function abcCurrentSourceId(kind: "ancestry" | "heritage" | "background" | "class"): string | undefined {
    const items = (doc["items"] as Array<Record<string, unknown>> | undefined) ?? [];
    return itemSourceId(items.find((i) => i["type"] === kind));
  }

  /** Frente 3: the pack sourceId of a FILLED slot's current item, for pre-selecting it in the reopened slot picker. */
  function slotCurrentSourceId(slot: PlanSlotModel): string | undefined {
    if (!slot.itemId) return undefined;
    const items = (doc["items"] as Array<Record<string, unknown>> | undefined) ?? [];
    return itemSourceId(items.find((i) => i["_id"] === slot.itemId));
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
    // Under the multiclass variant the Class card must NOT run applyClass:
    // that builder REPLACES the class (correct for a single-class sheet, and
    // destructive here — it deletes the other classes and leaves every
    // classLevel choice pointing at an item that no longer exists). Seen live
    // on Torvin: picking from this card wiped the Fighter and duplicated the
    // Cleric. The first class is decided by level 1's own slot, so send the
    // player there instead.
    if (kind === "class" && classLevelsOn) {
      classLevelPicker = 1;
      return;
    }
    abcPicker = kind;
  }

  function handleAbcSelect(doc2: Record<string, unknown>): void {
    if (!abcPicker) return;
    switch (abcPicker) {
      case "ancestry":
        sendAll(applyAncestry(opCtx, doc2));
        // Materialize the ancestry's system.items feature grants (r20-X4 — e.g.
        // Fascinating Performance-style feats). Unresolved features (no clean-
        // room pack) simply skip; the ABC card still shows an informative chip.
        void materializeAppliedGrants(doc2, undefined);
        break;
      case "heritage":
        sendAll(applyHeritage(opCtx, doc2));
        void materializeAppliedGrants(doc2, undefined);
        break;
      case "background":
        sendAll(applyBackground(opCtx, doc2));
        void materializeAppliedGrants(doc2, undefined);
        break;
      case "class":
        // The key-ability CHOICE is made in the "Dádivas de Atributo"
        // dialog's class group (build.abilities.classBoost) — the embedded
        // class item keeps the full keyAbility option list (r11 fix).
        sendAll(applyClass(opCtx, doc2));
        // Materialize the actions the class's features concede (r20-X4 —
        // Elemental Blast/Base Kinesis via Impulses, Channel Elements via
        // Kinetic Aura, Spellstrike, Arcane Cascade).
        void materializeClassGrants(doc2);
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
  let kineticGateTarget = $state<{ level: number; slot: PlanSlotModel } | null>(null);
  let divineFontTarget = $state<{ level: number; slot: PlanSlotModel } | null>(null);

  // Repeat-cap rejection notice (W2 frente 1) — chooseFeat silently refuses
  // (returns []) a feat that already hit its `maxTakable` cap, so the picker
  // dialog closes with nothing sent unless we surface this instead. Checked
  // BEFORE calling chooseFeat (same predicate it uses internally) so the
  // dialog stays open and the player can pick something else.
  let repeatCapNotice = $state<string | null>(null);
  let repeatCapNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  function showRepeatCapNotice(): void {
    repeatCapNotice = t("FUSION.Sheet.Plan.Picker.AlreadyChosen");
    if (repeatCapNoticeTimer) clearTimeout(repeatCapNoticeTimer);
    repeatCapNoticeTimer = setTimeout(() => {
      repeatCapNotice = null;
    }, 4000);
  }

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
    if (slot.type === "kineticGate") {
      kineticGateTarget = { level, slot };
      return;
    }
    // issue #34 — no per-option pack doc exists for this slot (see
    // `chooseDivineFont`'s doc comment), so it can't go through the generic
    // CLASS_CHOICE_SLOT_OPTIONS picker below; it gets its own tiny dialog,
    // the same way kineticGate does.
    if (slot.type === "divineFont") {
      divineFontTarget = { level, slot };
      return;
    }
    if (slot.type === "classLevel") {
      classLevelPicker = level;
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

  // `level` is the enclosing LevelPlanModel.level (issue #58) — the ONE place
  // that knows which level THIS plan actually granted the item at, as
  // opposed to a shared class-features-core document's own divergent static
  // system.level. Threaded into the request so the details panel can show
  // the real grant level instead of the document's.
  function handleSlotDetails(level: number, slot: PlanSlotModel): void {
    const req = detailsRequestForSlot(slot, level);
    if (req) detailsRequest = req;
  }

  function handleAutoFeatureClick(level: number, feature: AutoFeatureModel): void {
    // An Isekai blessing has no compendium document — it explains itself from
    // the chip, with no socket round-trip and no failure mode.
    if (feature.isekai) {
      isekaiDetails = { ...feature.isekai, name: feature.name };
      return;
    }
    detailsRequest = detailsRequestForAutoFeature(feature, level);
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

  /**
   * Rebuild the shape `isFeatAtRepeatCap` needs from an index entry (issue
   * #57): its identity (sourceId/name) plus the repeat cap. The picker filters
   * from the INDEX, so without `system.maxTakable` published there an
   * exhausted feat stayed on the list and was only refused after the click.
   *
   * `maxTakable` is forwarded VERBATIM — `null` is a meaningful value in the
   * pack (it means unlimited), so it must not be normalized away here.
   */
  function repeatCapDocFromIndex(e: {
    name: string;
    index: Record<string, unknown>;
  }): Record<string, unknown> {
    const sourceId = e.index["flags.fusion.sourceId"];
    const system: Record<string, unknown> = {};
    if ("system.maxTakable" in e.index) system["maxTakable"] = e.index["system.maxTakable"];
    return {
      name: e.name,
      type: "feat",
      system,
      ...(typeof sourceId === "string" ? { flags: { fusion: { sourceId } } } : {}),
    };
  }

  function pickerConfigFor(slot: PlanSlotModel): { packSlug: string; title: string; filterFn?: (e: { name: string; index: Record<string, unknown> }) => boolean } {
    const level = slotPicker?.level ?? ctx.level;
    // Class-declared choice slots (hybridStudy, instinct, racket, huntersEdge,
    // arcaneThesis, arcaneSchool, …) all pick from a tagged list of
    // class-features-core docs — CLASS_CHOICE_SLOT_OPTIONS is the single
    // declarative source for which pack + otherTags value each slot type uses
    // (r21-W1: generalizes the r19-W2b hybridStudy-only hardcode). kineticGate
    // has no entry here — it uses its own dedicated dialog below.
    const choiceOptions = CLASS_CHOICE_SLOT_OPTIONS[slot.type];
    if (choiceOptions) {
      return {
        packSlug: choiceOptions.packSlug,
        title: t("FUSION.Sheet.Plan.Picker.AbcTitle", { type: t(`FUSION.Sheet.Plan.SlotLabel.${slot.type}`) }),
        filterFn: (e) => isClassChoiceOption({ system: { traits: { otherTags: e.index["system.traits.otherTags"] } } }, slot.type),
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
    if (slot.type === "adoptedAncestryChoice") {
      // "Adopted Ancestry" (feats-core) unlocks this sub-slot: pick any
      // ancestry from ancestries-core EXCEPT the character's own (mirrors the
      // vendor ChoiceSet's `{not: "item:slug:{actor|system.details.ancestry.
      // trait}"}` filter — see planVM.ts's ANCESTRY_CHOICE_GRANTS doc comment).
      return {
        packSlug: "ancestries-core",
        title: t("FUSION.Sheet.Plan.Picker.AbcTitle", {
          type: t("FUSION.Sheet.Plan.SlotLabel.adoptedAncestryChoice"),
        }),
        filterFn: (e) => isAncestryAdoptable(e.name, ctx.ancestrySlug),
      };
    }
    // Kineticist: a classFeat slot filters impulse feats by the character's
    // chosen gate elements (an Air+Metal kineticist can't pick a Fire impulse).
    // gateElements is [] for a non-kineticist → the impulse filter is a no-op.
    const gateElements = readGateElements(doc);

    // Multiclass: a CLASS feat slot belongs to the class that bought this
    // level, and is measured against THAT class's level — a Fighter 3 / Magus 1
    // may take a Magus feat of level 1 at the level the Magus bought, not a
    // Magus feat of level 3. Any other slot type (ancestry/general/skill) is
    // character-wide and keeps the character level and the primary class.
    const owner =
      slot.type === "classFeat" ? classOwnerAt(doc, buildChoicesOf(doc), level) : undefined;
    const effectiveLevel = owner?.classLevel ?? level;
    const effectiveClassSlug = owner ? nameToSlug(owner.name) : ctx.classSlug;

    return {
      packSlug: "feats-core",
      title: t(`FUSION.Sheet.Plan.SlotLabel.${slot.type}`),
      filterFn: (e) => {
        // Already taken as many times as it allows → off the list, instead of
        // being listed and refused only after the click (issue #57).
        if (isFeatAtRepeatCap(doc, repeatCapDocFromIndex(e))) return false;
        const featDoc = featDocFromIndex(e);
        return isFeatEligible(featDoc, slot.type, effectiveLevel, {
          ...(effectiveClassSlug ? { classSlug: effectiveClassSlug } : {}),
          ...(ctx.ancestrySlug ? { ancestrySlug: ctx.ancestrySlug } : {}),
          ...(ctx.adoptedAncestrySlug ? { adoptedAncestrySlug: ctx.adoptedAncestrySlug } : {}),
          ...(gateElements.length > 0 ? { gateElements } : {}),
        });
      },
    };
  }

  function handleSlotPickerSelect(selectedDoc: Record<string, unknown>): void {
    if (!slotPicker) return;
    const { level, slot } = slotPicker;
    // Teto de repetição (frente 1): talento não-repetível já escolhido, ou
    // repetível já no `maxTakable`, não pode ser aceito de novo.
    // `isFeatAtRepeatCap` é no-op para doc que não é "feat" (escolhas de
    // classFeature), então nunca afeta hybridStudy/instinct/etc. `chooseFeat`
    // aplica o MESMO predicado internamente — esta checagem antecipada só
    // mantém o diálogo aberto com um motivo visível, em vez de fechar num
    // no-op silencioso.
    if (isFeatAtRepeatCap(doc, selectedDoc)) {
      showRepeatCapNotice();
      return;
    }
    if (slot.type === "adoptedAncestryChoice") {
      // Escolha-referência (sem item embutido, ver chooseAdoptedAncestry) — o
      // doc escolhido é só uma REFERÊNCIA (qual ancestralidade conta como
      // "adotada" para elegibilidade de talento de ancestralidade), não uma
      // ancestralidade que o personagem passa a ser. Por isso, ao contrário de
      // todos os outros ramos do picker, os GrantItem dela NÃO são
      // materializados no ator.
      sendAll(chooseAdoptedAncestry(opCtx, slot, level, selectedDoc));
      slotPicker = null;
      return;
    }
    if (CLASS_CHOICE_SLOT_OPTIONS[slot.type]) {
      sendAll(chooseClassChoice(opCtx, slot.type, level, selectedDoc));
    } else {
      sendAll(chooseFeat(opCtx, slot, level, selectedDoc));
    }
    // Materialize any FIXED grants the picked feat/feature declares (B2 r14):
    // the picker doc already carries `system.rules` + `flags.fusion.sourceId`,
    // so this reads the grants and sends the granted items' create ops.
    void materializeAppliedGrants(selectedDoc, slot.slotId);
    slotPicker = null;
  }

  /**
   * Kinetic Gate confirm — the dialog resolves the "Kinetic Gate" classFeature
   * doc itself and hands it here with the player's element/damage picks; we
   * stamp them into `system.kineticGates` via chooseKineticGate.
   */
  function handleKineticGateConfirm(featureDoc: Record<string, unknown>, picks: KineticGatePick[]): void {
    if (!kineticGateTarget) return;
    sendAll(chooseKineticGate(opCtx, kineticGateTarget.level, featureDoc, picks));
    kineticGateTarget = null;
  }

  /** Divine Font confirm (issue #34) — no doc resolution needed, `chooseDivineFont` synthesizes the item itself. */
  function handleDivineFontConfirm(choice: "heal" | "harm"): void {
    if (!divineFontTarget) return;
    sendAll(chooseDivineFont(opCtx, divineFontTarget.level, choice));
    divineFontTarget = null;
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

  // ---------------------------------------------------------------------------
  // Multiclass by class levels (specs/30)
  // ---------------------------------------------------------------------------

  const classLevelsOn = $derived(
    getClassLevelsVariant(
      (doc["system"] as Record<string, unknown> | undefined) ?? {},
    ),
  );

  function toggleClassLevels(): void {
    const op = setClassLevelsVariant(opCtx, !classLevelsOn);
    if (op) sendOpFn(op);
  }

  /** The level whose "Nível de classe" slot is being picked, if any. */
  let classLevelPicker = $state<number | null>(null);

  /**
   * Which classes the picker may offer at the level being edited.
   *
   * `null` means "any class in the compendium" (level 1 or an even level — a
   * new class may enter). Otherwise the list is restricted to the sourceIds
   * already on the sheet, because odd levels only continue a class you have.
   */
  const classLevelAllowed = $derived(
    classLevelPicker === null ? null : classOptionsAt(doc, classLevelPicker),
  );

  function handleClassLevelSelect(classDoc: Record<string, unknown>): void {
    const level = classLevelPicker;
    classLevelPicker = null;
    if (level === null) return;
    sendAll(chooseClassLevel(opCtx, level, classDoc));
    // A brand-new class brings its own level-1 grants (actions from features,
    // etc.) — same materialization the ABC class picker runs.
    void materializeAppliedGrants(classDoc, undefined);
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

  // ---------------------------------------------------------------------------
  // Isekai layer (./isekai)
  // ---------------------------------------------------------------------------

  const docSystem = $derived((doc["system"] as Record<string, unknown> | undefined) ?? {});
  const isekaiOn = $derived(getIsekaiVariant(docSystem));
  const isekaiArchetypes = $derived(getIsekaiArchetypes(docSystem));

  /** The blessing whose details dialog is open, if any. */
  let isekaiDetails = $state<(IsekaiChipInfo & { name: string }) | null>(null);

  function toggleIsekai(): void {
    const op = setIsekaiVariant(opCtx, !isekaiOn);
    if (op) sendOpFn(op);
  }

  function handleIsekaiArchetype(archetypeId: string): void {
    // Returns null when the pick is not allowed (cap reached, unknown id) —
    // the selector already disables those, so a null here means nothing to do.
    const op = toggleIsekaiArchetype(opCtx, archetypeId);
    if (op) sendOpFn(op);
  }
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
      chips={abcChipDisplays(plan.abc[0]?.chips)}
      issueText={abcIssueText(plan.abc[0])}
      {editable}
      onClick={() => openAbcPicker("ancestry")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("heritage")}
      name={abcNameParts(plan.abc[1]?.name).name}
      subName={abcNameParts(plan.abc[1]?.name).subName}
      subLine={plan.abc[1]?.subLine}
      filled={plan.abc[1]?.filled ?? false}
      chips={abcChipDisplays(plan.abc[1]?.chips)}
      issueText={abcIssueText(plan.abc[1])}
      {editable}
      onClick={() => openAbcPicker("heritage")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("background")}
      name={abcNameParts(plan.abc[2]?.name).name}
      subName={abcNameParts(plan.abc[2]?.name).subName}
      subLine={plan.abc[2]?.subLine}
      filled={plan.abc[2]?.filled ?? false}
      chips={abcChipDisplays(plan.abc[2]?.chips)}
      issueText={abcIssueText(plan.abc[2])}
      {editable}
      onClick={() => openAbcPicker("background")}
    />
    <ABCCard
      typeLabel={abcTypeLabel("class")}
      name={abcNameParts(plan.abc[3]?.name).name}
      subName={abcNameParts(plan.abc[3]?.name).subName}
      subLine={plan.abc[3]?.subLine}
      filled={plan.abc[3]?.filled ?? false}
      issueText={abcIssueText(plan.abc[3])}
      {editable}
      onClick={() => openAbcPicker("class")}
    />
  </div>

  {#if editable}
    <label class="plan-column__toggle">
      <input type="checkbox" checked={freeArchetypeOn} onchange={toggleFreeArchetype} />
      {t("FUSION.Sheet.Plan.FreeArchetypeToggle")}
    </label>
    <label class="plan-column__toggle">
      <input type="checkbox" checked={classLevelsOn} onchange={toggleClassLevels} />
      {t("FUSION.Sheet.Plan.ClassLevelsToggle")}
    </label>
    <label class="plan-column__toggle">
      <input type="checkbox" checked={isekaiOn} onchange={toggleIsekai} />
      {t("FUSION.Sheet.Plan.IsekaiToggle")}
    </label>
  {/if}

  <!--
    The selector only exists while the layer is on. Rendered for read-only
    viewers too (non-editable): a player looking at someone else's sheet still
    needs to see WHICH archetypes that character carries.
  -->
  {#if isekaiOn}
    <IsekaiArchetypeSelector
      selected={isekaiArchetypes}
      {editable}
      onToggle={handleIsekaiArchetype}
    />
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
          onSlotDetails={(slot) => handleSlotDetails(levelPlan.level, slot)}
          onAutoFeatureClick={(feature) => handleAutoFeatureClick(levelPlan.level, feature)}
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
        ? (e) => heritageMatchesAncestry(e.index["system.ancestry.slug"], ctx.ancestrySlug!)
        : undefined
    }
    currentSourceId={abcCurrentSourceId(abcPicker)}
    onClose={() => { abcPicker = null; }}
    onSelect={handleAbcSelect}
  />
{/if}

{#if classLevelPicker !== null}
  <CompendiumPickerDialog
    packSlug="classes-core"
    title={t("FUSION.Sheet.Plan.Picker.ClassLevelTitle", {
      level: String(classLevelPicker),
    })}
    showTraitFilter={false}
    filterFn={
      classLevelAllowed === null
        ? undefined
        : (e) => {
            // Odd level: only a class already on the sheet may continue.
            //
            // Matched by NAME here, not by sourceId, because the pack index
            // does not publish `flags.fusion.sourceId` yet (issue #41) — the
            // filter would reject everything. Names are unique inside
            // classes-core (12 distinct classes), so this is safe HERE and
            // nowhere else; the pick itself is still recorded by sourceId,
            // read off the full document the picker returns.
            const name = e.index["name"];
            const allowed = classLevelAllowed;
            if (typeof name !== "string" || !allowed) return false;
            return allowed.some((c) => c.name === name);
          }
    }
    onClose={() => { classLevelPicker = null; }}
    onSelect={handleClassLevelSelect}
  />
{/if}

{#if slotPicker}
  {@const cfg = pickerConfigFor(slotPicker.slot)}
  <CompendiumPickerDialog
    packSlug={cfg.packSlug}
    title={cfg.title}
    showTraitFilter={true}
    filterFn={cfg.filterFn}
    currentSourceId={slotCurrentSourceId(slotPicker.slot)}
    onClose={() => { slotPicker = null; }}
    onSelect={handleSlotPickerSelect}
  />
{/if}

{#if repeatCapNotice}
  <div class="plan-column__notice" role="status">{repeatCapNotice}</div>
{/if}

{#if detailsRequest}
  <PlanDetailsDialog request={detailsRequest} onClose={() => { detailsRequest = null; }} />
{/if}

{#if isekaiDetails}
  <IsekaiBlessingDialog blessing={isekaiDetails} onClose={() => { isekaiDetails = null; }} />
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

{#if kineticGateTarget}
  <KineticGateDialog
    title={t("FUSION.Sheet.Plan.KineticGate.Title")}
    onClose={() => { kineticGateTarget = null; }}
    onConfirm={handleKineticGateConfirm}
  />
{/if}

{#if divineFontTarget}
  <DivineFontDialog
    title={t("FUSION.Sheet.Plan.DivineFont.Title")}
    onClose={() => { divineFontTarget = null; }}
    onConfirm={handleDivineFontConfirm}
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

  .plan-column__notice {
    position: fixed;
    left: 50%;
    bottom: 32px;
    transform: translateX(-50%);
    z-index: 200;
    padding: 10px 18px;
    border-radius: var(--fusion-radius);
    background: var(--fusion-danger);
    color: var(--fusion-on-accent);
    font-family: var(--fusion-font);
    font-size: 13px;
    font-weight: 600;
    box-shadow: var(--fusion-shadow-modal);
  }
</style>
