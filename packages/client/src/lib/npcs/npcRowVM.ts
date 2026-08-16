/**
 * npcRowVM.ts — the line of a non-playable, as pure data (spec 42 §5.2 and §5.4).
 *
 * Everything the NPCs tab decides about a row is decided here: what the line under
 * the name says (REQ-NPC-032), which conditions it shows (REQ-NPC-033), which
 * sub-characters hang off it (REQ-NPC-034), and how many presences the actor has in
 * the scenes and in which ones (REQ-NPC-036). `NpcsPanel.svelte` only draws the
 * result, so all of it is unit-testable in the client's node environment.
 *
 * Three rules run through the whole module:
 *
 *  - **No hit points, for any role** (REQ-NPC-031, DEC-NPC-10). Nothing here reads
 *    `system.attributes.hp`, and no shape in this file can carry it. The reason is
 *    not the 39's: when a presence in a scene is not bound to the actor
 *    (REQ-DOC-033), the base actor's hit points are a MOULD — five goblins on the
 *    map each have their own — so the number would describe nobody. There is no
 *    role branch either: the field does not exist, rather than being hidden.
 *  - **The title is the 39's title** (REQ-NPC-032, DEC-CTT-07). This module does not
 *    define a second field: it reads and writes `flags.fusion.title` through the
 *    very functions the Contatos tab uses, so a title written on one tab is the
 *    title read on the other.
 *  - **Knowledge is read, never moved** (REQ-NPC-070/071). The row carries how many
 *    characters know and how many glimpsed the actor, and nothing that could change
 *    it: the counting function is the 39's and the only place an edit exists is the
 *    "Quem conhece quem" window the footer opens (REQ-NPC-072).
 *  - **A presence is counted, never described** (REQ-NPC-036). The row carries how
 *    many and in which scenes; token ids, names, coordinates and the hidden flag
 *    never enter the shape, because the line is about the actor and none of that
 *    describes the actor. Spec 41 does not exist yet, which is exactly why this
 *    says "presence" and reads only `tokens[].actorId`.
 */

import type { ActorAttitude } from "@fusion/shared";
import { attitudeOfActor } from "./npcAttitude.js";
import type { ConditionDisplayContract, ConditionView } from "../conditions/conditionView.js";
import {
  CONTACT_TITLE_FLAG_PATH,
  buildContactConditions,
  contactTitleDiff,
  isSubCharacter,
  masterActorIdOf,
  matchesContactQuery,
  readContactTitle,
  COMPANION_ACTOR_SUBTYPE,
} from "../contacts/contactsVM.js";
import {
  compareByName,
  isNonPlayableActor,
  type FolderRow,
  type FolderedDoc,
} from "./folderTree.js";
import { npcKnowledgeCounts, playerCharacterIds, type NpcKnowledgeCounts } from "./npcKnowledge.js";

// ---------------------------------------------------------------------------
// The documents this module reads
// ---------------------------------------------------------------------------

/** An Actor as the world mirror holds it, narrowed to what a row needs. */
export interface NpcActorDoc {
  readonly _id: string;
  readonly name?: string | null;
  readonly type?: string | null;
  readonly img?: string | null;
  readonly folder?: string | null;
  readonly system?: Record<string, unknown> | undefined;
  readonly items?: readonly Record<string, unknown>[] | undefined;
  readonly flags?: Record<string, unknown> | undefined;
}

/** A Scene, narrowed to the one field a presence count needs (REQ-NPC-036). */
export interface NpcSceneDoc {
  readonly _id: string;
  readonly name?: string | null;
  readonly tokens?: readonly Record<string, unknown>[] | undefined;
}

/**
 * Where the free title lives — the SAME field spec 39 writes (REQ-NPC-032, §7).
 * Re-exported rather than redeclared so the two tabs cannot drift apart.
 */
export const NPC_TITLE_FLAG_PATH = CONTACT_TITLE_FLAG_PATH;

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

/** The line under the name: the free title, or the subtype and level (REQ-NPC-032). */
export interface NpcTitleLine {
  /** Ready-to-draw text of either kind. */
  readonly text: string;
  /**
   * `"title"` when the free title is filled, `"fallback"` when it dropped to the
   * subtype and level. The panel draws the two differently — this is the flag it
   * styles on, never the text itself.
   */
  readonly kind: "title" | "fallback";
  /** Subtype behind a fallback line; `""` when the title is filled. */
  readonly subtype: string;
  /** Level behind a fallback line; `null` when the system declared none. */
  readonly level: number | null;
}

/** One scene where the actor has at least one presence (REQ-NPC-036). */
export interface NpcScenePresence {
  readonly sceneId: string;
  readonly sceneName: string;
  /** How many presences of this actor the scene holds. Never which ones. */
  readonly count: number;
}

/** How many presences the actor has, and where (REQ-NPC-036). */
export interface NpcPresence {
  readonly total: number;
  readonly scenes: readonly NpcScenePresence[];
}

/** A sub-character, always drawn inside its owner's row (REQ-NPC-034). */
export interface NpcSubRow {
  readonly id: string;
  readonly name: string;
  readonly img: string | null;
  /** Kind of companion as the system stored it ("familiar", "animalCompanion", …). */
  readonly kind: string;
  readonly conditions: readonly ConditionView[];
}

/** One line of the NPCs tab. Carries no hit points at all (REQ-NPC-031). */
export interface NpcRow {
  readonly id: string;
  readonly name: string;
  readonly img: string | null;
  /** `npc` or `hazard` (spec 42 §3). */
  readonly subtype: string;
  /** Folder the actor sits in, or `null` for the "Sem pasta" group (REQ-NPC-014). */
  readonly folderId: string | null;
  readonly title: NpcTitleLine;
  /** The viewer may rewrite the title in the row itself (REQ-NPC-032). */
  readonly canEditTitle: boolean;
  /** Level or the system's equivalent identification (REQ-NPC-030); `null` if none. */
  readonly level: number | null;
  /** Attitude towards the whole party, or `null` when there is none (REQ-NPC-037). */
  readonly attitude: ActorAttitude | null;
  readonly conditions: readonly ConditionView[];
  readonly presence: NpcPresence;
  readonly subCharacters: readonly NpcSubRow[];
  /**
   * How many characters know and how many glimpsed this actor (REQ-NPC-070), in
   * READING only — the row carries no way to move it (REQ-NPC-071), and the field
   * that could is `null` wherever the knowledge map is not delivered.
   */
  readonly knowledge: NpcKnowledgeCounts | null;
}

// ---------------------------------------------------------------------------
// Reading a document
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Whether this Actor is one of the subtypes this tab lists (spec 42 §3) — the same
 * allow-list the folder tree counts with, so the tree and the rows never disagree
 * about who is in the tab.
 */
export function isNpcRowActor(doc: NpcActorDoc): boolean {
  return isNonPlayableActor({ _id: doc._id, type: text(doc.type) });
}

/** The folder id of an actor, with every spelling of "none" collapsed to `null`. */
export function folderIdOf(doc: NpcActorDoc): string | null {
  const raw = doc.folder;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Level as the 2e systems store it, tolerating both the bare number and the
 * `{ value }` wrapper. `null` when the system declared none, so the line degrades
 * to the subtype alone rather than to a zero nobody wrote.
 */
export function npcLevel(doc: NpcActorDoc): number | null {
  const raw = record(record(doc.system)["details"])["level"];
  if (typeof raw === "number") return raw;
  const wrapped = record(raw)["value"];
  return typeof wrapped === "number" ? wrapped : null;
}

/** The free title stored on the actor itself, trimmed; `""` when unset. */
export function readNpcTitle(doc: NpcActorDoc): string {
  return readContactTitle(doc);
}

/**
 * The diff that writes a title through the ordinary `doc:update` path — the same
 * dot-path the Contatos tab sends (REQ-NPC-032). The server decides whether it is
 * allowed (REQ-NPC-080); this only builds the payload.
 */
export function npcTitleDiff(title: string): Record<string, unknown> {
  return contactTitleDiff(title);
}

/**
 * The line under the name (REQ-NPC-032): the free title when filled, otherwise the
 * subtype and level, marked as the different thing it is.
 *
 * `subtypeLabel` translates the subtype — the panel passes the i18n resolver, and
 * the default identity keeps the module free of the translation table.
 */
export function resolveNpcTitleLine(
  doc: NpcActorDoc,
  subtypeLabel: (subtype: string) => string = (subtype) => subtype,
): NpcTitleLine {
  const title = readNpcTitle(doc);
  if (title.length > 0) return { text: title, kind: "title", subtype: "", level: null };

  const subtype = text(doc.type);
  const level = npcLevel(doc);
  const label = subtypeLabel(subtype);
  const assembled = level === null ? label : `${label} ${String(level)}`.trim();
  return { text: assembled, kind: "fallback", subtype, level };
}

/**
 * Whether a non-playable matches the search box (REQ-NPC-011): name and title, in
 * the client, with no request to the server. The same comparison the Contatos tab
 * runs — accent- and case-insensitive — because it is the same pair of fields.
 */
export function matchesNpcQuery(doc: NpcActorDoc, query: string): boolean {
  return matchesContactQuery(doc, query);
}

// ---------------------------------------------------------------------------
// Presences in the scenes (REQ-NPC-036)
// ---------------------------------------------------------------------------

/**
 * How many presences of an actor each scene holds, and how many in total.
 *
 * Counted from `tokens[].actorId`, which is a soft reference (REQ-DOC-031): a token
 * with no actor behind it belongs to nobody and is counted for nobody. Scenes with
 * no presence are not named at all — a list of every scene in the world would say
 * nothing about this actor.
 *
 * The scenes it sees are the ones the caller holds: the Mestre's mirror holds them
 * all, and a mirror that holds fewer produces a smaller count instead of a leak.
 */
export function countScenePresences(scenes: readonly NpcSceneDoc[], actorId: string): NpcPresence {
  const found: NpcScenePresence[] = [];
  let total = 0;

  for (const scene of scenes) {
    let count = 0;
    for (const token of scene.tokens ?? []) {
      if (text(record(token)["actorId"]) === actorId) count += 1;
    }
    if (count === 0) continue;
    total += count;
    found.push({ sceneId: scene._id, sceneName: text(scene.name), count });
  }

  return { total, scenes: found };
}

// ---------------------------------------------------------------------------
// Building the rows
// ---------------------------------------------------------------------------

/** Everything the rows need to be built. */
export interface NpcRowsInput {
  /** Every Actor the world mirror holds — filtering is this module's job. */
  readonly actors: readonly NpcActorDoc[];
  /** Every Scene the viewer holds; absent means no presence is known. */
  readonly scenes?: readonly NpcSceneDoc[];
  /** A privileged role may rewrite the title in the row (REQ-NPC-032). */
  readonly isPrivileged: boolean;
  readonly query?: string;
  /** Condition declarations of the active system (REQ-SYS-043), when available. */
  readonly conditionDeclarations?: ReadonlyMap<string, ConditionDisplayContract>;
  /** Translates a subtype for the fallback line (REQ-NPC-032). */
  readonly subtypeLabel?: (subtype: string) => string;
}

function buildSubRow(
  doc: NpcActorDoc,
  declarations: ReadonlyMap<string, ConditionDisplayContract> | undefined,
): NpcSubRow {
  const kind = text(record(doc.system)["companionKind"]) || COMPANION_ACTOR_SUBTYPE;
  return {
    id: doc._id,
    name: text(doc.name),
    img: doc.img ?? null,
    kind,
    conditions: buildContactConditions(doc, declarations),
  };
}

/**
 * Build one row per non-playable of the world (REQ-NPC-030).
 *
 * Sub-characters (REQ-NPC-034, DEC-CTT-06) are attached to the row of their master
 * and never become a row: a companion whose master is not listed here is dropped
 * with him. The search keeps a row whose master OR whose sub-character matches,
 * because the sub-character is part of that row rather than a line of its own.
 */
export function buildNpcRows(input: NpcRowsInput): NpcRow[] {
  const query = input.query ?? "";
  const scenes = input.scenes ?? [];
  const declarations = input.conditionDeclarations;

  const npcs = input.actors.filter(isNpcRowActor);
  const npcIds = new Set(npcs.map((doc) => doc._id));

  // REQ-NPC-070: knowledge is counted over the table's characters, and it is only
  // counted at all for a privileged role — the map reaches nobody else (REQ-NPC-083).
  const characterIds = input.isPrivileged ? playerCharacterIds(input.actors) : [];

  const subsByMaster = new Map<string, NpcActorDoc[]>();
  for (const doc of input.actors) {
    if (!isSubCharacter(doc)) continue;
    const masterId = masterActorIdOf(doc);
    if (masterId === null || !npcIds.has(masterId)) continue;
    const bucket = subsByMaster.get(masterId);
    if (bucket) bucket.push(doc);
    else subsByMaster.set(masterId, [doc]);
  }

  const rows: NpcRow[] = [];
  for (const doc of npcs) {
    const subs = subsByMaster.get(doc._id) ?? [];
    const matched = matchesNpcQuery(doc, query) || subs.some((sub) => matchesNpcQuery(sub, query));
    if (!matched) continue;

    rows.push({
      id: doc._id,
      name: text(doc.name),
      img: doc.img ?? null,
      subtype: text(doc.type),
      folderId: folderIdOf(doc),
      title: resolveNpcTitleLine(doc, input.subtypeLabel),
      canEditTitle: input.isPrivileged,
      level: npcLevel(doc),
      // REQ-NPC-037: read through the subtype gate, not straight off the flag —
      // a hazard shows no attitude even if a stray one survived on its document
      // (CA-NPC-010), and the row is the last place that could leak it.
      attitude: attitudeOfActor(doc),
      conditions: buildContactConditions(doc, declarations),
      presence: countScenePresences(scenes, doc._id),
      subCharacters: subs.map((sub) => buildSubRow(sub, declarations)).sort(compareByName),
      knowledge: input.isPrivileged ? npcKnowledgeCounts(doc, characterIds) : null,
    });
  }

  rows.sort(compareByName);
  return rows;
}

/** The rows sitting directly in a folder, alphabetically in pt-BR (REQ-NPC-013). */
export function rowsOfFolder(rows: readonly NpcRow[], folderId: string | null): NpcRow[] {
  return rows.filter((row) => row.folderId === folderId).sort(compareByName);
}

/**
 * The rows as the folder tree reads documents, so the tree is built out of exactly
 * what the search left visible (REQ-NPC-012) and the two cannot disagree about who
 * is on screen.
 */
export function toFolderedDocs(rows: readonly NpcRow[]): FolderedDoc[] {
  return rows.map((row) => ({
    _id: row.id,
    name: row.name,
    type: row.subtype,
    folder: row.folderId,
  }));
}

/**
 * Drop the folders a search emptied (REQ-NPC-012).
 *
 * A folder survives on its whole subtree, not on its own contents: hiding a parent
 * whose child holds the match would hide the match. With no search running nothing
 * is dropped, which is what makes an empty folder — the one the Mestre just created
 * to file something into — reappear the moment the field is cleared.
 */
export function foldersWithResults(rows: readonly FolderRow[], searching: boolean): FolderRow[] {
  if (!searching) return [...rows];
  return rows.filter((row) => row.node.subtreeCount > 0);
}
