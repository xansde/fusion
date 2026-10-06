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
import {
  validateEmbeddedItemForSystem,
  validateActorCurrencyForSystem,
  augmentationSlotLimitViolation,
} from "../../documents/embedded-item.js";
import { recomputeDerivedIfNeeded } from "../../documents/derive.js";
import {
  UserRole,
  resolveOwnership,
  OwnershipLevel,
  isRolePrivileged,
  isGamemasterStrict,
  testOwnership,
} from "../../documents/ownership.js";
import {
  resolvePermissionMinRole,
  validatePermissionOverrides,
  PERMISSIONS_SETTING_KEY,
  type PermissionKey,
} from "../../documents/world-permissions.js";
import {
  companionGrantAllows,
  companionGrantLimit,
  companionGroupOf,
  getCompanionType,
  validateCharacterBuild,
  type BuildValidationVariants,
} from "@fusion/system-pf2e";
import { deepMerge } from "../../documents/merge.js";
import { resolveWorldVariantRules } from "../../documents/world-variant-rules.js";
import {
  DocCreatePayloadSchema,
  DocUpdatePayloadSchema,
  DocDeletePayloadSchema,
  TokenDocumentSchema,
} from "@fusion/shared";
import type { DocUpdatePayload, Ack, Ownership, Envelope, ErrorCode } from "@fusion/shared";
import {
  createDocumentId,
  touchesKnowledgeFlag,
  touchesTokenMarksFlag,
  stripTokenMarksOnCreate,
  KNOWLEDGE_FLAG_PATH,
} from "@fusion/shared";
import { touchesAttitudeFlag, ATTITUDE_FLAG_PATH } from "@fusion/shared";
import {
  sweepCharactersFromKnowledge,
  sanitizeKnowledgeOnCreate,
  isCharacterActor,
} from "../../documents/knowledge.js";
import { rejectAttitudeWrite, sanitizeAttitudeOnCreate } from "../../documents/attitude.js";
import { applyMountMovement } from "../../combat/mount-follow.js";
import {
  findBlockingCombats,
  blockingCombatMessage,
  planPresenceRemoval,
  applyPresenceRemoval,
} from "../../documents/actor-deletion.js";
import { isNonPlayableActor } from "../../documents/knowledge.js";
import {
  validateTokenActorId,
  validateTokenCreateContract,
  applyTokenCreateDefaults,
  validateTokenUpdateActorDelta,
  validateTokenUpdateDerivedFields,
  diffTouchesField,
} from "../../tokens/tokenValidation.js";
import {
  redactCombatDocsForNonPrivileged,
  redactSceneDocsForNonPrivileged,
  sceneIsInvisibleToRole,
  sceneIsOnAir,
  redactActorDocsForViewer,
  buildContactViewer,
  getContactKnowledgeSource,
} from "../redaction.js";
// The augmentation-slot rule itself moved to `documents/embedded-item.ts` (spec 43
// §5.7, DEC-CPD-05) so `compendium:importToActor` runs the SAME predicate this file
// runs — only the payload type is still read here.
import { isPlayerReadableSettingKey } from "./settings-handlers.js";
import type { AugmentationLikeItem } from "@fusion/system-sf2e";
import type { SystemModule } from "@fusion/system-api";
import { systemIncludes } from "@fusion/system-api";

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
 *
 * Folder is included (REQ-NPC-021 / REQ-NPC-080): creating a folder is a
 * privileged-only action, and there is no dedicated `folder:create` — it goes
 * through this same generic `doc:create` path, so the gate has to live here.
 * Before this, `documentType === "Folder"` fell through to the plain
 * `role >= TRUSTED` floor a few lines below, and TRUSTED (role 2) is not
 * privileged (`isRolePrivileged` is `>= ASSISTANT`, role 3) — a TRUSTED
 * socket could mint a Folder in the tree the NPCs tab draws, and could smuggle
 * a self-`ownership: {OWNER}` into the payload while doing it, since nothing
 * on the create path forces Folder's ownership the way r17-P1 forces a
 * companion's. Delete is handled by the unconditional refusal in
 * `buildDocDeleteHandler` below (REQ-NPC-022) — membership here still matters
 * for delete because it is what stops a non-privileged role from reaching
 * that far via the generic ownership-based delete rule.
 */
const GM_ONLY_CREATE_DELETE = new Set([
  "Scene",
  "Actor",
  "Item",
  "Macro",
  "RollTable",
  "Playlist",
  "Combat",
  "Folder",
]);

/**
 * `documentType` → the REQ-USR-008 Permission Key that gates its create path,
 * for the subset of `GM_ONLY_CREATE_DELETE` types the Permissões section
 * (REQ-CFG-040..042) can actually configure (world-permissions.ts). `Scene`,
 * `Macro` and `Combat` are intentionally absent — REQ-USR-008 defines no
 * corresponding key for them, and this map must never invent one.
 */
const CREATE_PERMISSION_KEY_BY_TYPE: Partial<Record<string, PermissionKey>> = {
  Actor: "ACTOR_CREATE",
  Item: "ITEM_CREATE",
  RollTable: "TABLE_CREATE",
  Playlist: "PLAYLIST_CREATE",
};

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
 *
 * `User` (REQ-USR-025..031, REQ-USR-030, REQ-CFG-070): `TYPE_TO_TABLE` maps it
 * to the SAME `users` table `auth/user-store.ts` reads at login — this is not
 * a document type with a stray table, it is the authentication table itself.
 * `/api/users` (`auth/routes.ts`, gated by `requireRole(Role.GAMEMASTER, ...)`)
 * is its one door, matching every other administration action REQ-USR-030
 * names. The generic path had no matching guard: `User` is absent from
 * `GM_ONLY_CREATE_DELETE`, so a create/update/delete only had to clear the
 * TRUSTED+ floor below — and unlike `store.create("users", ...)`'s intended
 * caller (`UserStore.create` in user-store.ts, which always supplies
 * `password_hash`/`active`), `DocumentStore.create("users", ...)` only
 * extracts `name`/`role` into columns (`documents/store.ts`), leaving
 * `password_hash` NULL and `active` at its column default of 1 — a role-2
 * (TRUSTED) requester sending `{documentType:"User", data:[{name:"x",
 * role:4}]}` got a passwordless GAMEMASTER account back, joinable with no
 * password (REQ-USR-018), verified by execution before this guard existed.
 */
const GENERIC_PATH_FORBIDDEN_TYPES: Record<string, string> = {
  ChatMessage:
    "ChatMessage is not writable through doc:create/doc:update/doc:delete — use chat:send to post and chat:invalidate to moderate (REQ-CHT-005 / REQ-ACH-080)",
  User: "User is not writable through doc:create/doc:update/doc:delete — use the /api/users routes (REQ-USR-025..031, REQ-USR-030)",
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

// `isGamemasterStrict` (REQ-CFG-070/071: `role === GAMEMASTER` strictly, not
// the generic `isRolePrivileged` threshold that also admits ASSISTANT) is
// imported from `../../documents/ownership.js` — single source shared with
// `settings-handlers.ts` (Mundo/Permissões reads) so the two doors can never
// gate on a different threshold (DEC-CFG-10's implementation note).

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
/**
 * Does this expanded `doc:update` diff write the companion's link to its master
 * (`system.companionKind`, `system.masterActorId`, `system.companion.grantSlotId`) or flips
 * `system.companion.active`?
 * A `system` (or `system.companion`) set to a non-object counts: it would replace them whole.
 */
function touchesCompanionLink(expanded: Record<string, unknown>): boolean {
  if (!("system" in expanded)) return false;
  const system = expanded["system"];
  if (typeof system !== "object" || system === null || Array.isArray(system)) return true;
  const sys = system as Record<string, unknown>;
  if ("companionKind" in sys || "masterActorId" in sys) return true;
  if (!("companion" in sys)) return false;
  const companion = sys["companion"];
  if (typeof companion !== "object" || companion === null || Array.isArray(companion)) return true;
  // `active` is the server's call (DC-07: one active companion per master); swapping it is BHR-F4-10.
  return "grantSlotId" in companion || "active" in companion;
}

/** `flags.fusion.mount` of a raw token, or undefined when absent. */
function readTokenMountFlag(token: Record<string, unknown>): unknown {
  const flags = token["flags"];
  if (typeof flags !== "object" || flags === null) return undefined;
  const fusion = (flags as Record<string, unknown>)["fusion"];
  if (typeof fusion !== "object" || fusion === null) return undefined;
  return (fusion as Record<string, unknown>)["mount"];
}

/**
 * Does this expanded `doc:update` diff write an INPUT of the animal companion's derivation that a player
 * may NOT touch: the master cache (`system.master.*`) or the companion's `stage` or `track`? Its whole
 * statblock is a function of those (master level + stage + track + type + size), so letting the owner write
 * them is letting the owner pick the statblock (onda-6 review I-9, REQ-PET-106). Stage and track belong to
 * the Plan and the server; the master level is written by the server from the owner actor (BHR-F4-03).
 * `typeSlug` and `size` are the owner's own choice ("Trocar tipo", D-B09) but only within what the type
 * allows — see `companionTypeChoiceViolation`.
 * A `system` / `system.companion` set to a non-object counts: it would replace them whole.
 */
function touchesCompanionDerivationInputs(expanded: Record<string, unknown>): boolean {
  if (!("system" in expanded)) return false;
  const system = expanded["system"];
  if (typeof system !== "object" || system === null || Array.isArray(system)) return true;
  const sys = system as Record<string, unknown>;
  if ("master" in sys) return true;
  if (!("companion" in sys)) return false;
  const companion = sys["companion"];
  if (typeof companion !== "object" || companion === null || Array.isArray(companion)) return true;
  return "stage" in companion || "track" in companion;
}

/**
 * The owner's "Trocar tipo" (BHR-F4-03 extension, D-B09): a diff that writes `system.companion.typeSlug` or
 * `.size` is valid only if the RESULTING link names a type the system knows and a size that type allows
 * (antelope: medium or large; the others: their one fixed size). `size` null/absent means "the type's
 * default" and is always fine. Returns the refusal message, or null when the diff does not touch either
 * field or is valid. Judged on the merged link so a diff that only changes the type is checked against the
 * size already stored.
 */
function companionTypeChoiceViolation(
  expanded: Record<string, unknown>,
  existing: Record<string, unknown>,
): string | null {
  const system = expanded["system"];
  if (typeof system !== "object" || system === null || Array.isArray(system)) return null;
  const diffLink = (system as Record<string, unknown>)["companion"];
  if (typeof diffLink !== "object" || diffLink === null || Array.isArray(diffLink)) return null;
  if (!("typeSlug" in diffLink) && !("size" in diffLink)) return null;
  const storedLink = (existing["system"] as Record<string, unknown> | undefined)?.["companion"];
  const merged = {
    ...(typeof storedLink === "object" && storedLink !== null ? storedLink : {}),
    ...(diffLink as Record<string, unknown>),
  } as Record<string, unknown>;
  const slug = merged["typeSlug"];
  const type = typeof slug === "string" ? getCompanionType(slug) : undefined;
  if (!type) return `Unknown companion type "${String(slug)}"`;
  const size = merged["size"];
  if (size !== null && size !== undefined && !(type.sizes as readonly unknown[]).includes(size)) {
    return `Size ${JSON.stringify(size)} is not allowed for companion type "${type.slug}" (allowed: ${type.sizes.join(", ")})`;
  }
  return null;
}

/**
 * What a PLAYER may put in the `system.companion` link of a NEW animal companion (wave 7 review I-2): an
 * existing `typeSlug`, a `size` that type allows (null/absent = the type's default), the initial `stage`
 * ("young", or absent) and no `track`. Returns the refusal message, or null when the link is acceptable.
 */
function companionCreateViolation(companion: Record<string, unknown>): string | null {
  const system = companion["system"];
  const link =
    typeof system === "object" && system !== null && !Array.isArray(system)
      ? (system as Record<string, unknown>)["companion"]
      : undefined;
  if (typeof link !== "object" || link === null || Array.isArray(link)) {
    return "An animal companion needs a system.companion link";
  }
  const fields = link as Record<string, unknown>;
  if (typeof fields["typeSlug"] !== "string") return "An animal companion needs a typeSlug";
  const typeViolation = companionTypeChoiceViolation({ system: { companion: link } }, {});
  if (typeViolation) return typeViolation;
  if (fields["stage"] !== undefined && fields["stage"] !== "young") {
    return "A new animal companion starts Young: the stage is set by the server";
  }
  if (fields["track"] !== undefined && fields["track"] !== null) {
    return "A new animal companion has no track: the track is set by the server";
  }
  return null;
}

function rejectUnwritableField(
  documentType: string,
  expandedDiff: Record<string, unknown>,
  role: number,
  existing?: Record<string, unknown>,
): Ack<never> | null {
  // `Actor.flags.fusion.attitude` (spec 42 §5.5): the attitude towards the
  // party is a field of the actor's own document, and this path authorizes on
  // `ownership` — so a player who owns an actor could otherwise declare it an
  // ally of the party. REQ-NPC-080 names `isRolePrivileged` for "alterar
  // atitude", and REQ-NPC-037/CA-NPC-010 say a hazard has none and none can be
  // given to it. Both are decided here, before anything is written, and the
  // subtype is read off the STORED document so a forged `type` on the same diff
  // buys nothing.
  if (documentType === "Actor" && touchesAttitudeFlag(expandedDiff)) {
    const rejection = rejectAttitudeWrite(expandedDiff, isPrivileged(role), existing);
    if (rejection) {
      switch (rejection.kind) {
        case "not-privileged":
          return ackError(
            "PERMISSION_DENIED",
            `${ATTITUDE_FLAG_PATH} may only be written by a privileged role`,
          );
        case "not-applicable":
          return ackError(
            "VALIDATION_FAILED",
            `${ATTITUDE_FLAG_PATH} does not apply to an Actor of type "${rejection.type}"`,
          );
        case "invalid-value":
          return ackError(
            "VALIDATION_FAILED",
            `${ATTITUDE_FLAG_PATH} must be one of "enemy", "neutral", "ally" — or null to clear it`,
          );
      }
    }
  }

  // `Actor.flags.fusion.knowledge` (spec 39 §5.8): contact knowledge is a
  // field of the contact's own document, but this path authorizes on
  // `ownership` — and a player who owns their own sheet would then be able to
  // write who knows whom, which REQ-CTT-080 says the server must verify.
  // `actor:setKnowledge` is the one way in: privileged-only, and it normalizes
  // the map before writing (an exception equal to the general rule is removed,
  // REQ-CTT-072) — a normalization the generic deep merge cannot perform.
  if (documentType === "Actor" && touchesKnowledgeFlag(expandedDiff)) {
    return ackError(
      "VALIDATION_FAILED",
      `${KNOWLEDGE_FLAG_PATH} is not writable through doc:update — use the actor:setKnowledge operation`,
    );
  }

  // `Actor.flags.fusion.tokenMarks` (BHR-F3-06, REQ-BHR-087/088): the Prey is
  // checked on `mark:set` (own actor, own live target, exclusive forced) — and
  // this path authorizes on `ownership` only, so an owner could write the array
  // whole and skip every one of those rules. Only a privileged writer may.
  if (documentType === "Actor" && !isPrivileged(role) && touchesTokenMarksFlag(expandedDiff)) {
    return ackError(
      "PERMISSION_DENIED",
      "flags.fusion.tokenMarks is not writable through doc:update — use mark:set / mark:clear",
    );
  }

  // The companion's link to its master (BHR-F4-04, REQ-PET-110/111, DC-07): the kind, the master and the
  // grant slot are fixed when the companion is CREATED (where the cap, the mount refusal and the slot
  // uniqueness are checked) — an owner rewriting them here would free a slot, turn a pet into a mount, or
  // void the unique slot. The Mestre keeps full control. The subtype is read off the STORED document.
  if (
    documentType === "Actor" &&
    !isPrivileged(role) &&
    existing?.["type"] === "familiar" &&
    touchesCompanionLink(expandedDiff)
  ) {
    return ackError(
      "PERMISSION_DENIED",
      "system.companionKind, system.masterActorId, system.companion.grantSlotId and system.companion.active are not writable through doc:update by a player",
    );
  }

  // The inputs of an ANIMAL companion's derivation (onda-6 review I-9). Scoped to `animalCompanion`: the
  // familiar and the eidolon legitimately mirror their master through a client-written `system.master` cache
  // (petsVM), and have no stage/track.
  if (
    documentType === "Actor" &&
    !isPrivileged(role) &&
    existing?.["type"] === "familiar" &&
    (existing["system"] as { companionKind?: unknown } | undefined)?.companionKind ===
      "animalCompanion" &&
    touchesCompanionDerivationInputs(expandedDiff)
  ) {
    return ackError(
      "PERMISSION_DENIED",
      "system.master and system.companion.{stage,track} are not writable through doc:update by a player",
    );
  }

  // BHR-F4-03 extension (D-B09): the owner swaps the companion's type/size on their own, validated here.
  if (
    documentType === "Actor" &&
    !isPrivileged(role) &&
    existing?.["type"] === "familiar" &&
    (existing["system"] as { companionKind?: unknown } | undefined)?.companionKind ===
      "animalCompanion"
  ) {
    const violation = companionTypeChoiceViolation(expandedDiff, existing);
    if (violation) return ackError("VALIDATION_FAILED", violation);
  }

  // The guard above reads the STORED subtype, so a player could skip it by turning an actor they own
  // into a "familiar" in the same diff — and then pass for a companion of anyone (`effect:apply`
  // authorizes on that link). Minting a companion is the guarded create path's job, never a retype.
  if (
    documentType === "Actor" &&
    !isPrivileged(role) &&
    expandedDiff["type"] === "familiar" &&
    existing?.["type"] !== "familiar"
  ) {
    return ackError(
      "PERMISSION_DENIED",
      "an Actor cannot be turned into a companion through doc:update by a player",
    );
  }

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
//     (c) the world runs pf2e AND the master actually carries the grant for
//         THAT companionKind (companionGrantAllows, read live from the
//         master's embedded items on the SERVER — the client CTA is advisory,
//         this is authoritative): a familiar-granting feat for familiar/pet,
//         the Summoner class (by sourceId) for eidolon, an Animal Companion
//         feat or the Beastmaster Dedication for animalCompanion (REQ-PET-109);
//         a kind with no detector (mount) is never granted to a player
//         (spec 29 DEC-PET-03, REQ-PET-092);
//     (d) the master has fewer companions of the same GROUP than its cap
//         (familiar+pet share one slot, eidolon is its own, both capped at 1;
//         animalCompanion is capped at the NUMBER OF GRANTS the master carries,
//         counted here on the server — REQ-PET-093, REQ-PET-110, DC-07). The
//         companions of the SAME batch count too, so one doc:create cannot
//         step over the cap;
//     (e) an animalCompanion carries the `grantSlotId` of the Plan slot that
//         creates it and no other companion of that master already holds it
//         (REQ-PET-111). The GM skips (c)-(e): it never reaches this gate.
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

/** The companions of `kind`'s group already linked to the master. */
function companionsOfGroup(
  store: DocumentStore,
  masterId: string,
  kind: string,
): Array<Record<string, unknown>> {
  const group = companionGroupOf(kind);
  return store
    .getAll("actors", { type: COMPANION_ACTOR_TYPE })
    .filter(
      (c) =>
        readMasterActorId(c) === masterId &&
        companionGroupOf(readCompanionKind(c) ?? "familiar") === group,
    );
}

/** Read `system.companion.grantSlotId` (CompanionLink) from a raw doc, or null. */
function readGrantSlotId(doc: Record<string, unknown>): string | null {
  const sys = doc["system"];
  if (!sys || typeof sys !== "object" || Array.isArray(sys)) return null;
  const link = (sys as Record<string, unknown>)["companion"];
  if (!link || typeof link !== "object" || Array.isArray(link)) return null;
  const raw = (link as Record<string, unknown>)["grantSlotId"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * DEC-BHR-10 / DC-07: a master has ONE active animal companion, and the server decides which — never
 * the client. The first companion created is born active; any later one is born inactive and the
 * companion that was already active stays active (switching is the owner's explicit action,
 * BHR-F4-10). Applies to every creator (player and GM) of a companion carrying a
 * `system.companion` link; runs per item, so a batch sees the items persisted before it.
 */
function decideCompanionActiveOnCreate(
  store: DocumentStore,
  item: Record<string, unknown>,
): Record<string, unknown> {
  if (!isCompanionDoc(item) || readCompanionKind(item) !== "animalCompanion") return item;
  const sys = item["system"] as Record<string, unknown>;
  const link = sys["companion"];
  if (!link || typeof link !== "object" || Array.isArray(link)) return item;
  const masterId = readMasterActorId(item);
  if (!masterId) return item;
  const hasActive = companionsOfGroup(store, masterId, "animalCompanion").some((c) => {
    const l = (c["system"] as Record<string, unknown>)["companion"];
    return !!l && typeof l === "object" && (l as Record<string, unknown>)["active"] === true;
  });
  return {
    ...item,
    system: { ...sys, companion: { ...(link as Record<string, unknown>), active: !hasActive } },
  };
}

/** Companions of one master+group already accepted earlier in the SAME create batch. */
interface BatchCompanions {
  count: number;
  slotIds: Set<string>;
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
  deps: Pick<DocHandlerDeps, "store" | "systemId" | "systemModule">,
  ctx: HandlerContext,
  companion: Record<string, unknown>,
  batch: Map<string, BatchCompanions> = new Map(),
): CompanionCreateAuth {
  // (c-guard) Only worlds whose system includes pf2e grant familiars — the
  // literal pf2e system, or the pf2e+sf2e composite (DEC-SYS-06-bis, I4);
  // other systems keep Actor strictly GM-only.
  if (
    !systemIncludes(
      { systemId: deps.systemId, sourceSystemIds: deps.systemModule?.manifest.sourceSystemIds },
      "pf2e",
    )
  ) {
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

  // (c) Master must actually carry the grant for this kind (REQ-PET-092).
  const kind = readCompanionKind(companion) ?? "";
  if (!companionGrantAllows(kind, master)) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: `Master has no grant for a companion of kind "${kind}"`,
    };
  }

  // (d) The group's cap: 1 for familiar/pet/eidolon, the number of grants for
  // animalCompanion (REQ-PET-093, REQ-PET-110). Batch-mates count.
  const existing = companionsOfGroup(deps.store, masterId, kind);
  const batchKey = `${masterId}:${companionGroupOf(kind)}`;
  const inBatch = batch.get(batchKey) ?? { count: 0, slotIds: new Set<string>() };
  if (existing.length + inBatch.count >= companionGrantLimit(kind, master)) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: `Master already has the allowed number of companions of kind "${kind}"`,
    };
  }

  // (f) The statblock of an animal companion is a function of type + size + stage + track + master level
  // (REQ-PET-106): a player picks only a type the system knows and a size that type allows. The stage is
  // the server's — a new companion is Young and has no track — so anything else is refused, not trusted
  // (the update path already refuses the same fields: onda-6 I-9, D-B09).
  if (kind === "animalCompanion") {
    const violation = companionCreateViolation(companion);
    if (violation) return { ok: false, code: "VALIDATION_FAILED", message: violation };
  }

  // (e) An animal companion is born from one Plan slot (REQ-PET-111).
  const slotId = readGrantSlotId(companion);
  if (kind === "animalCompanion") {
    if (slotId === null) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "An animal companion needs system.companion.grantSlotId",
      };
    }
    if (inBatch.slotIds.has(slotId) || existing.some((c) => readGrantSlotId(c) === slotId)) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: `Grant slot "${slotId}" already created a companion`,
      };
    }
    inBatch.slotIds.add(slotId);
  }
  inBatch.count += 1;
  batch.set(batchKey, inBatch);

  return { ok: true, master };
}

// ---------------------------------------------------------------------------
// Animal companion: the server owns `system.master.level` (BHR-F4-03, D-B02, REQ-PET-107..108)
// ---------------------------------------------------------------------------

/** The owner's character level (`system.level.value`, default 1 like the character schema). */
function readActorLevel(doc: Record<string, unknown>): number {
  const sys = doc["system"];
  if (!sys || typeof sys !== "object" || Array.isArray(sys)) return 1;
  const level = (sys as Record<string, unknown>)["level"];
  if (!level || typeof level !== "object" || Array.isArray(level)) return 1;
  const value = (level as Record<string, unknown>)["value"];
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

/** `system.master.level` as stored on a companion, or undefined when never cached. */
function readCachedMasterLevel(doc: Record<string, unknown>): unknown {
  const sys = doc["system"];
  if (!sys || typeof sys !== "object" || Array.isArray(sys)) return undefined;
  const master = (sys as Record<string, unknown>)["master"];
  if (!master || typeof master !== "object" || Array.isArray(master)) return undefined;
  return (master as Record<string, unknown>)["level"];
}

/** The owner actor of a linked animal companion, or null (not a linked animal companion / dangling). */
function masterOfAnimalCompanion(
  store: DocumentStore,
  companion: Record<string, unknown>,
): Record<string, unknown> | null {
  if (readCompanionKind(companion) !== "animalCompanion") return null;
  const masterId = readMasterActorId(companion);
  if (!masterId) return null;
  try {
    return store.get("actors", masterId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
}

/**
 * CREATE path: stamp the owner's level onto the payload before it is persisted, so a companion is
 * never born without the cache (it would carry `derived.companion.error` instead of a statblock).
 * Overrides whatever the creator sent: `system.master.level` is the server's field.
 */
function stampMasterLevelOnCreate(
  store: DocumentStore,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const master = masterOfAnimalCompanion(store, item);
  if (!master) return item;
  const sys = (item["system"] ?? {}) as Record<string, unknown>;
  const cache = sys["master"];
  const cacheObj =
    cache && typeof cache === "object" && !Array.isArray(cache)
      ? (cache as Record<string, unknown>)
      : {};
  return {
    ...item,
    system: { ...sys, master: { ...cacheObj, level: readActorLevel(master) } },
  };
}

/**
 * UPDATE path: make a persisted animal companion's `system.master.level` match its owner's level.
 * Returns the very same reference when nothing changed (no write, nothing to broadcast).
 */
function syncAnimalCompanionMasterLevel(
  store: DocumentStore,
  companion: Record<string, unknown>,
  authorCtx: { userId: string },
): Record<string, unknown> {
  const master = masterOfAnimalCompanion(store, companion);
  const id = companion["_id"];
  if (!master || typeof id !== "string") return companion;
  const level = readActorLevel(master);
  if (readCachedMasterLevel(companion) === level) return companion;
  return store.update("actors", id, { system: { master: { level } } }, authorCtx) ?? companion;
}

/**
 * D-B02: an Actor update that reaches an owner re-derives every animal companion linked to it
 * (`system.masterActorId`) and puts the ones that changed into the SAME broadcast. A companion whose
 * cache and derived block already match stays out (same reference, nothing re-sent). Mutates `updated`.
 */
function rederiveCompanionsOfUpdatedMasters(
  deps: DocHandlerDeps,
  documentType: string,
  updated: Record<string, unknown>[],
  authorCtx: { userId: string },
): void {
  if (documentType !== "Actor" || updated.length === 0) return;
  const masterIds = new Set(updated.map((d) => d["_id"]).filter((x) => typeof x === "string"));
  const companions = deps.store.getAll("actors", { type: COMPANION_ACTOR_TYPE }).filter((c) => {
    const masterId = readMasterActorId(c);
    return (
      masterId !== null && masterIds.has(masterId) && readCompanionKind(c) === "animalCompanion"
    );
  });
  for (const companion of companions) {
    const synced = syncAnimalCompanionMasterLevel(deps.store, companion, authorCtx);
    const recomputed = recomputeDerivedIfNeeded(deps, "Actor", synced, authorCtx);
    if (recomputed === companion) continue;
    const at = updated.findIndex((d) => d["_id"] === companion["_id"]);
    if (at >= 0) updated[at] = recomputed;
    else updated.push(recomputed);
  }
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
 * A companion created WITHOUT an explicit ownership map is born with a copy of
 * its master's (spec 45 DEC-ATR-19, REQ-ATR-064) — so the GM who creates a
 * player's eidolon does not create one the player cannot see. An explicit map
 * is the GM's override and is kept (REQ-DOC-029 "salvo override"). The
 * non-privileged path never reaches here: it FORCES the master's map above.
 * A copy at birth, not live inheritance: ownership stays a plain field that
 * every redaction predicate reads off the document itself (redaction.ts).
 * A dangling master falls back to the general rule (the store default).
 */
function inheritMasterOwnershipOnCreate(
  store: DocumentStore,
  item: Record<string, unknown>,
): Record<string, unknown> {
  if (!isCompanionDoc(item) || item["ownership"] !== undefined) return item;
  const masterId = readMasterActorId(item);
  if (!masterId) return item;
  try {
    return { ...item, ownership: { ...getOwnershipFromDoc(store.get("actors", masterId)) } };
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return item;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Player-created OWN character — REMOVED (O6 fixer C6, ficha-nivel3)
// ---------------------------------------------------------------------------
//
// O6/T6.1 briefly added a second doc:create exception (alongside r17-P1's
// companion one) letting a non-privileged PLAYER create their OWN character
// Actor. Reverted by the O6 fixer round: REQ-USR-025 (specs/05-usuarios-e-
// permissoes.md, "Emenda de 2026-08-16") already creates a blank character
// for every new PLAYER/TRUSTED user IN THE SAME TRANSACTION as the account
// (auth/service.ts's UserService.createUser), owned by that user from birth
// — and that spec amendment says in so many words this is "o único endereço
// da criação de personagem". A second create path was:
//   - REDUNDANT with REQ-USR-025 (decision #2, "Quem cria — O JOGADOR", is
//     already satisfied by the character being born WITH the user);
//   - UNREACHABLE from the shipped client: no screen ever emits a
//     doc:create of an Actor `type: "character"` (createNpc.ts's
//     NPC_CREATABLE_SUBTYPES is only `["npc", "hazard"]` — T6.1's own "pelo
//     Hub" trigger was never built);
//   - and, precisely because nothing exercised it, a live authority gap: the
//     exception let a PLAYER's `items[]` on the create payload straight
//     onto an Actor with NONE of the checks doc:update's embedded-item path
//     applies (validateEmbeddedItemForSystem, the non-empty-name guard,
//     augmentationSlotLimitViolation) — a hand-built op could seed a
//     brand-new character with a forged item of any shape.
// Editing one's own character needs no exception at all: the generic
// doc:update OWNER check (below) already passes for it, because
// REQ-USR-025a forces that character's ownership to {default: NONE,
// [userId]: OWNER} at birth.

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
// Character build legality (O6/T6.2)
// ---------------------------------------------------------------------------

/**
 * Refuse a write whose FULLY MERGED Actor document fails
 * `validateCharacterBuild` (`@fusion/system-pf2e`) — the same rules
 * `isFeatEligible` (planVM.ts) and the ability-boost math (derivations/
 * build.ts) already decided, checked again here so the client's picker
 * offering only legal choices is never the ONLY thing standing between a
 * player and an illegal build ("toda validação de permissão é no
 * servidor" — CLAUDE.md). A no-op for any non-character Actor or one with
 * no `system.build` (see the module's own docstring for exactly what is,
 * and is not, covered).
 *
 * O6 fixer C3 (importante): pass `existingDoc` (the document BEFORE this
 * write, when there is one — never on doc:create, which has no prior state)
 * to reject only the issues the write ITSELF introduces, not ones the
 * document already carried. Without this, validating the whole merged
 * document on EVERY doc:update — touching `system.build` or not, GM or not
 * — meant a single pre-existing illegal state (a legacy import, a level
 * that was never pruned on a past descend, a GM hand-edit) froze EVERY
 * future write to that actor, including HP, notes, and the very
 * `doc:update` that would have fixed the build: `removeChoice` clears one
 * slot at a time, and the merge still carries every other pre-existing
 * issue, so even the repair op was refused.
 */
function rejectIllegalCharacterBuild(
  deps: Pick<DocHandlerDeps, "store" | "systemModule">,
  mergedDoc: Record<string, unknown>,
  existingDoc?: Record<string, unknown>,
): Ack<never> | null {
  // House rules (A Queda, 2026-10-05): the world's variants relax slot/level
  // checks, so the server validates with the SAME flags the client's picker
  // and the derivation use (resolved from the world's Settings, absent = RAW).
  const world = resolveWorldVariantRules(deps.store, deps.systemModule);
  const variants: BuildValidationVariants = {};
  if (world.bonusGeneralFeatLevel1 !== undefined)
    variants.bonusGeneralFeatLevel1 = world.bonusGeneralFeatLevel1;
  if (world.ancestryFeatsInGeneralSlots !== undefined)
    variants.ancestryFeatsInGeneralSlots = world.ancestryFeatsInGeneralSlots;
  if (world.ancestryFeatLevelMinus2 !== undefined)
    variants.ancestryFeatLevelMinus2 = world.ancestryFeatLevelMinus2;
  const result = validateCharacterBuild(mergedDoc, variants);
  if (result.ok) return null;

  let newIssues = result.issues;
  if (existingDoc) {
    const before = validateCharacterBuild(existingDoc, variants);
    const beforeKeys = new Set(before.issues.map((issue) => `${issue.code}|${issue.path}`));
    newIssues = result.issues.filter((issue) => !beforeKeys.has(`${issue.code}|${issue.path}`));
  }
  if (newIssues.length === 0) return null;

  const summary = newIssues
    .map((issue) => `${issue.code} (${issue.path}): ${issue.message}`)
    .join("; ");
  return ackError("VALIDATION_FAILED", `Illegal character build — ${summary}`);
}

/**
 * O6 fixer C4/A6 (importante): `{"system.build": null}` inside a diff
 * DELETES the whole build ledger (documents/merge.ts's DELETE_KEY_NAMESPACES
 * treats null under `system` as key-deletion) — and a document with no
 * `system.build` is `validateCharacterBuild`'s own "r9 manual mode" no-op.
 * Left unchecked, that is a two-write bypass of every invariant this module
 * enforces: null the build, then freely re-add an illegal one (or leave the
 * now-orphaned embedded feats/choices with nothing validating them again).
 * Refused ONLY when the EXISTING document already has a non-null build (a
 * genuinely never-built r9 character keeps the right to stay that way) AND
 * the diff is the one explicitly nulling it — a diff that merely omits
 * `system.build` (deepMerge never removes a key the patch omits) is
 * unaffected, and so is a diff that REPLACES it with a new, still-validated
 * build object (caught by `rejectIllegalCharacterBuild` instead, same as
 * any other build write).
 */
function rejectCharacterBuildDeletion(
  existingDoc: Record<string, unknown>,
  expandedDiff: Record<string, unknown>,
): Ack<never> | null {
  if (existingDoc["type"] !== "character") return null;

  const existingSystem = existingDoc["system"];
  const existingBuild =
    existingSystem && typeof existingSystem === "object" && !Array.isArray(existingSystem)
      ? (existingSystem as Record<string, unknown>)["build"]
      : undefined;
  if (existingBuild === undefined || existingBuild === null) return null;

  const diffSystem = expandedDiff["system"];
  if (!diffSystem || typeof diffSystem !== "object" || Array.isArray(diffSystem)) return null;
  const diffSystemRec = diffSystem as Record<string, unknown>;
  if (!("build" in diffSystemRec) || diffSystemRec["build"] !== null) return null;

  return ackError(
    "VALIDATION_FAILED",
    "Illegal character build — cannot delete system.build once the character has one",
  );
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

    // REQ-CFG-070/071: Setting writes require GAMEMASTER strictly, checked
    // before ownership/TRUSTED-floor logic below — an ASSISTANT or a plain
    // TRUSTED user (who would otherwise pass as OWNER of a Setting they just
    // created) must never be able to create world config.
    if (documentType === "Setting" && !isGamemasterStrict(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only the Gamemaster can create Setting documents");
    }

    // REQ-CFG-042: a `fusion.permissions` Setting's `value` is validated
    // against the domain world-permissions.ts owns (known key, role in
    // PLAYER..GAMEMASTER) before it is ever persisted — the GAMEMASTER-strict
    // check above only proves WHO may write, not WHAT was written. Without
    // this, a forged/malformed override (e.g. `{"ACTOR_CREATE": 0}`) would
    // sail straight through and `resolvePermissionMinRole` would then have to
    // treat NONE as a legitimate floor.
    if (documentType === "Setting") {
      for (const rawItem of data) {
        const item = rawItem as Record<string, unknown>;
        if (item["key"] === PERMISSIONS_SETTING_KEY) {
          const errors = validatePermissionOverrides(item["value"]);
          if (errors.length > 0) {
            return ackError(
              "VALIDATION_FAILED",
              `Invalid ${PERMISSIONS_SETTING_KEY} value: ${errors.join("; ")}`,
            );
          }
        }
      }
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

    // Permission check: GM_ONLY_CREATE_DELETE types require GM/ASSISTANT —
    // UNLESS the world's Permissões section (REQ-CFG-040..042, REQ-USR-009)
    // has moved this documentType's configured floor (CREATE_PERMISSION_
    // KEY_BY_TYPE) to something this requester's role already meets
    // (`meetsConfiguredFloor` below).
    //
    // REQ-USR-010 spells out the check as: (1) `role === GAMEMASTER` always
    // passes; (2) otherwise `role >= effectiveDefaultRole`. For a type with a
    // configured key, that is the WHOLE gate — `isPrivileged` (ASSISTANT+)
    // must never be consulted as a shortcut here, or the table could only ever
    // WIDEN the door: a GM raising ACTOR_CREATE's floor to GAMEMASTER would
    // have no effect on an ASSISTANT, who `isPrivileged` waves through before
    // the table is ever read (found by execution: the selector accepts role 4
    // and marks the row "Alterado", but the write does nothing). `isPrivileged`
    // is kept ONLY as the fallback for the three GM_ONLY_CREATE_DELETE types
    // REQ-USR-008 defines no key for (Scene, Macro, Combat) — those have no
    // configured floor to raise, so their gate stays exactly what it was.
    //
    // EXCEPTION (r17-P1): a non-privileged PLAYER may create Actor(s) that
    // are companions (familiars) linked to a master they own (O6 fixer C6
    // removed the second, "own character" exception this comment used to
    // also describe — see the block above `isCompanionDoc`). Each item in
    // the batch must pass the companion authorizer; the resulting ownership
    // (the master's) is captured so we can force it onto the created
    // document (never trusting a client-supplied ownership). Any item that
    // is not an authorized companion falls back to the GM-only denial for
    // the WHOLE batch. Not reached at all when the configured floor already
    // authorized the batch.
    const forcedOwnership = new Map<number, Ownership>();
    // True once the batch is fully authorized as a player companion create
    // — it then bypasses the generic TRUSTED role floor below (a strictly
    // stronger check than TRUSTED: OWNER of a granting master with no
    // duplicate familiar).
    let authorizedNonPrivilegedActorBatch = false;
    // True once a configured Permissões override (or its matching default,
    // REQ-CFG-041) has already authorized this create — also bypasses the
    // generic TRUSTED role floor below, so a floor configured under TRUSTED
    // is not silently re-blocked by it.
    let authorizedByPermissionTable = false;
    if (GM_ONLY_CREATE_DELETE.has(documentType)) {
      const permissionKey = CREATE_PERMISSION_KEY_BY_TYPE[documentType];
      if (permissionKey !== undefined) {
        const minRole = resolvePermissionMinRole(deps.store, permissionKey);
        const meetsConfiguredFloor =
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          ctx.role === UserRole.GAMEMASTER || ctx.role >= minRole;

        if (meetsConfiguredFloor) {
          authorizedByPermissionTable = true;
        } else if (documentType !== "Actor") {
          return ackError("PERMISSION_DENIED", `Only GM/Assistant can create ${documentType}`);
        } else {
          // Every item must be an authorized companion, else deny the whole
          // batch (O6 fixer C6: the own-character branch was removed here).
          const companionsInBatch = new Map<string, BatchCompanions>();
          for (let i = 0; i < data.length; i++) {
            const item = data[i] as Record<string, unknown>;
            if (isCompanionDoc(item)) {
              const auth = authorizePlayerCompanionCreate(deps, ctx, item, companionsInBatch);
              if (!auth.ok) {
                return ackError(auth.code, auth.message);
              }
              // Force the familiar's ownership to mirror the master's owners.
              forcedOwnership.set(i, getOwnershipFromDoc(auth.master));
            } else {
              return ackError("PERMISSION_DENIED", `Only GM/Assistant can create ${documentType}`);
            }
          }
          authorizedNonPrivilegedActorBatch = data.length > 0;
        }
      } else if (!isPrivileged(ctx.role)) {
        // Scene / Macro / Combat: REQ-USR-008 defines no configurable key for
        // these — the historical ASSISTANT+ gate is the only rule.
        return ackError("PERMISSION_DENIED", `Only GM/Assistant can create ${documentType}`);
      }
    }

    // Non-privileged users can create their own documents for allowed types
    // (REQ-USR-008; JournalEntry's key is JOURNAL_CREATE, configurable via
    // world-permissions.ts — everything else reaching this point, e.g.
    // Folder, keeps the historical TRUSTED+ floor since REQ-USR-008 defines no
    // key for them). Skipped for an already-authorized player companion/own-
    // character batch (r17-P1 / O6-T6.1) or an already-authorized
    // configured-permission batch: a plain PLAYER owning a granting master
    // (or creating their own character), or a role meeting a lowered
    // configured floor, is authorized above.
    //
    // Runs for EVERY role, including GM/ASSISTANT — not just non-privileged —
    // for the same REQ-USR-010 reason as the block above: JournalEntry's floor
    // is configurable up to GAMEMASTER, and `isPrivileged` must not be able to
    // wave an ASSISTANT past a floor the GM raised above ASSISTANT. A
    // GAMEMASTER always passes (role === GAMEMASTER short-circuit); everyone
    // else, privileged or not, is measured against the resolved floor — which
    // for every type but JournalEntry is the fixed TRUSTED(2), so this changes
    // nothing for ASSISTANT(3)/GAMEMASTER(4) on those types.
    if (!authorizedNonPrivilegedActorBatch && !authorizedByPermissionTable) {
      const minRole =
        documentType === "JournalEntry"
          ? resolvePermissionMinRole(deps.store, "JOURNAL_CREATE")
          : UserRole.TRUSTED;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (ctx.role !== UserRole.GAMEMASTER && ctx.role < minRole) {
        return ackError("PERMISSION_DENIED", "Insufficient role to create documents");
      }
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
          // REQ-CTT-072/080: knowledge arriving at creation is normalized for a
          // privileged creator and dropped for anyone else — otherwise the
          // player-companion path (r17-P1) would be a way to author knowledge
          // that doc:update refuses.
          item = sanitizeKnowledgeOnCreate(item, isPrivileged(ctx.role));
          // REQ-NPC-047/080: the GM chooses the initial attitude at creation;
          // anyone else loses it, and so does a subtype that cannot carry one
          // (a hazard, CA-NPC-010) — otherwise the create path would author a
          // field `doc:update` refuses.
          item = sanitizeAttitudeOnCreate(item, isPrivileged(ctx.role));
          // BHR-F3-06: marks are authored by mark:set only (doc:update refuses them too).
          item = stripTokenMarksOnCreate(item, isPrivileged(ctx.role));
          // O6/T6.2: a create payload IS the full document (no `existing` to
          // merge onto), so it can be validated as-is — same gate the update
          // path applies to the merged document.
          const rejectionBuild = rejectIllegalCharacterBuild(deps, item);
          if (rejectionBuild) return rejectionBuild;
          // I2 (revisão adversarial 3): system.currency was accepted
          // unchecked (any shape, any keys) — validate it against the
          // active system's registered Actor model before it is persisted.
          const currencyValidation = validateActorCurrencyForSystem(deps.systemModule, item);
          if (!currencyValidation.ok) {
            return ackError("VALIDATION_FAILED", currencyValidation.message);
          }
          item = currencyValidation.doc;
        }
        // r17-P1: for a player-authorized companion create, force the master's
        // ownership map onto the payload so the master's owners own the
        // familiar and a forged/absent ownership cannot widen access.
        const forced = forcedOwnership.get(i);
        if (forced) {
          item = { ...item, ownership: forced };
        } else if (documentType === "Actor") {
          item = inheritMasterOwnershipOnCreate(deps.store, item);
        }
        if (documentType === "Actor") item = decideCompanionActiveOnCreate(deps.store, item);
        // BHR-F4-03: the server (never the client) writes the owner's level into the cache.
        if (documentType === "Actor") item = stampMasterLevelOnCreate(deps.store, item);
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

    // REQ-CFG-035: a world's FIRST `variantRules.classLevels`/`freeArchetype`
    // Setting is a doc:create (no Setting document existed yet), not a
    // doc:update — needs the same re-derivation as the update path below.
    rederiveActorsForChangedVariantRules(deps, documentType, created, authorCtx);

    const seq = deps.seqStore.next();
    const broadcastPayload = { documentType, documents: created };
    const envelope = buildBroadcastEnvelope("doc:create", broadcastPayload, seq);
    deps.opBuffer.push(envelope);

    // Broadcast to world (per-socket hidden-token filtering applied for Scene).
    broadcastToWorld(deps.ns, envelope, documentType);

    return ackOk({ documentType, documents: created }, seq);
  };
}

/**
 * Key suffixes `resolveWorldVariantRules` reads (`documents/
 * world-variant-rules.ts`) — any system id can prefix them (`pf2e:...`,
 * `pf2e-sf2e:...`), so this matches by suffix, never a hardcoded full key.
 */
const VARIANT_RULES_KEY_SUFFIXES = [
  ":variantRules.classLevels",
  ":variantRules.freeArchetype",
  // HJ-09 (#434): same overlay, same re-derivation on change.
  ":campaign.trainedSkills",
  // House rules of A Queda (2026-10-05): same overlay, same re-derivation.
  ":variantRules.bonusGeneralFeatLevel1",
  ":variantRules.freeOccultismOrReligion",
  ":variantRules.ancestryFeatsInGeneralSlots",
  ":variantRules.ancestryFeatLevelMinus2",
];

function isVariantRulesSettingKey(key: unknown): boolean {
  return typeof key === "string" && VARIANT_RULES_KEY_SUFFIXES.some((s) => key.endsWith(s));
}

/**
 * REQ-CFG-035: when a just-persisted `doc:update` batch touched a
 * `variantRules.classLevels`/`variantRules.freeArchetype` Setting, re-derive
 * every Actor in the world and broadcast the ones that actually changed as
 * a second `doc:update("Actor", ...)` envelope.
 *
 * No-op for anything else (documentType !== "Setting", or a Setting update
 * that didn't touch either key) — this never fires on the far more common
 * path of an ordinary Actor/Item/Scene write.
 *
 * `recomputeDerivedIfNeeded` is the single existing entry point for "derive
 * this Actor and persist `system.derived` if it changed" (documents/
 * derive.ts) — reused here rather than re-implemented, so this gets its
 * clone/prune/version-bump correctness for free. It returns the exact same
 * object reference it was given when nothing changed, which is what tells
 * this loop whether to include a given actor in the broadcast.
 */
function rederiveActorsForChangedVariantRules(
  deps: DocHandlerDeps,
  documentType: string,
  updatedSettings: Record<string, unknown>[],
  authorCtx: { userId: string },
): void {
  if (documentType !== "Setting" || !deps.systemModule) return;
  if (!updatedSettings.some((doc) => isVariantRulesSettingKey(doc["key"]))) return;

  const actors = deps.store.getAll("actors");
  const rederived: Record<string, unknown>[] = [];
  for (const actor of actors) {
    const recomputed = recomputeDerivedIfNeeded(deps, "Actor", actor, authorCtx);
    if (recomputed !== actor) rederived.push(recomputed);
  }

  if (rederived.length === 0) return;

  const seq = deps.seqStore.next();
  const envelope = buildBroadcastEnvelope(
    "doc:update",
    { documentType: "Actor", documents: rederived },
    seq,
  );
  deps.opBuffer.push(envelope);
  broadcastToWorld(deps.ns, envelope, "Actor");
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

    // Prototype pollution: refuse before anything is looked up or expanded. Covers the three
    // applyDotPathDiff entry points (primary, embedded, token) because they all pass through here.
    for (const upd of updates) {
      const polluting = findPollutingKey(upd.diff);
      if (polluting !== null) {
        return ackError(
          "VALIDATION_FAILED",
          `Diff for ${documentType}/${upd._id} contains the forbidden key segment "${polluting}"`,
        );
      }
    }

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

    // REQ-CFG-070/071: Setting writes require GAMEMASTER strictly — decided
    // before the generic per-item OWNER-or-privileged check below, the same
    // way REQ-CEN-070 gates Scene here (ownership of a Setting document is
    // NOT a licence to write it; the creator of a Setting is otherwise its
    // OWNER and would sail through the ownership check unguarded).
    if (documentType === "Setting" && !isGamemasterStrict(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only the Gamemaster can update Setting documents");
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

      const expandedDiffForChecks = applyDotPathDiff({}, upd.diff);
      const rejection = rejectUnwritableField(
        documentType,
        expandedDiffForChecks,
        ctx.role,
        existing,
      );
      if (rejection) return rejection;

      // REQ-CFG-042: same domain validation as doc:create's guard above,
      // applied to the `fusion.permissions` Setting's `value` diff before it
      // is merged in. `existing` (loaded just above) is what tells us this
      // specific Setting document IS the permissions table — documentType
      // alone is not enough, a world can have many Setting documents.
      if (documentType === "Setting" && existing["key"] === PERMISSIONS_SETTING_KEY) {
        const diffValue = expandedDiffForChecks["value"];
        if (diffValue !== undefined) {
          const errors = validatePermissionOverrides(diffValue);
          if (errors.length > 0) {
            return ackError(
              "VALIDATION_FAILED",
              `Invalid ${PERMISSIONS_SETTING_KEY} value: ${errors.join("; ")}`,
            );
          }
        }
      }

      // O6/T6.2: the client's builder (planVM.ts) already refuses to OFFER
      // an illegal choice, but nothing re-checks the payload once it is
      // already an arbitrary `doc:update` diff — a hand-built op, or a
      // client bug, could otherwise persist a dedication into a `classFeat`
      // slot or an ability boost at a level PF2e never grants one. Judged
      // against the FULLY MERGED document (same deepMerge the store itself
      // applies, documents/merge.ts) so a diff that only touches
      // `system.build.choices` is checked together with whatever level the
      // document already has — never against the bare diff alone.
      //
      // O6 fixer C3/C4: `existing` is passed to `rejectIllegalCharacterBuild`
      // so a pre-existing illegal state doesn't freeze every future write
      // (only NEW issues the diff introduces are refused), and
      // `rejectCharacterBuildDeletion` (C4/A6) runs first to close the
      // `{"system.build": null}` bypass that would otherwise make the
      // merged-doc check above a no-op.
      if (documentType === "Actor") {
        const rejectionBuildDeletion = rejectCharacterBuildDeletion(
          existing,
          expandedDiffForChecks,
        );
        if (rejectionBuildDeletion) return rejectionBuildDeletion;
        const merged = deepMerge(existing, expandedDiffForChecks);
        const rejectionBuild = rejectIllegalCharacterBuild(deps, merged, existing);
        if (rejectionBuild) return rejectionBuild;

        // I2 (revisão adversarial 3): same currency check as doc:create,
        // applied to the FULLY MERGED document — a diff that only touches
        // `system.currency` still gets validated together with the type it
        // is merging onto.
        const currencyValidation = validateActorCurrencyForSystem(deps.systemModule, merged);
        if (!currencyValidation.ok) {
          return ackError("VALIDATION_FAILED", currencyValidation.message);
        }
      }
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
        // BHR-F4-03: an animal companion edited directly (e.g. "Trocar tipo", a GM link) gets the
        // owner's level refreshed first, so the derivation never runs on a missing/stale cache.
        if (documentType === "Actor") {
          result = syncAnimalCompanionMasterLevel(deps.store, result, authorCtx);
        }
        result = recomputeDerivedIfNeeded(deps, documentType, result, authorCtx);
        updated.push(result);
      }
    }

    // BHR-F4-03 (D-B02): the owner changed -> re-derive its animal companions in the same broadcast.
    rederiveCompanionsOfUpdatedMasters(deps, documentType, updated, authorCtx);

    // REQ-CFG-035: a `variantRules.classLevels`/`variantRules.freeArchetype`
    // Setting is read by EVERY Actor's derivation (world-variant-rules.ts),
    // not just the Setting document itself — before this, flipping the
    // toggle in Configurações → Mundo changed nothing until each actor's
    // NEXT unrelated write (achado 6, revisão core#273/satélite#278,
    // 26/09/2026): `system.derived` stayed stale (wrong HP/proficiencies)
    // for everyone until then, silently. Re-derive every character Actor
    // right here, in the same handler call that persisted the setting, and
    // broadcast the results as a second `doc:update` envelope so every
    // connected client (not just whoever reloads) sees the corrected
    // numbers immediately.
    rederiveActorsForChangedVariantRules(deps, documentType, updated, authorCtx);

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

    // `Folder` (REQ-NPC-022 / REQ-NPC-080): deleting a folder is a composed
    // operation — its subfolders lift to the deleted folder's own parent and
    // its documents are released to "Sem pasta" BEFORE the row itself goes,
    // so nothing is left pointing at an id that no longer exists.
    // `folder:delete` (folder-handlers.ts) is the one door that does all
    // three steps in order; this generic path only ever does the third one.
    // Membership in GM_ONLY_CREATE_DELETE is not enough by itself here — that
    // set still lets a *privileged* caller reach the ordinary OWNER/GM delete
    // branch below, which would remove the row without reparenting anything.
    // So Folder is refused unconditionally, for every role including
    // privileged, the same way ChatMessage is refused above by type rather
    // than by field.
    if (documentType === "Folder") {
      return ackError(
        "PERMISSION_DENIED",
        "Folder is not deletable through doc:delete — use folder:delete (REQ-NPC-022 / REQ-NPC-080)",
      );
    }

    // Embedded token deletion
    if (parent) {
      return handleEmbeddedDelete(deps, ctx, documentType, ids, parent);
    }

    const table = resolveTable(documentType);
    if (!table) {
      return ackError("VALIDATION_FAILED", `Unknown documentType: ${documentType}`);
    }

    // REQ-CFG-070/071: Setting writes require GAMEMASTER strictly — same
    // rationale as the create/update guards above; Setting is not in
    // GM_ONLY_CREATE_DELETE so without this an ASSISTANT or the OWNER of a
    // self-created Setting could delete world config via the ownership path
    // below.
    if (documentType === "Setting" && !isGamemasterStrict(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only the Gamemaster can delete Setting documents");
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
    // REQ-CTT-076: which of the ids being deleted are player characters must
    // also be read BEFORE the rows go — after the delete the subtype is gone
    // with the document, and there would be no way to tell which contacts'
    // exceptions have to be swept.
    const deletedCharacterIds: string[] = [];
    const deletedActorIds = new Set<string>();
    const deletedNonPlayableIds: string[] = [];
    if (documentType === "Actor") {
      for (const id of ids) {
        try {
          const target = deps.store.get("actors", id);
          deletedActorIds.add(id);
          if (isCharacterActor(target)) deletedCharacterIds.push(id);
          if (isNonPlayableActor(target)) deletedNonPlayableIds.push(id);
        } catch {
          // Missing document — the delete loop below reports NOT_FOUND.
        }
      }
    }

    // REQ-NPC-052: a non-playable in an encounter that has not ended is NOT
    // deletable. Deleting it would leave the tracker holding a combatant that
    // points at nothing — the turn order still walks onto it and no screen can
    // take it out, because every control the tracker draws is keyed on the actor
    // it just lost. The refusal names the encounter AND the two ops that unblock
    // it (REQ-CBT-003 / REQ-CBT-006): a wall without a door is not a refusal, it
    // is a dead end.
    //
    // Judged BEFORE the delete loop and atomic for the batch, exactly like the
    // on-air scene guard above: a mixed list of a free NPC and one in combat
    // deletes NOTHING, so there is never a half-applied delete to undo.
    for (const id of deletedNonPlayableIds) {
      const blocking = findBlockingCombats(deps.store, new Set([id]));
      if (blocking.length > 0) {
        return ackError("VALIDATION_FAILED", blockingCombatMessage(id, blocking));
      }
    }

    // REQ-NPC-053: every presence of a deleted actor leaves every scene. A token
    // is not a row of its own — it lives inside the Scene's JSON (DEC-PER-02) —
    // so deleting the Actor touches none of them, and the leftover would be a
    // figure on the table that no sheet answers for.
    //
    // PLANNED here, applied after the rows are gone: a plan read while the actor
    // still exists cannot be wrong about which scenes it touches, and a NOT_FOUND
    // halfway through the delete loop then leaves no scene already rewritten for
    // a delete that never happened.
    //
    // spec 41-token.md TK091/DEC-TOK-17: this is a DELIBERATE exception to
    // DEC-DOC-11 (soft-reference-by-default for a Document referencing
    // another). A token's `actorId` is NOT a soft reference that survives its
    // target's deletion — REQ-TOK-093 requires the token to go with it, in
    // EVERY scene of the world, not just be left pointing at a ghost. Do not
    // "fix" this back into a soft reference: an orphaned token with no actor
    // to draw, name, or check ownership against is exactly the state
    // REQ-TOK-002/DEC-TOK-04 already refuse a token from ever entering.
    const presenceRemovals = planPresenceRemoval(deps.store, deletedActorIds);

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

    // REQ-NPC-053: now the rows are gone, take the presences with them. The
    // delta travels the same `seq`/`OpBuffer`/redaction pipe as any other Scene
    // change, so no client has to reload to stop drawing a token whose actor no
    // longer exists (and a player seat still only hears about the scene on air).
    if (presenceRemovals.length > 0) {
      const scenesWithoutPresences = applyPresenceRemoval(deps.store, presenceRemovals, {
        userId: ctx.userId,
      });
      if (scenesWithoutPresences.length > 0) {
        const presenceSeq = deps.seqStore.next();
        const presenceEnvelope = buildBroadcastEnvelope(
          "doc:update",
          { documentType: "Scene", documents: scenesWithoutPresences },
          presenceSeq,
        );
        deps.opBuffer.push(presenceEnvelope);
        broadcastToWorld(deps.ns, presenceEnvelope, "Scene");
      }
    }

    // REQ-CTT-076: a deleted character leaves its exceptions behind in every
    // contact that named it — rules about a character that no longer exists,
    // which the "Quem conhece quem" grid could never reach again because the
    // column is gone. Sweep them now, leaving every general rule as it was,
    // and broadcast the resulting document changes as their own delta so no
    // client has to reload to be rid of them (REQ-CTT-075).
    if (deletedCharacterIds.length > 0) {
      const swept = sweepCharactersFromKnowledge(deps.store, deletedCharacterIds, {
        userId: ctx.userId,
      });
      if (swept.length > 0) {
        const sweepSeq = deps.seqStore.next();
        const sweepEnvelope = buildBroadcastEnvelope(
          "doc:update",
          { documentType: "Actor", documents: swept },
          sweepSeq,
        );
        deps.opBuffer.push(sweepEnvelope);
        broadcastToWorld(deps.ns, sweepEnvelope, "Actor");
      }
    }

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
  // require TOKEN_CREATE's configured floor (REQ-CFG-040..042, defaulting to
  // ASSISTANT+ — REQ-USR-008's own default, world-permissions.ts). Actor-
  // embedded Items are governed purely by the OWNER ownership check below —
  // a PLAYER managing spells/gear on their own sheet is the intended path
  // (r10-C, found in live verification: the blanket gate blocked every
  // player from adding a spell to their own actor). Non-Token embedded types
  // (Combatant) have no REQ-USR-008 key, so they keep the historical
  // TRUSTED+ floor unconditionally.
  //
  // REQ-USR-010: `isPrivileged` is deliberately NOT the outer gate here — the
  // same reasoning as the primary doc:create path above. A GM raising
  // TOKEN_CREATE's floor above ASSISTANT must actually stop an ASSISTANT;
  // `role === GAMEMASTER` is the one unconditional pass, everyone else is
  // measured against the resolved floor (fixed TRUSTED for Combatant, so this
  // changes nothing for that type).
  if (parent.type !== "Actor") {
    const minRole =
      embeddedType === "Token"
        ? resolvePermissionMinRole(deps.store, "TOKEN_CREATE")
        : UserRole.TRUSTED;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (ctx.role !== UserRole.GAMEMASTER && ctx.role < minRole) {
      return ackError("PERMISSION_DENIED", "Insufficient role to create embedded documents");
    }
  }

  // Load parent — RAW (REQ-TOK-002): the embedded collection below is
  // reconstructed from this doc and persisted with a full-array replace
  // (REQ-DOC-037). Reading it through the filtered `get()` here would
  // permanently drop a legacy token (no resolvable actorId) from the ROW on
  // the very first embedded write to a legacy scene — see `getRaw`'s
  // docstring. Ownership/visibility below don't depend on `tokens`, so raw
  // vs. filtered makes no difference to them. `updatedParent` is re-read
  // through the filtered `get()` before it reaches the ack/broadcast below.
  let parentDoc: Record<string, unknown>;
  try {
    parentDoc = deps.store.getRaw(parentTable as never, parent.id);
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
      // REQ-TOK-002/CA-TOK-003/DEC-TOK-05: checked BEFORE the generic schema
      // parse so a null/absent/dangling actorId gets our explicit message
      // ("actorId is required and must resolve to an existing Actor")
      // instead of Zod's generic "Expected string, received null".
      const actorIdError = validateTokenActorId(deps.store, raw["actorId"]);
      if (actorIdError) {
        return ackError(actorIdError.code, actorIdError.message);
      }
      // §7.2 obligatory (x, y) / derived (footprint, art, possession) /
      // refused (actorDelta) rows — TK025, REQ-TOK-020/022, DEC-TOK-05,
      // CA-TOK-004. Checked on the raw wire payload, before any default is
      // applied, so a derived field is REFUSED rather than silently
      // stripped by the schema's `.strip()` behavior.
      const contractError = validateTokenCreateContract(raw);
      if (contractError) {
        return ackError(contractError.code, contractError.message);
      }
      // `flags.fusion.mount` (MountState, spec 52 §2.5) is written by the mount handler only: a token a
      // player creates cannot be born already mounted (wave 7 review). The GM may.
      if (!isPrivileged(ctx.role) && readTokenMountFlag(raw) !== undefined) {
        return ackError(
          "PERMISSION_DENIED",
          "flags.fusion.mount is not writable through doc:create by a player",
        );
      }
      // §7.2 overridable rows whose "inherit when absent" default is more
      // than a Zod literal: `actorLink` by the base actor's subtype
      // (REQ-DOC-061/REQ-TOK-023) and `bar1`/`bar2` by the active system's
      // manifest (REQ-SYS-004/REQ-TOK-024). Every other overridable field
      // (hidden, seenBy, disposition, name, rotation, elevation, vision,
      // light) already inherits correctly from TokenDocumentSchema's own
      // Zod defaults below.
      const withDefaults = applyTokenCreateDefaults(deps.store, deps.systemModule, raw);
      const tokenResult = TokenDocumentSchema.safeParse(withDefaults);
      if (!tokenResult.success) {
        return ackError("VALIDATION_FAILED", tokenResult.error.message);
      }
      created.push(tokenResult.data);
    } else {
      // SF2e augmentation slot-limit validation (REQ-SF2-024, CA-SF2-05).
      //
      // This handler is ONE of the two code paths that embed an Item into an
      // Actor's items[] collection in production (doc:create with
      // documentType="Item" + parent={type:"Actor", id}); the other is
      // `compendium:importToActor` (spec 43 §5.7, DEC-CPD-05). The system-api
      // hook bus is never invoked by either (see systems/sf2e/src/hooks/
      // augmentation.ts docstring for the full investigation), so both call
      // the SAME predicate, which lives in documents/embedded-item.ts. It is
      // gated on the world's systemId being "sf2e" (a world runs a single
      // system for all its actors — there is no per-Actor systemId field) so
      // pf2e/other worlds are entirely unaffected. Checked against `existing`
      // PLUS any augmentation already accepted earlier in this same batch, so
      // a single doc:create call with several augmentations is capped too.
      if (embeddedType === "Item" && parent.type === "Actor") {
        const augViolation = augmentationSlotLimitViolation(
          { systemId: deps.systemId, sourceSystemIds: deps.systemModule?.manifest.sourceSystemIds },
          [...existing, ...created] as AugmentationLikeItem[],
          raw,
        );
        if (augViolation !== null) {
          return ackError("VALIDATION_FAILED", augViolation);
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

  // O6 fixer C4 (importante): this is the ONE door that actually authors an
  // item embedded straight into a character Actor in production (the other,
  // compendium:importToActor, is out of this fixer round's scope) — the
  // feat/dedication FEAT_SLOT_MISMATCH check in @fusion/system-pf2e reads
  // `flags.fusion.build.slot` off the item itself, so it can only ever fire
  // for real if it also runs HERE, not just on the Actor's own doc:update.
  // `existingDoc` passed so a pre-existing issue elsewhere in the sheet
  // doesn't block an unrelated embedded create (C3's same reasoning).
  if (parent.type === "Actor" && parentDoc["type"] === "character") {
    const mergedForValidation = { ...parentDoc, [collectionKey]: updatedCollection };
    const rejectionBuild = rejectIllegalCharacterBuild(deps, mergedForValidation, parentDoc);
    if (rejectionBuild) return rejectionBuild;
  }

  const patch: Record<string, unknown> = { [collectionKey]: updatedCollection };

  let updatedParent = deps.store.update(parentTable as never, parent.id, patch, {
    userId: ctx.userId,
  });

  if (!updatedParent) {
    return ackError("INTERNAL_ERROR", "Failed to update parent document");
  }

  // REQ-TOK-002: `updatedParent` above was built from the RAW `parentDoc`
  // (getRaw), so a legacy token in this scene survived the write on disk —
  // re-read through the filtered `get()` before it can reach the ack or the
  // broadcast below (no-op for non-Scene tables/documents without tokens).
  updatedParent = deps.store.get(parentTable as never, parent.id);

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
    // RAW (REQ-TOK-002) — see handleEmbeddedCreate's comment: `collection`
    // below is reconstructed from this doc and persisted with a full-array
    // replace. `updatedParent` is re-read through the filtered `get()` before
    // it reaches the broadcast further down.
    let parentDoc: Record<string, unknown>;
    try {
      parentDoc = deps.store.getRaw(parentTable as never, parentId);
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
      // Only GM/ASSISTANT may change actorId. `diffTouchesField` (not a bare
      // `in` check) so a dotted path can't dodge the gate — see its docstring.
      if (diffTouchesField(sanitizedDiff, "actorId") && !isPrivileged(ctx.role)) {
        return ackError(
          "PERMISSION_DENIED",
          `Only GM/Assistant can change actorId on token ${tokenId}`,
        );
      }

      // REQ-TOK-010/012/013 (TK025 fix): the six DERIVED fields
      // (width/height/texture/img/ownership/userId) §7.2 refuses at
      // creation are refused here too — a doc:update persists the
      // diff-applied token directly, with no schema re-parse, so nothing
      // else stops one of these from being written straight to the
      // database and echoed in the broadcast. Checked on every Token
      // update (privileged or not — these fields are server-computed for
      // everyone, not a permission question) and on the pre-diff
      // `sanitizedDiff`, so the refusal fires before any write is computed.
      if (embeddedType === "Token") {
        const derivedFieldError = validateTokenUpdateDerivedFields(sanitizedDiff);
        if (derivedFieldError) {
          return ackError(derivedFieldError.code, derivedFieldError.message);
        }
      }

      // Apply diff to token
      const idx = collection.findIndex((t) => t["_id"] === tokenId);
      if (idx === -1) {
        return ackError("NOT_FOUND", `Embedded doc not found: ${embeddedType}/${tokenId}`);
      }

      // Build the updated token by applying dot-path diff (uses sanitized diff)
      const existingToken = collection[idx] ?? {};
      // Snapshot BEFORE patching: applyDotPathDiff copies the top level only, so a dotted path walks
      // into (and mutates) the nested objects `existingToken` still shares.
      const mountBefore = JSON.stringify(readTokenMountFlag(existingToken));
      const patchedToken = applyDotPathDiff(existingToken, sanitizedDiff);

      // BHR-F4-03 extension: `flags.fusion.mount` (MountState, spec 52 §2.5) is written by the mount
      // handler only. Judged on the RESULT, so `flags.fusion.mount` itself, a `-=mount`/null, and a
      // replacement of `flags` / `flags.fusion` that alters it are all caught the same way. The GM may.
      if (
        embeddedType === "Token" &&
        !isPrivileged(ctx.role) &&
        mountBefore !== JSON.stringify(readTokenMountFlag(patchedToken))
      ) {
        return ackError(
          "PERMISSION_DENIED",
          `flags.fusion.mount on token ${tokenId} is not writable through doc:update by a player`,
        );
      }

      // REQ-TOK-002/CA-TOK-003/DEC-TOK-05: the diff was only barred from
      // TOUCHING actorId when the caller is non-privileged (above). A
      // GM/ASSISTANT reaches this point free to set actorId to null or to an
      // id that resolves to nothing — T-5, reproduced in
      // token-actor-validation.test.ts — since nothing here re-validates the
      // patched token against the Token schema. Checked on every Token
      // update (not just ones that touch actorId) so an existing, already-
      // orphaned token cannot be further mutated either.
      if (embeddedType === "Token") {
        const actorIdError = validateTokenActorId(deps.store, patchedToken["actorId"]);
        if (actorIdError) {
          return ackError(actorIdError.code, actorIdError.message);
        }
        // REQ-DOC-034/DEC-TOK-05 (TK025): actorDelta is the one field §7.2
        // refuses at creation, refuses UNCONDITIONALLY for a non-privileged
        // caller on UPDATE (the dedicated TokenActor route is their only
        // route of authorship), and for GM/Assistant allows on UPDATE only
        // on an unlinked token. Evaluated against the DIFF-APPLIED
        // actorLink, not the pre-diff one, so a single update that both
        // unlinks the token and sets its delta is judged by the new state.
        const actorDeltaError = validateTokenUpdateActorDelta(
          ctx.role,
          patchedToken["actorLink"],
          diffTouchesField(sanitizedDiff, "actorDelta"),
        );
        if (actorDeltaError) {
          return ackError(actorDeltaError.code, actorDeltaError.message);
        }
      }

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

      // BHR-F5-03 (D-B03): a mounted pair is one body — the mount drags its rider in this same write; a
      // mounted rider is not movable by a player (and the GM moving him takes him off the mount).
      if (embeddedType === "Token") {
        const moved = applyMountMovement(
          deps.store,
          parentId,
          collection,
          idx,
          patchedToken,
          isPrivileged(ctx.role),
        );
        if (!moved.ok) return ackError(moved.code, moved.message);
        collection.splice(0, collection.length, ...moved.tokens);
        continue;
      }

      collection[idx] = patchedToken;
    }

    // O6 fixer C4 (importante): an embedded update (e.g. a GM correcting a
    // feat's own `system.level`, or `flags.fusion.build` itself) can make a
    // build FEAT_SLOT_MISMATCH true just as much as filing the choice can —
    // same reasoning as handleEmbeddedCreate above.
    if (resolvedParentType === "Actor" && parentDoc["type"] === "character") {
      const mergedForValidation = { ...parentDoc, [collectionKey]: collection };
      const rejectionBuild = rejectIllegalCharacterBuild(deps, mergedForValidation, parentDoc);
      if (rejectionBuild) return rejectionBuild;
    }

    // Persist parent with updated embedded collection
    const parentPatch: Record<string, unknown> = { [collectionKey]: collection };
    let updatedParent = deps.store.update(parentTable as never, parentId, parentPatch, {
      userId: ctx.userId,
    });

    if (updatedParent) {
      // REQ-TOK-002: re-read through the filtered `get()` — `updatedParent`
      // was built from the RAW `parentDoc`, so a legacy token survived the
      // write on disk but must not reach the broadcast below.
      updatedParent = deps.store.get(parentTable as never, parentId);

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

  // RAW (REQ-TOK-002) — see handleEmbeddedCreate's comment: `updatedCollection`
  // below is reconstructed from this doc and persisted with a full-array
  // replace. `updatedParent` is re-read through the filtered `get()` before
  // it reaches the ack/broadcast further down.
  let parentDoc: Record<string, unknown>;
  try {
    parentDoc = deps.store.getRaw(parentTable as never, parent.id);
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

  // Permission: GM/ASSISTANT or actor owner — EXCEPT Token, which is
  // role-only (see below).
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
  } else if (embeddedType === "Token") {
    // REQ-TOK-031 (spec 41-token.md, DEC-TOK-06): excluir um token exige
    // papel privilegiado, com a MESMA régua de REQ-TOK-030 (criar) — nunca
    // ownership do ator. Antes desta checagem, um jogador OWNER do próprio
    // personagem conseguia excluir o próprio token direto por aqui (a
    // ownership-of-actor branch abaixo, que este `else if` substitui para
    // Token, aceitava). TOKEN_DELETE espelha o floor configurável que
    // TOKEN_CREATE já usa (REQ-CFG-040..042, world-permissions.ts),
    // GM sempre passa independente do floor (mesma disciplina de
    // handleEmbeddedCreate acima).
    const minRole = resolvePermissionMinRole(deps.store, "TOKEN_DELETE");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (ctx.role !== UserRole.GAMEMASTER && ctx.role < minRole) {
      return ackError("PERMISSION_DENIED", "Insufficient role to delete tokens");
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

  // REQ-TOK-002: `updatedParent` above was built from the RAW `parentDoc`
  // (getRaw), so a legacy token this delete didn't target survived the write
  // on disk — re-read through the filtered `get()` before it can reach the
  // ack or the broadcast below.
  updatedParent = deps.store.get(parentTable as never, parent.id);

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
 * REQ-CFG-070/071, DEC-CFG-05: `Setting` broadcasts are eligible for
 * GAMEMASTER strictly, not the generic privileged threshold — ASSISTANT
 * sees everything else, but the Mundo/Permissões sections say "só
 * GAMEMASTER", and the read predicate must not be looser than that.
 */
function socketIsGamemasterStrict(socket: Socket): boolean {
  const data = socket.data as Record<string, unknown> | null | undefined;
  if (!data) return false;
  const role = data["role"];
  return typeof role === "number" && isGamemasterStrict(role);
}

/**
 * Emit one envelope per socket, choosing by an eligibility predicate.
 *
 * `isEligible` (defaulting to {@link socketIsPrivileged}) is the ONLY
 * predicate that decides which of the two envelopes a socket gets — never a
 * duplicated role comparison. Callers that need a stricter door (e.g.
 * `Setting`, GAMEMASTER-only per DEC-CFG-05) pass {@link socketIsGamemasterStrict}.
 */
function emitByRole(
  ns: Namespace,
  privilegedEnvelope: Envelope,
  playerEnvelope: Envelope,
  isEligible: (socket: Socket) => boolean = socketIsPrivileged,
): void {
  for (const [, socket] of ns.sockets) {
    socket.emit("op", isEligible(socket) ? privilegedEnvelope : playerEnvelope);
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
 * `Setting` envelopes ALSO go per-socket, GAMEMASTER-strictly (REQ-CFG-070/
 * 071, DEC-CFG-05) — see the branch below.
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
      // Scene envelopes ALSO go per-socket, and per USER rather than per
      // role, for the same reason the Actor branch below does: REQ-TOK-050's
      // `seenBy` exception list is per USER, so two players on the same role
      // can be owed different token sets from the identical Scene write
      // (spec 41-token.md TK070). Mirrors the Actor branch's `byUser` cache
      // — one redacted copy per user, not per socket.
      const byUser = new Map<string, Envelope>();
      for (const [, socket] of ns.sockets) {
        if (socketIsPrivileged(socket)) {
          socket.emit("op", envelope);
          continue;
        }
        const data = socket.data as Record<string, unknown> | null | undefined;
        const rawUserId = data?.["userId"];
        const userId = typeof rawUserId === "string" ? rawUserId : "";
        let playerEnvelope = byUser.get(userId);
        if (!playerEnvelope) {
          playerEnvelope = {
            ...envelope,
            payload: {
              ...payload,
              documents: redactSceneDocsForNonPrivileged(payload.documents, userId),
            },
          };
          byUser.set(userId, playerEnvelope);
        }
        socket.emit("op", playerEnvelope);
      }
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

  // Actor envelopes ALSO go per-socket, and per USER rather than per role:
  // contact knowledge is resolved over the characters each user owns
  // (REQ-CTT-071), so two players on the same role can be owed different
  // bodies of the same document. Everything is decided inside
  // `redactActorDocsForViewer` — this site only chooses who gets which copy
  // (REQ-CTT-083: no emission path may bypass the module).
  if (
    documentType === "Actor" &&
    (envelope.type === "doc:create" || envelope.type === "doc:update")
  ) {
    const payload = envelope.payload as {
      documentType: string;
      documents?: Record<string, unknown>[];
    };
    if (Array.isArray(payload.documents)) {
      const documents = payload.documents;
      const source = getContactKnowledgeSource(ns);
      // One redacted copy per USER, not per socket: the same person on two
      // devices is owed the same body, and the Actor table is read once.
      const byUser = new Map<string, Envelope>();
      for (const [, socket] of ns.sockets) {
        if (socketIsPrivileged(socket)) {
          socket.emit("op", envelope);
          continue;
        }
        const data = socket.data as Record<string, unknown> | null | undefined;
        const rawUserId = data?.["userId"];
        const rawRole = data?.["role"];
        const userId = typeof rawUserId === "string" ? rawUserId : "";
        const role = typeof rawRole === "number" ? rawRole : 0;
        let playerEnvelope = byUser.get(userId);
        if (!playerEnvelope) {
          const viewer = buildContactViewer(source, userId, role);
          const redacted = redactActorDocsForViewer(documents, viewer);
          // REQ-CTT-075: dropping the body is only half of the delta. The
          // client mirror upserts, so a contact lowered to `hidden` would stay
          // on the player's screen until a reload unless the very same
          // envelope names it as gone. Carried on the ordinary op — never a
          // second envelope — because the mirror gates on a contiguous seq.
          playerEnvelope = {
            ...envelope,
            payload: {
              ...payload,
              documents: redacted.documents,
              ...(redacted.removedIds.length > 0 ? { removedIds: redacted.removedIds } : {}),
            },
          };
          byUser.set(userId, playerEnvelope);
        }
        socket.emit("op", playerEnvelope);
      }
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

  // REQ-CFG-070/071, DEC-CFG-05: a `Setting` document is what the Mundo and
  // Permissões sections write through — visible to GAMEMASTER only, same as
  // the read door in `settings-handlers.ts`. Before this branch, a GM's
  // `doc:create`/`doc:update`/`doc:delete` of `Setting` fell through to the
  // fast path below and reached EVERY connected socket verbatim: a player
  // learned `fusion.permissions`' new floors, and any world-scope variant
  // rule's value, the instant the GM wrote it — the live-sync counterpart of
  // the read-side leak REQ-GAV-034 forbids. The GAMEMASTER-strict predicate
  // (not the generic privileged threshold) matches DEC-CFG-05's "só
  // GAMEMASTER" for these sections — ASSISTANT does not qualify either.
  // Non-eligible sockets get an empty-body envelope (never swallowed) for the
  // same reason Scene's does: the client mirror needs a contiguous seq.
  //
  // Achado 1 (revisão adversarial 26/09 do #277): create/update do NOT
  // blanket-empty the player envelope anymore — issue #266 already lets a
  // non-GAMEMASTER role READ the handful of settings on
  // `PLAYER_READABLE_SETTING_KEYS` (variant-rule flags the ficha itself
  // derives from), but this broadcast still zeroed them out, so a player
  // already on the sheet kept the STALE value until a manual reload. Filter
  // to that same allowlist (`isPlayerReadableSettingKey`, the one exported
  // predicate settings-handlers.ts also reads through — never a duplicated
  // key list) instead of dropping every document. `doc:delete` keeps the
  // blanket empty-ids envelope below: deleting a Setting document is not a
  // path any UI exposes today, and reconstructing "was this deleted key
  // player-readable" would need the pre-delete document, which the delete
  // handler does not thread through here.
  if (documentType === "Setting") {
    if (envelope.type === "doc:create" || envelope.type === "doc:update") {
      const payload = envelope.payload as {
        documentType: string;
        documents: Record<string, unknown>[];
      };
      const readableDocuments = payload.documents.filter((doc) => {
        const key = doc["key"];
        return typeof key === "string" && isPlayerReadableSettingKey(key);
      });
      const playerEnvelope: Envelope = {
        ...envelope,
        payload: { ...payload, documents: readableDocuments },
      };
      emitByRole(ns, envelope, playerEnvelope, socketIsGamemasterStrict);
      return;
    }
    if (envelope.type === "doc:delete") {
      const payload = envelope.payload as { documentType: string; ids: string[] };
      const playerEnvelope: Envelope = {
        ...envelope,
        payload: { ...payload, ids: [] },
      };
      emitByRole(ns, envelope, playerEnvelope, socketIsGamemasterStrict);
      return;
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

const POLLUTING_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * First key segment in a client diff that could reach Object.prototype, or null. Checks every dotted
 * segment of every key and every nested object/array key in the values, at any depth.
 */
export function findPollutingKey(value: unknown, depth = 0): string | null {
  if (depth > 64) return "<too deep>";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPollutingKey(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    for (const segment of key.split(".")) {
      if (POLLUTING_SEGMENTS.has(segment)) return segment;
    }
    const found = findPollutingKey(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
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
