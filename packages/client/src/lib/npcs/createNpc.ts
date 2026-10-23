/**
 * createNpc.ts — the two doors of the creation window (spec 42 §5.6, G074).
 *
 * The tab creates a non-playable in exactly two ways, and this module owns both
 * so the window above it is a form and nothing else:
 *
 *  - **From the bestiary** (REQ-NPC-042): a search by name over the ACTOR packs,
 *    and an import that is the spec 16 one — `compendium:import` (REQ-CMP-016,
 *    REQ-CMP-021), consumed from here. There is no second importer in this file:
 *    the bestiary path never writes a `doc:create` of an Actor, because writing
 *    one would mean re-implementing the clone, the flags and the asset
 *    substitution the compendium service already does.
 *  - **From scratch** (REQ-NPC-043): a subtype and a name, and the subtypes
 *    offered are only `npc` and `hazard` (REQ-NPC-044). `character` is born with
 *    the player (DEC-NPC-02), `familiar` is born glued to a master (REQ-PET-002),
 *    `loot` is the chest and is not an actor of this tab (DEC-NPC-08), and a
 *    vehicle does not exist in Fusion at all (DEC-NPC-05) — it is not a subtype
 *    that was cut, it was never declared.
 *
 * **The preset pre-fills and is not stored** (REQ-NPC-045, REQ-NPC-046,
 * DEC-NPC-07). `buildCreateNpcOp` merges the preset's patch into the document
 * being created and then forgets which preset it came from: nothing in the
 * payload names it, so there is no label to draw on a row and nothing to filter
 * by. That is why `NpcPreset.id` never reaches a document — the whole visible
 * consequence of DEC-NPC-07 is a property of this function.
 *
 * **The catalogue is not fixed here** (REQ-NPC-048, Q-NPC-02). What is fixed is
 * the CONCEPT and the extension point: a preset is a `{subtype, attitude, patch}`
 * and `registerNpcPreset` adds one without this tab changing. The three below are
 * a minimal internal list, placeholders until Q-NPC-02 decides who declares the
 * catalogue (the game system, like conditions, or the GM of the world).
 *
 * The pack audience is NOT re-implemented here (REQ-CPD-071): the server drops a
 * `gm` pack for whoever fails `isRolePrivileged`, so this module sends no
 * audience flag and simply searches what came back. The GM passes; the player
 * never gets this window at all.
 */

import type { Socket } from "socket.io-client";
import type { CompendiumImportResult, PackIndexEntry, PackManifest } from "@fusion/shared";
import { ATTITUDE_FLAG_PATH, isActorAttitude, type ActorAttitude } from "@fusion/shared";

import { sendOp } from "../docs/sendOp.js";
import { importToWorld, listPacks, searchPack } from "../compendium/compendiumApi.js";
import { entryDisplayName, entrySecondaryName } from "../compendium/compendiumBrowser.js";
import type { SupportedLocale } from "../i18n/i18n.js";
import { normalizeFolderId } from "./moveActor.js";
import { subtypeAcceptsAttitude } from "./npcAttitude.js";

// ---------------------------------------------------------------------------
// Which subtypes this tab authors (REQ-NPC-044)
// ---------------------------------------------------------------------------

/**
 * The only Actor subtypes the creation window offers (REQ-NPC-044).
 *
 * Deliberately a hand-written list rather than "everything the system declares":
 * the tab declares which subtypes are AUTHORED here (DEC-NPC-05), which is the
 * opposite of the condition chips, where the system's declaration rules
 * (DEC-CTT-11).
 */
export const NPC_CREATABLE_SUBTYPES = ["npc", "hazard"] as const;

export type NpcCreatableSubtype = (typeof NPC_CREATABLE_SUBTYPES)[number];

/** True for a subtype this tab is allowed to create. */
export function isNpcCreatableSubtype(value: unknown): value is NpcCreatableSubtype {
  return value === "npc" || value === "hazard";
}

/**
 * Which subtypes may carry an attitude (REQ-NPC-037, CA-NPC-010) is decided once,
 * in `npcAttitude.ts` — the module the row's control also asks. Re-exported here
 * so the creation window keeps its single import surface without a second answer
 * existing anywhere.
 */
export { subtypeAcceptsAttitude };

// ---------------------------------------------------------------------------
// Presets — the concept and the extension point, not the catalogue
// ---------------------------------------------------------------------------

/**
 * A creation shortcut that pre-fills the sheet of the actor being created and is
 * NOT written to it (REQ-NPC-045, DEC-NPC-07).
 */
export interface NpcPreset {
  /** Stable id, used by the form and by nothing that is persisted. */
  readonly id: string;
  /** The subtype the preset applies to — a preset is not offered to the others. */
  readonly subtype: NpcCreatableSubtype;
  /** i18n key of the label; the catalogue is pt-BR text, never a stored value. */
  readonly labelKey: string;
  /** The attitude the preset suggests, or null when it suggests none. */
  readonly attitude: ActorAttitude | null;
  /** Partial Actor document merged into the new actor's sheet. */
  readonly patch: Readonly<Record<string, unknown>>;
}

/**
 * The minimal internal list (Q-NPC-02 still owns the catalogue). Each entry is a
 * pre-fill and nothing else: a suggested attitude and a starting level, both of
 * which the GM overrides in the same window before creating.
 */
const PRESETS: NpcPreset[] = [
  {
    id: "merchant",
    subtype: "npc",
    labelKey: "FUSION.Npcs.Create.Preset.merchant",
    attitude: "neutral",
    patch: { system: { details: { level: { value: 1 } } } },
  },
  {
    id: "mount",
    subtype: "npc",
    labelKey: "FUSION.Npcs.Create.Preset.mount",
    attitude: "ally",
    patch: { system: { details: { level: { value: 1 } } } },
  },
  {
    id: "boss",
    subtype: "npc",
    labelKey: "FUSION.Npcs.Create.Preset.boss",
    attitude: "enemy",
    patch: { system: { details: { level: { value: 5 } } } },
  },
];

/**
 * REQ-NPC-048: the extension point. A preset added here shows up in the window
 * and is applied by `buildCreateNpcOp` without either of them changing — which
 * is the whole property the requirement asks for.
 */
export function registerNpcPreset(preset: NpcPreset): void {
  const at = PRESETS.findIndex((candidate) => candidate.id === preset.id);
  if (at >= 0) PRESETS[at] = preset;
  else PRESETS.push(preset);
}

/** The presets offered for a subtype, or all of them when none is given. */
export function listNpcPresets(subtype?: string): readonly NpcPreset[] {
  if (subtype === undefined) return [...PRESETS];
  return PRESETS.filter((preset) => preset.subtype === subtype);
}

/** The preset with this id, or null. */
export function findNpcPreset(id: string | null | undefined): NpcPreset | null {
  if (id === null || id === undefined || id.length === 0) return null;
  return PRESETS.find((preset) => preset.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Creating from scratch (REQ-NPC-043)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge of a preset patch into the document being built; `patch` wins. */
function mergePatch(
  base: Record<string, unknown>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergePatch(current, value)
        : structured(value);
  }
  return out;
}

/** Defensive copy so a registered preset cannot be mutated through the payload. */
function structured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structured);
  if (isPlainObject(value)) return mergePatch({}, value);
  return value;
}

export interface NpcCreateInput {
  /** Free text typed by the GM; trimmed here. */
  readonly name: string;
  /** One of {@link NPC_CREATABLE_SUBTYPES}; anything else is refused. */
  readonly subtype: string;
  /** Initial folder, or null for "Sem pasta" (REQ-NPC-047). */
  readonly folderId?: string | null | undefined;
  /** Initial attitude (REQ-NPC-047); omitted falls back to the preset's. */
  readonly attitude?: ActorAttitude | null | undefined;
  /** Preset id — used here and written nowhere (REQ-NPC-046). */
  readonly presetId?: string | null | undefined;
}

export interface CreateNpcOp {
  readonly type: "doc:create";
  readonly payload: {
    readonly documentType: "Actor";
    readonly data: readonly Record<string, unknown>[];
  };
}

/**
 * The `doc:create` for the "from scratch" door, or null when the form is not
 * fillable yet (empty name) or asks for a subtype this tab does not author
 * (REQ-NPC-044).
 *
 * The returned payload carries no trace of the preset (REQ-NPC-046): the patch
 * is merged, the id is dropped.
 */
export function buildCreateNpcOp(input: NpcCreateInput): CreateNpcOp | null {
  const name = input.name.trim();
  if (name.length === 0) return null;
  if (!isNpcCreatableSubtype(input.subtype)) return null;

  const preset = findNpcPreset(input.presetId);
  // A preset for another subtype is ignored rather than applied: the window only
  // offers the ones of the chosen subtype, and a stale id must not leak fields.
  const patch = preset !== null && preset.subtype === input.subtype ? preset.patch : {};

  let data: Record<string, unknown> = {
    name,
    type: input.subtype,
    folder: normalizeFolderId(input.folderId),
  };
  data = mergePatch(data, patch);

  const chosen = input.attitude !== undefined ? input.attitude : (preset?.attitude ?? null);
  if (chosen !== null && isActorAttitude(chosen) && subtypeAcceptsAttitude(input.subtype)) {
    // Nested, not dotted: `doc:create` stores the item as given — only the
    // update path expands dot paths.
    data = mergePatch(data, { flags: { fusion: { attitude: chosen } } });
  }

  return { type: "doc:create", payload: { documentType: "Actor", data: [data] } };
}

/** REQ-NPC-043: create the actor from scratch. Resolves false when refused. */
export async function createNpcFromScratch(
  socket: Socket,
  input: NpcCreateInput,
): Promise<boolean> {
  const op = buildCreateNpcOp(input);
  if (op === null) return false;
  await sendOp(socket, op);
  return true;
}

// ---------------------------------------------------------------------------
// The bestiary door (REQ-NPC-042)
// ---------------------------------------------------------------------------

/** One line of the bestiary result list. */
export interface BestiaryHit {
  readonly uuid: string;
  readonly packId: string;
  readonly packLabel: string;
  /** Display name for the active locale (pt-BR overlay when it exists). */
  readonly name: string;
  /** The EN name when the display name is a translation, else null. */
  readonly secondaryName: string | null;
  readonly subtype: string | null;
  readonly level: number | null;
}

/** Index paths a pack may carry the level under. */
const LEVEL_PATHS = ["system.level.value", "system.details.level.value"] as const;

/** Only the packs of actors are searched — a spell pack has no bestiary in it. */
export function actorPacks(packs: readonly PackManifest[]): PackManifest[] {
  return packs.filter((pack) => pack.documentType === "Actor");
}

/**
 * An entry the tab may list: only the subtypes it authors (REQ-NPC-044). An
 * actor pack may carry a `character` or a `loot`; neither is offered here, for
 * the same reasons the "from scratch" door does not offer them.
 */
export function isListableBestiaryEntry(entry: PackIndexEntry): boolean {
  return isNpcCreatableSubtype(entry.type);
}

/** The level an index entry declares, or null when it declares none. */
export function bestiaryLevel(entry: PackIndexEntry): number | null {
  for (const path of LEVEL_PATHS) {
    const value = entry.index[path];
    if (typeof value === "number") return value;
    if (isPlainObject(value) && typeof value["value"] === "number") return value["value"];
  }
  return null;
}

export function toBestiaryHit(
  entry: PackIndexEntry,
  pack: { readonly id: string; readonly label: string },
  locale: SupportedLocale,
): BestiaryHit {
  return {
    uuid: entry.uuid,
    packId: pack.id,
    packLabel: pack.label,
    name: entryDisplayName(entry, locale),
    secondaryName: entrySecondaryName(entry, locale),
    subtype: entry.type,
    level: bestiaryLevel(entry),
  };
}

/** Alphabetical in pt-BR, like every other list this tab draws (REQ-NPC-013). */
export function sortBestiaryHits(hits: readonly BestiaryHit[]): BestiaryHit[] {
  return [...hits].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** The packs of actors visible to this socket (the server applies the audience). */
export async function loadActorPacks(socket: Socket): Promise<PackManifest[]> {
  const result = await listPacks(socket, { documentType: "Actor" });
  return actorPacks(result.packs);
}

/**
 * REQ-NPC-042: search by name over the actor packs, one `compendium:search` per
 * pack (REQ-CMP-013). A pack that fails is skipped rather than taking the whole
 * search down — the GM asked for "a goblin", not for a report on one pack.
 */
export async function searchBestiary(
  socket: Socket,
  packs: readonly PackManifest[],
  text: string,
  locale: SupportedLocale,
  limit = 40,
): Promise<BestiaryHit[]> {
  const term = text.trim();
  if (term.length === 0) return [];

  const perPack = await Promise.all(
    actorPacks(packs).map(async (pack) => {
      try {
        const result = await searchPack(socket, { packId: pack.id, text: term });
        return result.entries
          .filter(isListableBestiaryEntry)
          .map((entry) => toBestiaryHit(entry, pack, locale));
      } catch {
        return [];
      }
    }),
  );

  return sortBestiaryHits(perPack.flat()).slice(0, limit);
}

export interface BestiaryImportOptions {
  /** Q-NPC-01: the imported actor lands in the folder chosen in the window. */
  readonly folderId?: string | null | undefined;
  /** REQ-NPC-047: the initial attitude, applied after the import. */
  readonly attitude?: ActorAttitude | null | undefined;
}

/**
 * REQ-NPC-042: import through the spec 16 mechanism and nothing else.
 *
 * The attitude is a second, separate write (`doc:update` of
 * `flags.fusion.attitude`, the very path G073 opened) rather than a field smuggled
 * into the import payload — the importer is not extended, it is consumed.
 */
export async function importFromBestiary(
  socket: Socket,
  hit: BestiaryHit,
  options: BestiaryImportOptions = {},
): Promise<CompendiumImportResult> {
  const folderId = normalizeFolderId(options.folderId);
  const result = await importToWorld(
    socket,
    [hit.uuid],
    folderId === null ? undefined : { folderId },
  );

  const attitude = options.attitude ?? null;
  if (
    attitude !== null &&
    isActorAttitude(attitude) &&
    subtypeAcceptsAttitude(hit.subtype) &&
    result.created.length > 0
  ) {
    await sendOp(socket, {
      type: "doc:update",
      payload: {
        documentType: "Actor",
        updates: result.created.map((id) => ({
          _id: id,
          diff: { [ATTITUDE_FLAG_PATH]: attitude },
        })),
      },
    });
  }

  return result;
}
