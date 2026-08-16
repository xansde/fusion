/**
 * Document operation handlers — doc:create, doc:update, doc:delete.
 *
 * REQ-NET-020..026: server-authoritative CRUD with permission checks,
 * validation, persistence, seq assignment and broadcast.
 *
 * Permission rules (spec 05):
 *   - GM (role 4) or ASSISTANT (role 3): can do everything.
 *   - Scene create/update/delete: GM/ASSISTANT only.
 *   - Token embedded create/update/delete on a Scene: GM/ASSISTANT OR the
 *     player who owns the referenced Actor (OWNER level).
 *   - Other primary docs: GM/ASSISTANT for create/delete; OWNER for update.
 *
 * Embedded documents (tokens inside scenes) are addressed via
 *   DocCreatePayload.parent / DocDeletePayload.parent or
 *   DocUpdatePayload.updates[*].embedded
 *
 * REQ-NET-025: embedded doc ops must update the parent document and broadcast
 * the parent's new state with a fresh seq.
 *
 * Scene broadcast filtering (M1-C hidden tokens, M2-A secret doors, spec 44
 * scene list):
 *
 * EVERY Scene envelope is emitted per socket — never namespace-wide — because
 * for a Scene even the list of documents is privileged (REQ-CEN-071). The
 * filtering semantics are:
 *
 *   - GM/ASSISTANT sockets receive the full Scene, every scene, all hidden
 *     tokens and real secret doors included.
 *   - Player sockets receive only the scene ON AIR, with hidden tokens stripped
 *     and secret doors masked as plain walls; any other scene is dropped from
 *     the batch, leaving an envelope that only advances their seq.
 *
 * From a player's perspective this produces naturally correct event semantics:
 *   - Token created as hidden     → player receives nothing about that token
 *                                   (Scene update arrives without it).
 *   - Token toggled hidden→visible → player receives doc:update with Scene
 *                                   now including that token (create-like).
 *   - Token toggled visible→hidden → player receives doc:update with Scene
 *                                   no longer containing that token (delete-like).
 *   - Token moved while hidden    → player receives doc:update for the Scene
 *                                   but the token is absent, so position leaks
 *                                   nothing.
 *
 * We only pay the per-socket iteration cost when the operation actually
 * involves a Scene document.  All other doc types (Actor, Item, etc.) continue
 * to use the cheap namespace-wide emit path.
 */

import type { Namespace, Socket } from "socket.io";
import type { Logger } from "pino";
import type { HandlerFn, HandlerContext } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import {
  DocumentNotFoundError,
  DocumentValidationError,
  DocumentIdCollisionError,
} from "../../documents/store.js";
import { prunedPatch } from "../../documents/merge.js";
import {
  UserRole,
  resolveOwnership,
  OwnershipLevel,
  isRolePrivileged,
  testOwnership,
} from "../../documents/ownership.js";
import { detectFamiliarGrant } from "@fusion/system-pf2e";
import {
  DocCreatePayloadSchema,
  DocUpdatePayloadSchema,
  DocDeletePayloadSchema,
  TokenDocumentSchema,
} from "@fusion/shared";
import type { DocUpdatePayload, Ack, Ownership, Envelope, ErrorCode } from "@fusion/shared";
import { createDocumentId } from "@fusion/shared";
import {
  redactCombatDocsForNonPrivileged,
  redactSceneDocsForNonPrivileged,
  sceneIsInvisibleToRole,
  sceneIsOnAir,
} from "../redaction.js";
import {
  validateAugmentationSlotLimit,
  AUGMENTATION_SLOT_LIMIT,
  AUGMENTATION_SLOT_LIMIT_I18N_KEY,
  type AugmentationLikeItem,
} from "@fusion/system-sf2e";
import type { SystemModule } from "@fusion/system-api";
import { runActorDerivation } from "../derive-runner.js";

// ---------------------------------------------------------------------------
// Ack builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a success ack.
 *
 * requestId is intentionally omitted — the central dispatcher in
 * socket-manager.ts injects it from the incoming envelope for all acks.
 * Single source of truth: dispatcher owns requestId injection.
 */
function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map from documentType string (client-facing) to DocumentTable key. */
const TYPE_TO_TABLE: Record<string, string> = {
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal_entries",
  Macro: "macros",
  RollTable: "roll_tables",
  Playlist: "playlists",
  ChatMessage: "chat_messages",
  Combat: "combats",
  User: "users",
  Folder: "folders",
  Setting: "settings",
};

/**
 * Document types that only GM/ASSISTANT can create or delete.
 *
 * Combat is included (M2-C): the dedicated combat:* handlers are the normal
 * path, but the generic doc:create / doc:delete path must also reject non-GM
 * Combat creation/deletion as a defense-in-depth measure (DEC-CBT-06 + spec 05).
 */
const GM_ONLY_CREATE_DELETE = new Set([
  "Scene",
  "Actor",
  "Item",
  "Macro",
  "RollTable",
  "Playlist",
  "Combat",
]);

/**
 * Document types the generic doc:create / doc:update / doc:delete path must
 * never touch, mapped to the refusal message that names the operation that
 * owns them instead.
 *
 * `ChatMessage` (REQ-CHT-005, detailed by REQ-ACH-080..086): a message is never
 * deleted from the log — moderation of a single message IS invalidation, and
 * `chat:invalidate` is its one door. Posting is `chat:send`, which authors the
 * message server-side, resolves the speaker, runs the roll and redacts the
 * broadcast per recipient (REQ-CHT-004). The generic path does none of that: it
 * hands the client's payload to DocumentStore and broadcasts it namespace-wide.
 *
 * Leaving it open left the whole rule resting on a client that chose to obey
 * it, which REQ-ACH-090 says explicitly is not protection — verified by
 * execution before this guard existed: a GM emitting
 * `doc:delete {documentType: "ChatMessage", ids: [id]}` got `ok: true` and the
 * line was gone from the next `chat:history`.
 *
 * The refusal is by TYPE, not by field, on purpose. A field list (`invalid`,
 * `invalidatedBy`, `content`, ...) would still leave `whisper` writable, and
 * widening `whisper` on a stored message hands a private line to everyone the
 * next time `chat:history` reads the row — the same leak by another key. There
 * is no field of a ChatMessage this path is supposed to write, so the whole
 * type is refused and the chat handlers stay the single writer of
 * `chat_messages`.
 */
const GENERIC_PATH_FORBIDDEN_TYPES: Record<string, string> = {
  ChatMessage:
    "ChatMessage is not writable through doc:create/doc:update/doc:delete — use chat:send to post and chat:invalidate to moderate (REQ-CHT-005 / REQ-ACH-080)",
};

/**
 * Refuse an operation aimed at a document type the generic path does not own.
 * Checked against the payload's `documentType` AND the parent's type, so the
 * embedded routes cannot be used as a way around it.
 */
function rejectForbiddenDocumentType(documentType: string, parentType?: string): Ack<never> | null {
  const message =
    GENERIC_PATH_FORBIDDEN_TYPES[documentType] ??
    (parentType === undefined ? undefined : GENERIC_PATH_FORBIDDEN_TYPES[parentType]);
  return message === undefined ? null : ackError("PERMISSION_DENIED", message);
}

/**
 * Embedded collection names → their parent's documentType.
 *
 * Combatant is embedded in Combat (M2-C); the collection key is derived as
 * `embeddedType.toLowerCase() + "s"` → "combatants". Combatants are normally
 * managed via combat:addCombatant / combat:removeCombatant, but the mapping
 * keeps the generic embedded path consistent for parent resolution.
 *
 * Item is embedded in Actor (R10-C): a character sheet's inventory, spells,
 * feats, etc. are Items living in the Actor's `items[]` collection. Unlike
 * Token (embedded.id = the parent Scene's id) and Combatant (embedded.id =
 * the parent Combat's id), Item's embedded.id is the parent Actor's id.
 */
const EMBEDDED_PARENT_MAP: Record<string, string> = {
  Token: "Scene",
  Combatant: "Combat",
  Item: "Actor",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTable(documentType: string): string | null {
  return TYPE_TO_TABLE[documentType] ?? null;
}

function isPrivileged(role: number): boolean {
  return isRolePrivileged(role);
}

/**
 * True when this requester must be answered as if the parent scene did not
 * exist at all (REQ-CEN-071).
 *
 * Thin adapter over {@link sceneIsInvisibleToRole} (net/redaction.ts, the single
 * source of truth for this rule) that adds only the "is the parent a Scene at
 * all?" question the embedded paths need — `token:move` and `scene:doorState`
 * already know their parent is a Scene and call the predicate directly.
 */
function sceneParentIsInvisible(
  role: number,
  parentType: string,
  parentDoc: Record<string, unknown>,
): boolean {
  if (parentType !== "Scene") return false;
  return sceneIsInvisibleToRole(role, parentDoc);
}

/**
 * Parent document type → the collection key its embedded documents live under,
 * derived from EMBEDDED_PARENT_MAP so a new embedded type is covered the day it
 * is registered there. Same convention the embedded handlers use to build
 * `collectionKey` (`embeddedType.toLowerCase() + "s"`).
 */
const EMBEDDED_COLLECTION_BY_PARENT: Record<string, string> = Object.fromEntries(
  Object.entries(EMBEDDED_PARENT_MAP).map(([embeddedType, parentType]) => [
    parentType,
    `${embeddedType.toLowerCase()}s`,
  ]),
);

/**
 * Fields that doc:update must not write through the generic path, checked
 * before anything is persisted.
 *
 * `Scene.active` (T010): which scene is active is world state, not a field of a
 * document. Writing it here set the flag without updating
 * settings['_meta:activeScene'], without deactivating the previous scene and
 * without broadcasting — the second writer that made the two records disagree.
 * `world:activeScene` is the one way in.
 *
 * Embedded collections (`Scene.tokens`, `Actor.items`, `Combat.combatants`):
 * the generic path hands the diff straight to store.update(), with none of the
 * per-document ownership check, system-specific validation or redacted
 * broadcast that the embedded handlers provide. Replacing the array wholesale
 * bypassed all of it — verified by execution: a player who owns their own sheet
 * replaced `items` with an entry of an unknown type, wiping what was there, and
 * got ok:true.
 *
 * Only an *array* value is refused, and that is deliberate: an array is the one
 * shape that reaches the database through this path. Any other shape is already
 * rejected downstream, because deepMerge replaces the array with the object and
 * the document then fails schema validation — including dot-path operator forms
 * such as `items.+` / `items.-<id>`, which no client sends any more (the sheets
 * used to, and never worked; T034 moved them to embedded item CRUD). Refusing
 * them here as well would only trade one rejection for another, so the guard
 * stays narrow: it names the shape that would otherwise succeed.
 */
function rejectUnwritableField(
  documentType: string,
  expandedDiff: Record<string, unknown>,
): Ack<never> | null {
  if (documentType === "Scene" && "active" in expandedDiff) {
    return ackError(
      "VALIDATION_FAILED",
      "Scene.active is not writable through doc:update — use the world:activeScene operation",
    );
  }

  const collectionKey = EMBEDDED_COLLECTION_BY_PARENT[documentType];
  if (collectionKey !== undefined && Array.isArray(expandedDiff[collectionKey])) {
    return ackError(
      "VALIDATION_FAILED",
      `${documentType}.${collectionKey} is not writable as a whole through doc:update — use embedded operations (updates[].embedded)`,
    );
  }

  return null;
}

/** Extract the ownership map from a raw document, returning a default if absent. */
function getOwnershipFromDoc(doc: Record<string, unknown>): Ownership {
  if (
    doc["ownership"] &&
    typeof doc["ownership"] === "object" &&
    !Array.isArray(doc["ownership"])
  ) {
    return doc["ownership"] as Ownership;
  }
  return { default: OwnershipLevel.NONE };
}

// ---------------------------------------------------------------------------
// Player-owned companion (familiar) create/delete authorization (r17-P1)
// ---------------------------------------------------------------------------
//
// A PLAYER may create/delete an Actor of type "familiar" (a companion) WITHOUT
// a GM, but ONLY under a tightly-scoped set of conditions. Actor is otherwise
// in GM_ONLY_CREATE_DELETE (anti-cheat: players cannot mint arbitrary actors).
// The gate below is the sole exception and is deliberately narrow:
//
//   create — ALL must hold:
//     (a) the payload is a companion: type === "familiar", a `companionKind`
//         and a non-empty `system.masterActorId` are present;
//     (b) the master Actor exists AND the requester owns it at OWNER level
//         (testOwnership from documents/ownership.ts — never a duplicated
//         predicate);
//     (c) the world runs pf2e AND the master actually has a feat/rule that
//         grants a familiar (detectFamiliarGrant, read live from the master's
//         embedded items on the SERVER — the client CTA is advisory, this is
//         authoritative);
//     (d) the master has no familiar linked yet (1 familiar per master; a
//         second is rejected as a duplicate).
//     On success the created familiar's ownership is FORCED to the master's
//     ownership map (the master's owners become the familiar's owners), never
//     trusting a client-supplied ownership.
//
//   delete — the target Actor is a companion (type "familiar" + a
//     `system.masterActorId`) whose master the requester owns at OWNER level.
//
// Companion type is "familiar" in the MVP (spec 29: pet/animalCompanion share
// the same Actor type "familiar" with a `companionKind` discriminator).

/** The Actor subtype used for every companion in the MVP (spec 29). */
const COMPANION_ACTOR_TYPE = "familiar";

/** Read `system.masterActorId` from a raw doc, or null when absent/blank. */
function readMasterActorId(doc: Record<string, unknown>): string | null {
  const sys = doc["system"];
  if (!sys || typeof sys !== "object" || Array.isArray(sys)) return null;
  const raw = (sys as Record<string, unknown>)["masterActorId"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Read `system.companionKind` from a raw doc, or null when absent/blank. */
function readCompanionKind(doc: Record<string, unknown>): string | null {
  const sys = doc["system"];
  if (!sys || typeof sys !== "object" || Array.isArray(sys)) return null;
  const raw = (sys as Record<string, unknown>)["companionKind"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** True when a raw doc is a companion payload (type + kind + master link). */
function isCompanionDoc(doc: Record<string, unknown>): boolean {
  return (
    doc["type"] === COMPANION_ACTOR_TYPE &&
    readCompanionKind(doc) !== null &&
    readMasterActorId(doc) !== null
  );
}

/**
 * Whether the master already has a familiar linked (1 per master, condition d).
 * Scans the actors table filtered to companions and matches masterActorId.
 */
function masterHasFamiliar(store: DocumentStore, masterId: string): boolean {
  const familiars = store.getAll("actors", { type: COMPANION_ACTOR_TYPE });
  return familiars.some((f) => readMasterActorId(f) === masterId);
}

/** Outcome of the player-companion create authorization. */
type CompanionCreateAuth =
  | { ok: true; master: Record<string, unknown> }
  | { ok: false; code: ErrorCode; message: string };

/**
 * Authorize a single non-privileged companion create against conditions
 * (a)–(d). Only ever called for a doc that already passed isCompanionDoc.
 */
function authorizePlayerCompanionCreate(
  deps: Pick<DocHandlerDeps, "store" | "systemId">,
  ctx: HandlerContext,
  companion: Record<string, unknown>,
): CompanionCreateAuth {
  // (c-guard) Only pf2e worlds grant familiars; other systems keep Actor
  // strictly GM-only.
  if (deps.systemId !== "pf2e") {
    return { ok: false, code: "PERMISSION_DENIED", message: "Only GM/Assistant can create Actor" };
  }

  const masterId = readMasterActorId(companion);
  if (!masterId) {
    return { ok: false, code: "PERMISSION_DENIED", message: "Companion has no master" };
  }

  // (b) Master must exist and the requester must OWN it.
  let master: Record<string, unknown>;
  try {
    master = deps.store.get("actors", masterId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return { ok: false, code: "NOT_FOUND", message: `Master actor not found: ${masterId}` };
    }
    throw err;
  }
  const masterOwnership = getOwnershipFromDoc(master);
  if (!testOwnership(masterOwnership, ctx.userId, ctx.role, OwnershipLevel.OWNER)) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: "You do not own the master actor",
    };
  }

  // (c) Master must actually have a familiar-granting feat/rule.
  if (!detectFamiliarGrant(master).canHaveFamiliar) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: "Master has no feat that grants a familiar",
    };
  }

  // (d) One familiar per master.
  if (masterHasFamiliar(deps.store, masterId)) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Master already has a familiar",
    };
  }

  return { ok: true, master };
}

/**
 * Authorize a single non-privileged companion delete: the target must be a
 * companion whose master the requester owns at OWNER level.
 */
function authorizePlayerCompanionDelete(
  deps: Pick<DocHandlerDeps, "store">,
  ctx: HandlerContext,
  target: Record<string, unknown>,
): { ok: true } | { ok: false; code: ErrorCode; message: string } {
  if (!isCompanionDoc(target)) {
    return { ok: false, code: "PERMISSION_DENIED", message: "Only GM/Assistant can delete Actor" };
  }
  const masterId = readMasterActorId(target);
  if (!masterId) {
    return { ok: false, code: "PERMISSION_DENIED", message: "Companion has no master" };
  }
  let master: Record<string, unknown>;
  try {
    master = deps.store.get("actors", masterId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      // Orphan companion (dangling master) — only a GM may delete it.
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        message: "Only GM/Assistant can delete Actor",
      };
    }
    throw err;
  }
  const masterOwnership = getOwnershipFromDoc(master);
  if (!testOwnership(masterOwnership, ctx.userId, ctx.role, OwnershipLevel.OWNER)) {
    return { ok: false, code: "PERMISSION_DENIED", message: "You do not own the master actor" };
  }
  return { ok: true };
}

/**
 * Result of validating an embedded Item document against the active
 * system's registered data models (see validateEmbeddedItemForSystem).
 */
interface ItemSystemValidation {
  ok: true;
  /** The item with its `system` subtree replaced by the schema-parsed value
   *  (defaults applied, unknown keys stripped per the model's own schema). */
  doc: Record<string, unknown>;
}
interface ItemSystemValidationError {
  ok: false;
  message: string;
}

/**
 * Validate an embedded Item document's `type` + `system` subtree against the
 * active system's registered data models (SystemModule.models, keyed
 * "Item:<subtype>" — see packages/system-api/src/system-module.ts).
 *
 * REQ-DOC (R10-C): closes the gap where embedded Item create/update
 * accepted arbitrary `system` payloads with zero schema validation. Rules:
 *   - `manifest.documentTypes.Item` is a CLOSED list: an item `type` not
 *     declared there is rejected (unknown subtype).
 *   - A declared subtype MUST have a registered SystemDataModel (guaranteed
 *     by validateSystemModule/REQ-SYS-011 as a CI gate on every system
 *     package, but we still guard defensively here rather than throw).
 *   - Only `system` is validated against the model's Zod schema — engine
 *     fields (name, ownership, ...) are already covered by DocumentStore's
 *     own schema on the primary Item path, and embedded Items are never
 *     written through DocumentStore.create/update directly (they're spliced
 *     into the parent Actor's `items[]` array), so this is the only place
 *     that ever validates them.
 *
 * No systemModule available (systemId unset, stub system, or test deps that
 * don't wire one) → validation is skipped entirely (returns ok:true
 * unchanged), preserving the pre-R10-C behavior for callers that don't care.
 */
function validateEmbeddedItemForSystem(
  systemModule: SystemModule | undefined,
  raw: Record<string, unknown>,
): ItemSystemValidation | ItemSystemValidationError {
  if (!systemModule) {
    return { ok: true, doc: raw };
  }

  const itemTypes = systemModule.manifest.documentTypes["Item"];
  if (!itemTypes) {
    // System doesn't declare any Item subtypes at all — nothing to validate
    // against; skip (defense-in-depth, should not happen for pf2e/sf2e).
    return { ok: true, doc: raw };
  }

  const subtype = typeof raw["type"] === "string" ? raw["type"] : undefined;
  if (!subtype || !itemTypes.includes(subtype)) {
    return {
      ok: false,
      message: `Unknown Item type "${String(raw["type"])}" for system "${systemModule.manifest.id}" (known types: ${itemTypes.join(", ")})`,
    };
  }

  const model = systemModule.models.get(`Item:${subtype}`);
  if (!model) {
    return {
      ok: false,
      message: `Item type "${subtype}" is declared by system "${systemModule.manifest.id}" but has no registered data model`,
    };
  }

  const systemData = raw["system"] ?? {};
  const result = model.schema.safeParse(systemData);
  if (!result.success) {
    return {
      ok: false,
      message: `Invalid system data for Item type "${subtype}": ${result.error.message}`,
    };
  }

  return { ok: true, doc: { ...raw, system: result.data } };
}

/**
 * Build a broadcast envelope for an op and push it to the buffer.
 */
function buildBroadcastEnvelope(
  type: "doc:create" | "doc:update" | "doc:delete",
  payload: unknown,
  seq: number,
): Envelope {
  return {
    type,
    seq,
    ts: Date.now(),
    payload,
  };
}

// ---------------------------------------------------------------------------
// Context needed by all doc handlers
// ---------------------------------------------------------------------------

export interface DocHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
  /**
   * The world's game system id (e.g. "pf2e", "sf2e"), when known.
   * Used for system-specific server-side validation that cannot go through
   * the (currently unwired) system-api hook bus — e.g. SF2e's augmentation
   * slot-limit check in handleEmbeddedCreate. Optional because not every
   * caller (tests, other systems) needs to supply it.
   */
  systemId?: string;
  /**
   * The world's resolved SystemModule (from SystemRegistry.tryGet(systemId)),
   * when the system package is available. Used to invoke the M3-C derivation
   * pipeline (SystemModule.deriveSteps) on Actor create/update so
   * `system.derived` is populated for the sheet — see derive-runner.ts.
   * Optional — undefined disables derivation entirely (stub system, or a
   * system package that registers no DeriveSteps).
   */
  systemModule?: SystemModule;
  /**
   * Optional structured logger. When provided, a derivation failure for a
   * single malformed Actor document is logged at `warn` level instead of
   * being silently swallowed — see recomputeDerivedIfNeeded.
   */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Derivation recompute helper (WIRING-DERIVE)
// ---------------------------------------------------------------------------

/**
 * Recompute `system.derived` for a persisted Actor document and, if it
 * changed, persist the recomputed subtree via a second store.update() before
 * the caller broadcasts.
 *
 * Only acts on `documentType === "Actor"` when a systemModule is available;
 * every other call is a no-op returning the input doc unchanged. Never
 * touches authored fields — `runActorDerivation` writes exclusively to
 * `doc.system.derived` (see derive-runner.ts docstring for the full
 * contract).
 *
 * The second store.update() bumps `_stats.version` again and re-runs
 * validation, but that is intentional: the persisted document must reflect
 * the derived state that gets broadcast, and `system` is a passthrough
 * z.record so validation always succeeds for these writes.
 *
 * ROBUSTNESS (audit issue 1): a minimal-but-schema-valid Actor doc (e.g.
 * `{name, type: "character"}` with no `system.abilities`/`attributes`) is
 * ACCEPTED by the store's passthrough `system` schema, but the pf2e/sf2e
 * DeriveSteps assume those fields exist and throw a TypeError when they
 * don't. Because this helper runs AFTER the document is already persisted
 * (doc:create/doc:update already committed the write), an uncaught throw
 * here would surface as INTERNAL_ERROR to the client with a ghost write
 * already in the DB (persisted but never broadcast). Every call is
 * therefore wrapped: on failure we log a warning and return the doc
 * UNCHANGED (no derived, or whatever partial derived a previous successful
 * call already produced) rather than let the exception propagate.
 *
 * AUTHORSHIP (audit M4.5-corretor, BAIXA): the second store.update() below
 * MUST be given the same `authorCtx` the caller used for its own write —
 * otherwise DocumentStore.update falls back to `defaultAuthor` and
 * `_stats.lastModifiedBy` on the persisted/broadcast document silently
 * reverts to the default author even though a real, identified user
 * (ctx.userId) triggered the change. Callers therefore pass their resolved
 * `authorCtx` through as the 4th argument.
 */
function recomputeDerivedIfNeeded(
  deps: Pick<DocHandlerDeps, "store" | "systemModule" | "logger">,
  documentType: string,
  doc: Record<string, unknown>,
  authorCtx?: { userId: string },
): Record<string, unknown> {
  if (documentType !== "Actor" || !deps.systemModule) return doc;

  try {
    // Deep-clone `system` before handing it to runActorDerivation (audit
    // issue 5): the DeriveSteps' documented contract is "only ever writes to
    // doc.system.derived" (see derive-runner.ts docstring), but several
    // steps ALSO write cache fields outside `derived` for their own internal
    // consumption (e.g. pf2e/sf2e stepCharAbilityMods mirrors the computed
    // mod onto `system.abilities.<ability>.mod`, and stepCharStrikes reads
    // that same cached mod back). A shallow clone of `system` still shares
    // nested objects like `system.abilities.str` by reference with the
    // document already returned by the store — mutating `.mod` on it would
    // silently corrupt an object that may be referenced elsewhere (e.g.
    // computeDiff snapshots taken earlier in the same handler call for other
    // items in a batch). A full structuredClone removes that hazard; only
    // `system.derived` is ever read back out and persisted, so the clone's
    // cost (proportional to one actor's `system` subtree) is paid once per
    // recompute and nothing else from the clone is retained.
    const workingDoc: Record<string, unknown> = { ...doc };
    const sys = doc["system"];
    workingDoc["system"] =
      sys && typeof sys === "object" && !Array.isArray(sys)
        ? structuredClone(sys as Record<string, unknown>)
        : {};

    const derived = runActorDerivation(workingDoc, deps.systemModule);
    if (!derived) return doc;

    const id = doc["_id"] as string | undefined;
    if (!id) return doc;

    const newDerived = (workingDoc["system"] as Record<string, unknown>)["derived"];

    // PRUNING (r24 S2): store.update() deep-merges, and deepMerge PRESERVES
    // any key the patch does not mention. Patching only the new derived is
    // therefore purely additive — `system.derived` grew forever and never
    // shed a key the recompute stopped producing. That is how a Lore skill
    // dropped from `system.skills` (background swap) kept living in
    // `derived.skills` and kept rendering on the sheet.
    //
    // prunedPatch compares the derived ALREADY on the document (`doc` is the
    // untouched original — `workingDoc.system` is a structuredClone, so the
    // derivation mutated the copy, never this one) with the freshly computed
    // one, and adds an explicit null for every vanished key. null inside
    // `system` is deleteKey (REQ-DOC-037), so the single store.update()
    // below both updates and prunes: no second write, no second broadcast,
    // and no window where the sheet has no derived at all.
    const oldSystem = doc["system"];
    const oldDerived =
      oldSystem && typeof oldSystem === "object" && !Array.isArray(oldSystem)
        ? (oldSystem as Record<string, unknown>)["derived"]
        : undefined;
    const derivedPatch = prunedPatch(oldDerived, newDerived);

    const patched = deps.store.update(
      "actors",
      id,
      { system: { derived: derivedPatch } },
      authorCtx,
    );
    return patched ?? doc;
  } catch (err) {
    deps.logger?.warn(
      { err, documentId: doc["_id"], documentType },
      "Actor derivation failed for a single document — skipping derived, document persists without it",
    );
    return doc;
  }
}

// ---------------------------------------------------------------------------
// doc:create handler factory
// ---------------------------------------------------------------------------

export function buildDocCreateHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DocCreatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const payload = parsed.data;
    const { documentType, data, parent } = payload;

    // Types the chat handlers own (REQ-CHT-005 / REQ-ACH-080 / REQ-ACH-090).
    const forbidden = rejectForbiddenDocumentType(documentType, parent?.type);
    if (forbidden) return forbidden;

    // Embedded token creation (tokens inside a Scene)
    if (parent) {
      return handleEmbeddedCreate(deps, ctx, documentType, data, parent);
    }

    // Primary document creation
    const table = resolveTable(documentType);
    if (!table) {
      return ackError("VALIDATION_FAILED", `Unknown documentType: ${documentType}`);
    }

    // REQ-CEN-065: creating a scene does NOT put it on air. `active` is a mirror of
    // the single source of truth (`_meta:activeScene`, DEC-CEN-02) and only the
    // dedicated `world:activeScene` operation may move it — the same rule
    // `rejectUnwritableField` already enforces for doc:update (REQ-CEN-042). Without
    // this the create path was a way in: a forged `active: true` produced a scene the
    // pointer did not know about, which `sceneIsOnAir` (the redaction predicate) then
    // treated as visible to every player.
    //
    // Only a TRUTHY `active` is refused: `active: false` is the value a new scene has
    // anyway, and every existing caller spells it out.
    if (documentType === "Scene") {
      for (const item of data) {
        if (
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>)["active"]
        ) {
          return ackError(
            "VALIDATION_FAILED",
            "Scene.active is not writable through doc:create — use the world:activeScene operation",
          );
        }
      }
    }

    // Permission check: GM_ONLY_CREATE_DELETE types require GM/ASSISTANT.
    //
    // EXCEPTION (r17-P1): a non-privileged PLAYER may create Actor(s) that are
    // companions (familiars) linked to a master they own. Each item in the
    // batch must individually pass authorizePlayerCompanionCreate; the master's
    // ownership map is captured so we can force it onto the created familiar
    // (never trusting a client-supplied ownership). Any non-companion Actor in
    // the batch, or a companion that fails a condition, falls back to the
    // GM-only denial.
    const forcedOwnership = new Map<number, Ownership>();
    // True once the batch is fully authorized as a player companion create —
    // it then bypasses the generic TRUSTED role floor below (the companion gate
    // is a strictly stronger check: OWNER of a granting master, no duplicate).
    let authorizedCompanionBatch = false;
    if (GM_ONLY_CREATE_DELETE.has(documentType) && !isPrivileged(ctx.role)) {
      if (documentType !== "Actor") {
        return ackError("PERMISSION_DENIED", `Only GM/Assistant can create ${documentType}`);
      }
      // Every item must be an authorized companion, else deny the whole batch.
      for (let i = 0; i < data.length; i++) {
        const item = data[i] as Record<string, unknown>;
        if (!isCompanionDoc(item)) {
          return ackError("PERMISSION_DENIED", `Only GM/Assistant can create ${documentType}`);
        }
        const auth = authorizePlayerCompanionCreate(deps, ctx, item);
        if (!auth.ok) {
          return ackError(auth.code, auth.message);
        }
        // Force the familiar's ownership to mirror the master's owners.
        forcedOwnership.set(i, getOwnershipFromDoc(auth.master));
      }
      authorizedCompanionBatch = data.length > 0;
    }

    // Non-privileged users can create their own documents for allowed types
    // (e.g., Actor requires ACTOR_CREATE permission — simplified here to
    // TRUSTED+). Skipped for an already-authorized player companion batch
    // (r17-P1): a plain PLAYER owning a granting master is authorized above.
    if (
      !authorizedCompanionBatch &&
      !isPrivileged(ctx.role) && // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      ctx.role < UserRole.TRUSTED
    ) {
      return ackError("PERMISSION_DENIED", "Insufficient role to create documents");
    }

    const authorCtx = { userId: ctx.userId };
    const created: Record<string, unknown>[] = [];

    try {
      for (let i = 0; i < data.length; i++) {
        const rawItem = data[i];
        // WIRING-DERIVE (audit issue 4): system.derived is server-computed
        // only. doc:update already strips a client-supplied value (see
        // stripSystemDerived below); doc:create must apply the same
        // stripping to its `data` items, otherwise a forged
        // `{system: {derived: {...}}}` payload persists verbatim for any
        // Actor subtype that has no registered DeriveSteps (recomputeDerived
        // IfNeeded is a no-op for those — nothing overwrites the forged
        // value). stripSystemDerived operates on a dot-path-or-nested diff
        // shape, which a create payload's item already satisfies (nested
        // `system.derived` key) even though it is a full document, not a
        // partial diff.
        let item: Record<string, unknown> = rawItem as Record<string, unknown>;
        if (documentType === "Actor") {
          item = stripSystemDerived(item);
        }
        // r17-P1: for a player-authorized companion create, force the master's
        // ownership map onto the payload so the master's owners own the
        // familiar and a forged/absent ownership cannot widen access.
        const forced = forcedOwnership.get(i);
        if (forced) {
          item = { ...item, ownership: forced };
        }
        let doc = deps.store.create(table as never, item, authorCtx);
        // WIRING-DERIVE: populate system.derived for newly created Actors.
        doc = recomputeDerivedIfNeeded(deps, documentType, doc, authorCtx);
        created.push(doc);
      }
    } catch (err) {
      if (err instanceof DocumentValidationError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      if (err instanceof DocumentIdCollisionError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      throw err;
    }

    const seq = deps.seqStore.next();
    const broadcastPayload = { documentType, documents: created };
    const envelope = buildBroadcastEnvelope("doc:create", broadcastPayload, seq);
    deps.opBuffer.push(envelope);

    // Broadcast to world (per-socket hidden-token filtering applied for Scene).
    broadcastToWorld(deps.ns, envelope, documentType);

    return ackOk({ documentType, documents: created }, seq);
  };
}

// ---------------------------------------------------------------------------
// doc:update handler factory
// ---------------------------------------------------------------------------

export function buildDocUpdateHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DocUpdatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const payload = parsed.data;
    const { documentType, updates } = payload;

    // Types the chat handlers own (REQ-CHT-005 / REQ-ACH-080 / REQ-ACH-090).
    // Checked against every embedded type in the batch as well, so an
    // `updates[].embedded` entry cannot smuggle one past the top-level type.
    const forbidden = rejectForbiddenDocumentType(documentType);
    if (forbidden) return forbidden;
    for (const upd of updates) {
      const forbiddenEmbedded = rejectForbiddenDocumentType(upd.embedded?.type ?? documentType);
      if (forbiddenEmbedded) return forbiddenEmbedded;
    }

    // Check for embedded updates (tokens inside scenes)
    const hasEmbedded = updates.some((u) => u.embedded);
    if (hasEmbedded) {
      // All updates in the batch must be embedded OR all primary — a mixed
      // batch cannot be routed to a single code path: handleEmbeddedUpdate
      // below only ever processes `embedded` entries (`if (!upd.embedded)
      // continue;`), so a mixed batch would silently drop every primary
      // entry while the ack still comes back ok:true. Reject explicitly
      // instead of half-processing (found by execution, not by the spec).
      const allEmbedded = updates.every((u) => u.embedded);
      if (!allEmbedded) {
        return ackError(
          "VALIDATION_FAILED",
          "doc:update batch cannot mix primary and embedded updates — send them as separate batches",
        );
      }
      return handleEmbeddedUpdate(deps, ctx, documentType, updates);
    }

    const table = resolveTable(documentType);
    if (!table) {
      return ackError("VALIDATION_FAILED", `Unknown documentType: ${documentType}`);
    }

    // REQ-CEN-070: editing a Scene is an action of the GM's scene panel, and
    // spec 44 §5.8 makes the role the gate — ownership of the Scene document is
    // NOT a licence to write it (DEC-CEN-11: the boundary is the server, not
    // the missing icon on the rail).
    //
    // REQ-CEN-071 / REQ-CEN-073: the refusal is worded exactly like the answer
    // for an id that never existed, and is decided BEFORE the store lookup.
    // Replying PERMISSION_DENIED for a scene that exists and NOT_FOUND for one
    // that does not would turn this handler into an existence oracle over ids —
    // and learning that a scene is there is the first half of learning where the
    // campaign has not gone yet.
    if (documentType === "Scene" && !isPrivileged(ctx.role) && updates.length > 0) {
      const probed = updates[0]?._id ?? "";
      return ackError("NOT_FOUND", `Document not found: ${documentType}/${probed}`);
    }

    // Pre-flight: judge the whole batch before writing anything. The loop below
    // persists as it goes, so a rejection fired mid-loop would leave the
    // earlier entries written, skip the broadcast, and still ack ok:false —
    // server and clients diverging in silence until the next resync.
    //
    // The order of the checks is the order of the answers the caller deserves:
    // "that document is not there", then "it is not yours", then "you did not
    // say which version you saw". Telling someone without access that a field
    // is missing would also confirm the document exists.
    const loaded = new Map<string, Record<string, unknown>>();
    for (const upd of updates) {
      let existing: Record<string, unknown>;
      try {
        existing = deps.store.get(table as never, upd._id);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          return ackError("NOT_FOUND", `Document not found: ${documentType}/${upd._id}`);
        }
        throw err;
      }
      loaded.set(upd._id, existing);

      // Must be GM/ASSISTANT or OWNER of the document.
      if (!isPrivileged(ctx.role)) {
        const ownership = getOwnershipFromDoc(existing);
        const level = resolveOwnership(ownership, ctx.userId, ctx.role);
        if (level < OwnershipLevel.OWNER) {
          return ackError("PERMISSION_DENIED", `No OWNER access to ${documentType}/${upd._id}`);
        }
      }

      // T013: expectedVersion is mandatory on the primary path for a
      // non-privileged writer. GM/ASSISTANT keep the opt-in behaviour — several
      // server-side writers still bump `_stats.version` without ever setting
      // the field, and that traffic is not client-authored.
      //
      // Every player write funnels through sendOp.ts, which fills the field
      // from the client's DocumentMirror before the op leaves the browser. One
      // that still arrives without it is either hand-built or comes from a
      // client whose mirror never held the document — neither should be able to
      // last-write-win over another player's edit in silence.
      if (!isPrivileged(ctx.role) && upd.expectedVersion === undefined) {
        return ackError(
          "VALIDATION_FAILED",
          `expectedVersion is required for ${documentType}/${upd._id} — reload the document and retry`,
        );
      }

      const rejection = rejectUnwritableField(documentType, applyDotPathDiff({}, upd.diff));
      if (rejection) return rejection;
    }

    const authorCtx = { userId: ctx.userId };
    const updated: Record<string, unknown>[] = [];

    for (const upd of updates) {
      // Loaded during pre-flight, where NOT_FOUND and PERMISSION_DENIED were
      // already answered for every entry in the batch.
      const existing = loaded.get(upd._id) as Record<string, unknown>;

      // STALE_WRITE check: expectedVersion must match _stats.version (monotonic
      // write counter, starts at 1 and increments on every successful update).
      // Do NOT compare against modifiedTime — it is a wall-clock timestamp
      // which lives in a different numeric space and is not monotonically
      // reliable for concurrent-write detection.
      //
      // T013: the comparison no longer short-circuits when the STORED
      // document has no _stats.version. Before, ANY expectedVersion the
      // client sent was silently accepted whenever the server-side value was
      // missing/undefined — defeating the whole point of an optimistic-
      // concurrency check. Treating "no stored version" as 0 closes that
      // silent bypass. A document actually missing _stats.version (a
      // hand-seeded/legacy document that never went through the normal
      // create path — buildCreateStats always sets version:1) is a separate,
      // pre-existing bug in documents/store.ts's buildUpdateStats (it computes
      // `existing.version + 1` = NaN, which then fails schema validation on
      // every subsequent write) — out of scope for this file; reported
      // separately rather than fixed here since the fix lives outside this
      // handler's file boundary.
      if (upd.expectedVersion !== undefined) {
        const stats = existing["_stats"] as Record<string, unknown> | undefined;
        const rawVersion = stats?.["version"];
        const currentVersion = typeof rawVersion === "number" ? rawVersion : 0;
        if (currentVersion !== upd.expectedVersion) {
          return ackError("STALE_WRITE", "Document has been modified since last read");
        }
      }

      // Apply patch — expand dot-path keys (e.g. "grid.size") into nested
      // objects before handing off to the store.  This ensures that
      // {"grid.size": 140} is treated as {grid: {size: 140}} rather than
      // being stored as a literal key "grid.size" (which Zod would silently
      // discard on read-back).  The same expansion is already applied in the
      // embedded path via applyDotPathDiff in handleEmbeddedUpdate.
      let expandedDiff = applyDotPathDiff({}, upd.diff);

      // WIRING-DERIVE: system.derived is server-computed only — strip any
      // client-supplied value so a stale/forged autosave payload can never
      // overwrite it (recomputeDerivedIfNeeded below is the sole writer).
      if (documentType === "Actor") {
        expandedDiff = stripSystemDerived(expandedDiff);
      }
      let result: Record<string, unknown> | null;
      try {
        result = deps.store.update(table as never, upd._id, expandedDiff, authorCtx);
      } catch (err) {
        if (err instanceof DocumentValidationError) {
          return ackError("VALIDATION_FAILED", err.message);
        }
        if (err instanceof DocumentNotFoundError) {
          return ackError("NOT_FOUND", `Document not found: ${documentType}/${upd._id}`);
        }
        throw err;
      }

      if (result !== null) {
        // WIRING-DERIVE: keep system.derived in sync with authored-field updates
        // (e.g. an ability score edit changes AC/saves/skills totals).
        result = recomputeDerivedIfNeeded(deps, documentType, result, authorCtx);
        updated.push(result);
      }
    }

    if (updated.length === 0) {
      // All no-ops — return current seq without incrementing
      return ackOk({ documentType, documents: [] }, deps.seqStore.peek());
    }

    const seq = deps.seqStore.next();
    const broadcastPayload = { documentType, documents: updated };
    const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
    deps.opBuffer.push(envelope);

    broadcastToWorld(deps.ns, envelope, documentType);

    return ackOk({ documentType, documents: updated }, seq);
  };
}

// ---------------------------------------------------------------------------
// doc:delete handler factory
// ---------------------------------------------------------------------------

export function buildDocDeleteHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DocDeletePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const payload = parsed.data;
    const { documentType, ids, parent } = payload;

    // Types the chat handlers own. A ChatMessage is never deleted from the log:
    // moderation of a single message is invalidation (REQ-CHT-005 /
    // REQ-ACH-080), and REQ-ACH-090 says the check has to live HERE, not in the
    // client that decides whether to draw the button.
    const forbidden = rejectForbiddenDocumentType(documentType, parent?.type);
    if (forbidden) return forbidden;

    // Embedded token deletion
    if (parent) {
      return handleEmbeddedDelete(deps, ctx, documentType, ids, parent);
    }

    const table = resolveTable(documentType);
    if (!table) {
      return ackError("VALIDATION_FAILED", `Unknown documentType: ${documentType}`);
    }

    // Permission check for delete: GM/ASSISTANT only for important types.
    //
    // EXCEPTION (r17-P1): a non-privileged PLAYER may delete their OWN
    // companion (a familiar Actor linked to a master they own). Each id in the
    // batch must be such a companion; anything else falls back to the GM-only
    // denial. This is checked here (before the store loop) so a mixed batch of
    // a companion + an ordinary GM-only Actor is rejected atomically.
    if (GM_ONLY_CREATE_DELETE.has(documentType) && !isPrivileged(ctx.role)) {
      if (documentType !== "Actor") {
        return ackError("PERMISSION_DENIED", `Only GM/Assistant can delete ${documentType}`);
      }
      for (const id of ids) {
        let target: Record<string, unknown>;
        try {
          target = deps.store.get("actors", id);
        } catch (err) {
          if (err instanceof DocumentNotFoundError) {
            return ackError("NOT_FOUND", `Document not found: ${documentType}/${id}`);
          }
          throw err;
        }
        const auth = authorizePlayerCompanionDelete(deps, ctx, target);
        if (!auth.ok) {
          return ackError(auth.code, auth.message);
        }
      }
    }

    // For non-GM types: non-privileged must own the document.
    // (GM_ONLY types are already fully authorized above; this covers the
    // remaining doc types where plain OWNER access is the delete rule.)
    if (!isPrivileged(ctx.role) && !GM_ONLY_CREATE_DELETE.has(documentType)) {
      for (const id of ids) {
        let existing: Record<string, unknown>;
        try {
          existing = deps.store.get(table as never, id);
        } catch (err) {
          if (err instanceof DocumentNotFoundError) {
            return ackError("NOT_FOUND", `Document not found: ${documentType}/${id}`);
          }
          throw err;
        }
        const ownership = getOwnershipFromDoc(existing);
        const level = resolveOwnership(ownership, ctx.userId, ctx.role);
        if (level < OwnershipLevel.OWNER) {
          return ackError("PERMISSION_DENIED", `No OWNER access to ${documentType}/${id}`);
        }
      }
    }

    // REQ-CEN-071: which scenes were on air must be read BEFORE the rows go —
    // after the delete the `active` mirror is gone with the document, and the
    // broadcast would have no way to tell the scene the players already knew
    // from the ones whose very existence is privileged.
    const onAirSceneIds = new Set<string>();
    if (documentType === "Scene") {
      for (const id of ids) {
        try {
          if (sceneIsOnAir(deps.store.get("scenes", id))) onAirSceneIds.add(id);
        } catch {
          // Missing document — the delete loop below reports NOT_FOUND.
        }
      }

      // REQ-CEN-064: the scene ON AIR is not deletable. The destructive operation
      // cannot be the one that resolves the state (DEC-CEN-07) — without this guard
      // one click of housekeeping drops the whole table onto the waiting screen, and
      // nothing brings the scene back. The GM has to put another scene on air first
      // (`world:activeScene`, the single writer of DEC-CEN-02).
      //
      // The refusal is atomic for the batch: a mixed list of an off-air scene and the
      // one on air deletes NOTHING, so a partial delete never has to be undone.
      if (onAirSceneIds.size > 0) {
        const blocked = [...onAirSceneIds].join(", ");
        return ackError(
          "VALIDATION_FAILED",
          `Scene is on air and cannot be deleted: ${blocked}. Put another scene on air first.`,
        );
      }
    }

    const deletedIds: string[] = [];
    try {
      for (const id of ids) {
        deps.store.delete(table as never, id);
        deletedIds.push(id);
      }
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", err.message);
      }
      throw err;
    }

    const seq = deps.seqStore.next();
    const broadcastPayload = { documentType, ids: deletedIds };
    const envelope = buildBroadcastEnvelope("doc:delete", broadcastPayload, seq);
    deps.opBuffer.push(envelope);

    // Broadcast delete to all clients (no ownership filter for deletes — everyone
    // must remove). Scene deletes go per-socket: see broadcastToWorld.
    broadcastToWorld(deps.ns, envelope, documentType, onAirSceneIds);

    return ackOk({ documentType, ids: deletedIds }, seq);
  };
}

// ---------------------------------------------------------------------------
// Embedded document operations (tokens inside scenes)
// ---------------------------------------------------------------------------

function handleEmbeddedCreate(
  deps: DocHandlerDeps,
  ctx: HandlerContext,
  embeddedType: string,
  data: unknown[],
  parent: { type: string; id: string },
): Ack {
  const parentTable = resolveTable(parent.type);
  if (!parentTable) {
    return ackError("VALIDATION_FAILED", `Unknown parent type: ${parent.type}`);
  }

  // Embedded create role floor: Scene tokens (and other non-Actor parents)
  // require TRUSTED+ (TOKEN_CREATE permission, simplified). Actor-embedded
  // Items are governed purely by the OWNER ownership check below — a PLAYER
  // managing spells/gear on their own sheet is the intended path (r10-C,
  // found in live verification: the blanket gate blocked every player from
  // adding a spell to their own actor).
  if (
    parent.type !== "Actor" &&
    !isPrivileged(ctx.role) && // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    ctx.role < UserRole.TRUSTED
  ) {
    return ackError("PERMISSION_DENIED", "Insufficient role to create embedded documents");
  }

  // Load parent
  let parentDoc: Record<string, unknown>;
  try {
    parentDoc = deps.store.get(parentTable as never, parent.id);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return ackError("NOT_FOUND", `Parent document not found: ${parent.type}/${parent.id}`);
    }
    throw err;
  }

  // REQ-CEN-071/073: a scene that is not on air does not exist for this caller.
  if (sceneParentIsInvisible(ctx.role, parent.type, parentDoc)) {
    return ackError("NOT_FOUND", `Parent document not found: ${parent.type}/${parent.id}`);
  }

  // Check parent ownership (must be able to edit the parent scene)
  if (!isPrivileged(ctx.role)) {
    const ownership = getOwnershipFromDoc(parentDoc);
    const level = resolveOwnership(ownership, ctx.userId, ctx.role);
    if (level < OwnershipLevel.OWNER) {
      return ackError("PERMISSION_DENIED", `No OWNER access to parent ${parent.type}/${parent.id}`);
    }
  }

  // Get the embedded collection name (e.g., "tokens" for Token)
  const collectionKey = embeddedType.toLowerCase() + "s"; // "Token" → "tokens"
  const rawExisting = parentDoc[collectionKey];
  const existing = Array.isArray(rawExisting) ? (rawExisting as Record<string, unknown>[]) : [];

  // Validate and create each embedded doc.
  // _id is always generated server-side for embedded documents — any _id
  // supplied by the client is ignored to prevent collisions and ensure
  // uniqueness within the parent's embedded collection.
  const created: Record<string, unknown>[] = [];
  const existingIds = new Set(existing.map((t) => t["_id"] as string));

  for (const item of data) {
    const raw = { ...(item as Record<string, unknown>) };
    // Always generate a fresh server-side _id; never trust the client-supplied one
    let newId = createDocumentId();
    // In the astronomically unlikely case of collision with existing, regenerate
    while (existingIds.has(newId)) {
      newId = createDocumentId();
    }
    raw["_id"] = newId;
    existingIds.add(newId); // prevent collision within the same batch

    // Validate against Token schema if applicable
    if (embeddedType === "Token") {
      const tokenResult = TokenDocumentSchema.safeParse(raw);
      if (!tokenResult.success) {
        return ackError("VALIDATION_FAILED", tokenResult.error.message);
      }
      created.push(tokenResult.data);
    } else {
      // SF2e augmentation slot-limit validation (REQ-SF2-024, CA-SF2-05).
      //
      // This is the ONLY real code path where an Item is embedded into an
      // Actor's items[] collection in production (doc:create with
      // documentType="Item" + parent={type:"Actor", id}) — the system-api
      // hook bus is never invoked here (see systems/sf2e/src/hooks/
      // augmentation.ts docstring for the full investigation). Gated on the
      // world's systemId being "sf2e" (a world runs a single system for all
      // its actors — there is no per-Actor systemId field) so pf2e/other
      // worlds are entirely unaffected. Checked against `existing` PLUS any
      // augmentations already accepted earlier in this same batch, so a
      // single doc:create call with multiple augmentations is capped too.
      if (embeddedType === "Item" && parent.type === "Actor" && deps.systemId === "sf2e") {
        const augCheck = validateAugmentationSlotLimit(
          [...existing, ...created] as AugmentationLikeItem[],
          raw,
        );
        if (!augCheck.ok) {
          const i18nKey = augCheck.i18nKey ?? AUGMENTATION_SLOT_LIMIT_I18N_KEY;
          return ackError(
            "VALIDATION_FAILED",
            `${i18nKey}: actor already has ${String(augCheck.currentNonApexCount)} non-apex augmentations installed (limit ${String(AUGMENTATION_SLOT_LIMIT)})`,
          );
        }
      }

      // Schema validation of embedded Items against the active system's
      // registered data models (R10-C, see validateEmbeddedItemForSystem).
      // Only applies to Item embedded directly in an Actor — the SF2e
      // augmentation gate above and this validation are complementary
      // (slot-limit is a cross-item business rule; this is per-item shape).
      if (embeddedType === "Item" && parent.type === "Actor") {
        if (typeof raw["name"] !== "string" || raw["name"].length === 0) {
          return ackError("VALIDATION_FAILED", "Embedded Item requires a non-empty name");
        }
        const validation = validateEmbeddedItemForSystem(deps.systemModule, raw);
        if (!validation.ok) {
          return ackError("VALIDATION_FAILED", validation.message);
        }
        created.push(validation.doc);
        continue;
      }

      created.push(raw);
    }
  }

  // Update parent with new embedded collection
  const updatedCollection = [...existing, ...created];
  const patch: Record<string, unknown> = { [collectionKey]: updatedCollection };

  let updatedParent = deps.store.update(parentTable as never, parent.id, patch, {
    userId: ctx.userId,
  });

  if (!updatedParent) {
    return ackError("INTERNAL_ERROR", "Failed to update parent document");
  }

  // WIRING-DERIVE: an embedded Item create on an Actor (e.g. a Condition)
  // affects derived stats (AC, saves, ...) — recompute before broadcast.
  updatedParent = recomputeDerivedIfNeeded(deps, parent.type, updatedParent, {
    userId: ctx.userId,
  });

  const seq = deps.seqStore.next();
  const broadcastPayload = { documentType: parent.type, documents: [updatedParent] };
  const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
  deps.opBuffer.push(envelope);

  // parent.type is "Scene" for token ops — hidden-token filtering applied.
  broadcastToWorld(deps.ns, envelope, parent.type);

  return {
    ok: true as const,
    seq,
    result: { documentType: embeddedType, documents: created, parent: updatedParent },
  };
}

function handleEmbeddedUpdate(
  deps: DocHandlerDeps,
  ctx: HandlerContext,
  parentType: string,
  updates: DocUpdatePayload["updates"],
): Ack {
  // Group updates by parent
  const byParent = new Map<string, typeof updates>();
  for (const upd of updates) {
    if (!upd.embedded) continue;
    const parentId = upd.embedded.id;
    if (!byParent.has(parentId)) {
      byParent.set(parentId, []);
    }
    const parentBatch = byParent.get(parentId);
    if (parentBatch) parentBatch.push(upd);
  }

  // Determine parent table from embedded type (all updates assumed same parent type)
  const firstEmbedded = updates.find((u) => u.embedded);
  const embeddedType = firstEmbedded?.embedded?.type ?? "Token";
  const resolvedParentType = EMBEDDED_PARENT_MAP[embeddedType] ?? parentType;
  const parentTable = resolveTable(resolvedParentType);
  if (!parentTable) {
    return ackError("VALIDATION_FAILED", `Unknown parent type: ${resolvedParentType}`);
  }

  const allUpdatedParents: Record<string, unknown>[] = [];

  for (const [parentId, parentUpdates] of byParent) {
    let parentDoc: Record<string, unknown>;
    try {
      parentDoc = deps.store.get(parentTable as never, parentId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Parent not found: ${resolvedParentType}/${parentId}`);
      }
      throw err;
    }

    // REQ-CEN-071/073: a scene that is not on air does not exist for this caller.
    if (sceneParentIsInvisible(ctx.role, resolvedParentType, parentDoc)) {
      return ackError("NOT_FOUND", `Parent not found: ${resolvedParentType}/${parentId}`);
    }

    const collectionKey = embeddedType.toLowerCase() + "s"; // "tokens"
    const rawCollection = parentDoc[collectionKey];
    const collection = [
      ...(Array.isArray(rawCollection) ? (rawCollection as Record<string, unknown>[]) : []),
    ];

    for (const upd of parentUpdates) {
      const tokenId = upd._id;

      // Verify ownership for embedded updates (REQ-DOC-025)
      //
      // Item (embedded directly in Actor, resolvedParentType === "Actor") is
      // checked against the parent Actor's OWN ownership map — there is no
      // `actorId` indirection like Token has (see handleEmbeddedDelete for
      // the same distinction).
      if (!isPrivileged(ctx.role) && resolvedParentType === "Actor") {
        const token = collection.find((t) => t["_id"] === tokenId);
        if (!token) {
          return ackError("NOT_FOUND", `Embedded doc not found: ${embeddedType}/${tokenId}`);
        }
        const ownership = getOwnershipFromDoc(parentDoc);
        const level = resolveOwnership(ownership, ctx.userId, ctx.role);
        if (level < OwnershipLevel.OWNER) {
          return ackError("PERMISSION_DENIED", `No OWNER access to parent Actor/${parentId}`);
        }
      } else if (!isPrivileged(ctx.role)) {
        const token = collection.find((t) => t["_id"] === tokenId);
        if (!token) {
          return ackError("NOT_FOUND", `Embedded doc not found: ${embeddedType}/${tokenId}`);
        }

        // Check if user owns the referenced actor (or the scene itself)
        const actorId = token["actorId"] as string | null | undefined;
        if (actorId) {
          try {
            const actor = deps.store.get("actors", actorId);
            const ownership = getOwnershipFromDoc(actor);
            const level = resolveOwnership(ownership, ctx.userId, ctx.role);
            if (level < OwnershipLevel.OWNER) {
              return ackError(
                "PERMISSION_DENIED",
                `No OWNER access to actor ${actorId} for token ${tokenId}`,
              );
            }
          } catch {
            // Actor not found — only GM can update orphaned tokens
            if (!isPrivileged(ctx.role)) {
              return ackError(
                "PERMISSION_DENIED",
                `Token ${tokenId} has no actor and you are not GM`,
              );
            }
          }
        } else {
          // No actorId — GM-only token
          return ackError("PERMISSION_DENIED", `Token ${tokenId} is GM-only (no actorId)`);
        }
      }

      // --- Field allowlist / protection (FIX-5) ---

      // Build a sanitized diff: strip _id always (immutable), and block
      // actorId changes for non-privileged users.
      const { _id: _strippedId, ...sanitizedDiff } = upd.diff;
      void _strippedId;

      // actorId reassignment is a privileged operation: it changes which actor
      // a token represents and affects ownership resolution for future updates.
      // Only GM/ASSISTANT may change actorId.
      if ("actorId" in sanitizedDiff && !isPrivileged(ctx.role)) {
        return ackError(
          "PERMISSION_DENIED",
          `Only GM/Assistant can change actorId on token ${tokenId}`,
        );
      }

      // Apply diff to token
      const idx = collection.findIndex((t) => t["_id"] === tokenId);
      if (idx === -1) {
        return ackError("NOT_FOUND", `Embedded doc not found: ${embeddedType}/${tokenId}`);
      }

      // Build the updated token by applying dot-path diff (uses sanitized diff)
      const existingToken = collection[idx] ?? {};
      const patchedToken = applyDotPathDiff(existingToken, sanitizedDiff);

      // Schema validation of embedded Items against the active system's
      // registered data models (R10-C, see validateEmbeddedItemForSystem).
      // Validated on the DIFF-APPLIED doc, not just the diff — a partial
      // diff (e.g. {"system.slots.prepared": [...]}) must still result in a
      // schema-valid whole item after merging onto the existing document.
      if (embeddedType === "Item" && resolvedParentType === "Actor") {
        const validation = validateEmbeddedItemForSystem(deps.systemModule, patchedToken);
        if (!validation.ok) {
          return ackError("VALIDATION_FAILED", validation.message);
        }
        collection[idx] = validation.doc;
        continue;
      }

      collection[idx] = patchedToken;
    }

    // Persist parent with updated embedded collection
    const parentPatch: Record<string, unknown> = { [collectionKey]: collection };
    let updatedParent = deps.store.update(parentTable as never, parentId, parentPatch, {
      userId: ctx.userId,
    });

    if (updatedParent) {
      // WIRING-DERIVE (audit issue 2): an embedded update (e.g. changing a
      // Condition's `value`, such as Frightened 2 → 1) affects derived stats
      // (AC, saves, ...) exactly like an embedded create does — recompute
      // before broadcast so `system.derived` never goes stale relative to
      // the embedded collection that was just persisted.
      updatedParent = recomputeDerivedIfNeeded(deps, resolvedParentType, updatedParent, {
        userId: ctx.userId,
      });
      allUpdatedParents.push(updatedParent);
    }
  }

  if (allUpdatedParents.length === 0) {
    return {
      ok: true as const,
      seq: deps.seqStore.peek(),
      result: { documentType: resolvedParentType, documents: [] },
    };
  }

  const seq = deps.seqStore.next();
  const broadcastPayload = { documentType: resolvedParentType, documents: allUpdatedParents };
  const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
  deps.opBuffer.push(envelope);

  // resolvedParentType is "Scene" for token ops — hidden-token filtering applied.
  broadcastToWorld(deps.ns, envelope, resolvedParentType);

  return {
    ok: true as const,
    seq,
    result: { documentType: resolvedParentType, documents: allUpdatedParents },
  };
}

function handleEmbeddedDelete(
  deps: DocHandlerDeps,
  ctx: HandlerContext,
  embeddedType: string,
  ids: string[],
  parent: { type: string; id: string },
): Ack {
  const parentTable = resolveTable(parent.type);
  if (!parentTable) {
    return ackError("VALIDATION_FAILED", `Unknown parent type: ${parent.type}`);
  }

  let parentDoc: Record<string, unknown>;
  try {
    parentDoc = deps.store.get(parentTable as never, parent.id);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return ackError("NOT_FOUND", `Parent not found: ${parent.type}/${parent.id}`);
    }
    throw err;
  }

  // REQ-CEN-071/073: a scene that is not on air does not exist for this caller.
  if (sceneParentIsInvisible(ctx.role, parent.type, parentDoc)) {
    return ackError("NOT_FOUND", `Parent not found: ${parent.type}/${parent.id}`);
  }

  // Permission: GM/ASSISTANT or actor owner
  //
  // Item (embedded directly in Actor, parent.type === "Actor") is checked
  // against the parent Actor's OWN ownership map — there is no separate
  // `actorId` indirection like Token has (a Token embedded in a Scene
  // references its Actor via `token.actorId`; an Item embedded in an Actor
  // simply IS a child of that Actor).
  if (!isPrivileged(ctx.role) && parent.type === "Actor") {
    const ownership = getOwnershipFromDoc(parentDoc);
    const level = resolveOwnership(ownership, ctx.userId, ctx.role);
    if (level < OwnershipLevel.OWNER) {
      return ackError("PERMISSION_DENIED", `No OWNER access to parent Actor/${parent.id}`);
    }
  } else if (!isPrivileged(ctx.role)) {
    const collKey = embeddedType.toLowerCase() + "s";
    const rawColl = parentDoc[collKey];
    const collection = Array.isArray(rawColl) ? (rawColl as Record<string, unknown>[]) : [];
    for (const id of ids) {
      const token = collection.find((t) => t["_id"] === id);
      if (token) {
        const actorId = token["actorId"] as string | null | undefined;
        if (!actorId) {
          return ackError("PERMISSION_DENIED", `Token ${id} is GM-only`);
        }
        try {
          const actor = deps.store.get("actors", actorId);
          const ownership = getOwnershipFromDoc(actor);
          const level = resolveOwnership(ownership, ctx.userId, ctx.role);
          if (level < OwnershipLevel.OWNER) {
            return ackError("PERMISSION_DENIED", `No OWNER access to actor for token ${id}`);
          }
        } catch {
          return ackError("PERMISSION_DENIED", `Token ${id} actor not found and you are not GM`);
        }
      }
    }
  }

  const collectionKey = embeddedType.toLowerCase() + "s";
  const rawDeleteColl = parentDoc[collectionKey];
  const collection = Array.isArray(rawDeleteColl)
    ? (rawDeleteColl as Record<string, unknown>[])
    : [];
  const idsToDelete = new Set(ids);
  const updatedCollection = collection.filter((item) => !idsToDelete.has(item["_id"] as string));

  const patch: Record<string, unknown> = { [collectionKey]: updatedCollection };
  let updatedParent = deps.store.update(parentTable as never, parent.id, patch, {
    userId: ctx.userId,
  });

  if (!updatedParent) {
    return ackError("INTERNAL_ERROR", "Failed to update parent after embedded delete");
  }

  // WIRING-DERIVE (audit issue 2): removing an embedded Item (e.g. clearing a
  // Condition) affects derived stats (AC, saves, ...) exactly like create/
  // update does — recompute before broadcast so `system.derived` reflects
  // the condition's removal (e.g. Frightened cleared → AC penalty lifted).
  updatedParent = recomputeDerivedIfNeeded(deps, parent.type, updatedParent, {
    userId: ctx.userId,
  });

  const seq = deps.seqStore.next();
  const broadcastPayload = { documentType: parent.type, documents: [updatedParent] };
  const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
  deps.opBuffer.push(envelope);

  // parent.type is "Scene" for token ops — hidden-token filtering applied.
  broadcastToWorld(deps.ns, envelope, parent.type);

  return {
    ok: true as const,
    seq,
    result: { documentType: embeddedType, ids, parent: updatedParent },
  };
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the socket belongs to a GM or ASSISTANT.
 * socket.data is typed as `unknown` by socket.io; we read role defensively.
 */
function socketIsPrivileged(socket: Socket): boolean {
  const data = socket.data as Record<string, unknown> | null | undefined;
  if (!data) return false;
  const role = data["role"];
  return typeof role === "number" && isRolePrivileged(role);
}

/**
 * Emit one envelope per socket, choosing by role.
 *
 * `isRolePrivileged` (via {@link socketIsPrivileged}) is the ONLY predicate that
 * decides which of the two envelopes a socket gets — never a duplicated
 * role comparison.
 */
function emitByRole(ns: Namespace, privilegedEnvelope: Envelope, playerEnvelope: Envelope): void {
  for (const [, socket] of ns.sockets) {
    socket.emit("op", socketIsPrivileged(socket) ? privilegedEnvelope : playerEnvelope);
  }
}

/**
 * Broadcast a doc op envelope to all sockets in the world namespace.
 *
 * Scene envelopes ALWAYS go per-socket, because for a Scene the very list of
 * documents is privileged data (spec 44):
 *   - privileged sockets (GM / ASSISTANT) → full payload
 *   - player sockets → only the scene on air, with hidden tokens stripped and
 *     secret doors masked as plain walls (`redactSceneDocsForNonPrivileged`)
 *
 * REQ-CEN-071 / REQ-CEN-073: before this, a Scene create/update with neither a
 * hidden token nor a secret door took the cheap namespace-wide emit, so every
 * player received the full document — name included — of every scene the GM
 * touched during the session. The rail hiding the tab was the only barrier,
 * which REQ-GAV-034 and DEC-CEN-11 say explicitly is not one.
 *
 * The player envelope is emitted even when nothing survives redaction (empty
 * `documents` / `ids`): the client mirror requires a contiguous seq and fires
 * its gap detector on a jump, so swallowing the envelope would put every player
 * into a resync loop. An empty batch is a no-op upsert that only advances seq.
 *
 * Scene doc:delete needs `onAirSceneIds` — the ids that were on air at the
 * moment of deletion, captured by the caller BEFORE the rows were removed,
 * since the document (and its `active` mirror) is gone by broadcast time.
 *
 * All other document types keep the cheap namespace-wide emit.
 */
function broadcastToWorld(
  ns: Namespace,
  envelope: Envelope,
  documentType?: string,
  onAirSceneIds?: ReadonlySet<string>,
): void {
  if (documentType === "Scene") {
    if (envelope.type === "doc:create" || envelope.type === "doc:update") {
      const payload = envelope.payload as {
        documentType: string;
        documents: Record<string, unknown>[];
      };
      const playerEnvelope: Envelope = {
        ...envelope,
        payload: {
          ...payload,
          documents: redactSceneDocsForNonPrivileged(payload.documents),
        },
      };
      emitByRole(ns, envelope, playerEnvelope);
      return;
    }

    if (envelope.type === "doc:delete") {
      const payload = envelope.payload as { documentType: string; ids: string[] };
      // A player only ever learned about the scene on air, so only its removal
      // is news to them; the removal of any other scene would be the first time
      // they hear that scene existed at all (REQ-CEN-071).
      const visibleIds = payload.ids.filter((id) => onAirSceneIds?.has(id) === true);
      const playerEnvelope: Envelope = {
        ...envelope,
        payload: { ...payload, ids: visibleIds },
      };
      emitByRole(ns, envelope, playerEnvelope);
      return;
    }
  }

  // REQ-CBA-082 / REQ-CBT-031: a Combat body reaching clients through the
  // GENERIC document path carries the whole combatant roster — a `doc:update`
  // on the Combat itself, and every embedded Combatant create/update/delete,
  // which republishes the parent Combat as `{ documentType: "Combat",
  // documents: [combat] }`. The `combat:*` handlers redact their own
  // broadcasts; without this branch the generic door beside them stayed open
  // and a hidden combatant reached every player the moment the GM touched the
  // encounter by anything other than a combat op.
  //
  // The Combat document itself is NOT privileged (the encounter is shared world
  // state, REQ-CBT-031..033) — only the hidden combatants inside it are
  // stripped, so `doc:delete` (ids only, no bodies) needs no branch here.
  if (
    documentType === "Combat" &&
    (envelope.type === "doc:create" || envelope.type === "doc:update")
  ) {
    const payload = envelope.payload as {
      documentType: string;
      documents?: Record<string, unknown>[];
    };
    if (Array.isArray(payload.documents)) {
      const documents = payload.documents;
      const redacted = redactCombatDocsForNonPrivileged(documents);
      // Reference equality: the redaction returns the original body when there
      // was nothing hidden, so an untouched batch keeps the cheap emit.
      const changed = redacted.some((doc, i) => doc !== documents[i]);
      if (changed) {
        const playerEnvelope: Envelope = {
          ...envelope,
          payload: { ...payload, documents: redacted },
        };
        emitByRole(ns, envelope, playerEnvelope);
        return;
      }
    }
  }

  // Fast path: no redaction concern — namespace-wide emit.
  ns.emit("op", envelope);
}

export { broadcastToWorld };

// ---------------------------------------------------------------------------
// WIRING-DERIVE: strip client-supplied system.derived from an Actor diff
// ---------------------------------------------------------------------------

/**
 * Remove any attempt to write `system.derived` (or a sub-path under it) from
 * a client-supplied diff, in both shapes a diff may carry it:
 *   - dot-path key:      "system.derived", "system.derived.ac", ...
 *   - nested object key: { system: { derived: {...}, ...otherFields } }
 *
 * `system.derived` is exclusively server-computed (recomputeDerivedIfNeeded /
 * runActorDerivation) — this is defense-in-depth so a forged or stale
 * autosave payload can never persist bogus derived stats, even momentarily.
 */
function stripSystemDerived(diff: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(diff)) {
    if (key === "system.derived" || key.startsWith("system.derived.")) {
      continue; // dot-path form — drop entirely
    }
    if (key === "system" && value && typeof value === "object" && !Array.isArray(value)) {
      const { derived: _droppedDerived, ...rest } = value as Record<string, unknown>;
      void _droppedDerived;
      result[key] = rest;
      continue;
    }
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Utility: apply dot-path diff to an object
// ---------------------------------------------------------------------------

/**
 * Apply a diff in dot-path notation to an object.
 * Example: diff = { "x": 100, "y": 200 } on token → sets token.x and token.y.
 * Also handles simple top-level key updates.
 */
function applyDotPathDiff(
  target: Record<string, unknown>,
  diff: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const [path, value] of Object.entries(diff)) {
    const parts = path.split(".");
    if (parts.length === 1) {
      result[path] = value;
    } else {
      // Navigate and set nested
      let current: Record<string, unknown> = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i] ?? "";
        if (
          current[key] === undefined ||
          typeof current[key] !== "object" ||
          current[key] === null
        ) {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }
      const lastKey = parts[parts.length - 1] ?? "";
      current[lastKey] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Build an error ack.
 * requestId is intentionally omitted here — the central dispatcher in
 * socket-manager.ts injects it from the incoming envelope for all acks
 * (both success and error).  Handlers must NOT set it; doing so would
 * create a duplicate that the dispatcher would overwrite anyway.
 *
 * Single source of truth: dispatcher owns requestId injection.
 */
function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}
