/**
 * `effect:apply` — a pack effect copied onto other actors, with the permission
 * decided on the server (BHR-F4-08, spec 52 §7.3, REQ-BHR-102..105, REQ-SYS-163,
 * DEC-BHR-09 / DC-06).
 *
 * Why its own op: `actor:applyCondition` only applies a condition, and the
 * Apoio of an animal companion is an Effect with rules (extra damage), not a
 * condition. The effect content never comes from the client: the payload only
 * NAMES `{ packId, docId }` and this module reads the document from the pack,
 * so nothing a player sends can shape what is written to another actor.
 *
 * Permission (all of it here, on the server — a hidden button is no protection):
 *   - GM/assistant (`isRolePrivileged`): any source, any target, any effect.
 *   - Player: must own `sourceActorId` (OWNER); the effect must be REFERENCED by
 *     the source (an embedded item's `effectRefs`, or the Support of a companion
 *     type) and visible to the player's role (onda-6 review I-2); AND every target must be
 *       (a) the source itself, or
 *       (b) tied to the source by a companion link, in either direction
 *           (`areCompanionLinked`, owner <-> companion), or
 *       (c) in the `flags.fusion.targetSnapshot` of `messageId` — a message
 *           spoken by an actor the player owns, with the target's token not
 *           hidden from the player — and ONLY when the effect carries
 *           `system.fusion.allowOnTarget === true`.
 *     Anything else is `PERMISSION_DENIED`. A player may also only hand the
 *     effect's expiry clock (`expiry.ownerActorId`) to the source or a target;
 *     otherwise the effect could be made to tick on an unrelated actor's turn.
 *     The rest of the expiry is the pack's `expiryTemplate`, never the client's
 *     (review I-1).
 *
 * Atomicity: every check runs before the first write, and all targets are
 * written inside ONE `DocumentStore.transaction()` — a forbidden or missing
 * target among several writes nothing.
 *
 * Visibility: the write is announced as an Actor `doc:update` through
 * `broadcastToWorld` (same seq, OpBuffer replay and redaction funnel as every
 * other actor write). Redaction predicates are `net/redaction.ts` +
 * `isRolePrivileged` — none is duplicated here.
 */

import type { Namespace } from "socket.io";
import {
  EffectApplyPayloadSchema,
  FusionExpirySchema,
  OwnershipLevel,
  buildPackDocUuid,
  companionSupportBlockReasons,
  createDocumentId,
} from "@fusion/shared";
import type {
  EffectApplyAck,
  EffectApplyPayload,
  Envelope,
  ErrorCode,
  FusionExpiry,
} from "@fusion/shared";
import type { HandlerContext, HandlerFn } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import { broadcastToWorld, findPollutingKey } from "./doc-handlers.js";
import { tokenIsHiddenFromViewer, tokenLookupSourceFromStore } from "../redaction.js";
import type { DocumentStore } from "../../documents/store.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import {
  UserRole,
  areCompanionLinked,
  isRolePrivileged,
  resolveOwnership,
} from "../../documents/ownership.js";
import type { Ownership } from "../../documents/ownership.js";
import type { CompendiumService } from "../../compendium/service.js";

export interface EffectApplyHandlerDeps {
  store: DocumentStore;
  ns: Namespace;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  compendium: CompendiumService;
}

/** Op-level error: carries the ack code across the `store.transaction()` boundary. */
class EffectApplyError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EffectApplyError";
  }
}

const denied = (message: string): EffectApplyError =>
  new EffectApplyError("PERMISSION_DENIED", message);

type Doc = Record<string, unknown>;

function asRecord(value: unknown): Doc {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Doc) : {};
}

function readActor(store: DocumentStore, actorId: string): Doc {
  try {
    return store.get("actors", actorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      throw new EffectApplyError("NOT_FOUND", `Document not found: Actor/${actorId}`);
    }
    throw err;
  }
}

function callerOwns(actor: Doc, ctx: HandlerContext): boolean {
  const raw = actor["ownership"];
  const ownership: Ownership =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Ownership)
      : { default: OwnershipLevel.NONE };
  return resolveOwnership(ownership, ctx.userId, ctx.role) >= OwnershipLevel.OWNER;
}

/** The roll message `messageId`, or null when it does not exist. */
function readMessage(store: DocumentStore, messageId: string): Doc | null {
  try {
    return store.get("chat_messages", messageId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
}

/** `{ tokenId, actorId }` of each well-formed `flags.fusion.targetSnapshot` entry. */
function readSnapshot(message: Doc): { tokenId: string; actorId: string | null }[] {
  const snapshot = asRecord(asRecord(asRecord(message["flags"])["fusion"]))["targetSnapshot"];
  if (!Array.isArray(snapshot)) return [];
  const entries: { tokenId: string; actorId: string | null }[] = [];
  for (const raw of snapshot as unknown[]) {
    const entry = asRecord(raw);
    const tokenId = entry["tokenId"];
    if (typeof tokenId !== "string") continue;
    const actorId = entry["actorId"];
    entries.push({ tokenId, actorId: typeof actorId === "string" ? actorId : null });
  }
  return entries;
}

/**
 * Case (c): is `targetActorId` named by `messageId`'s frozen target selection,
 * through a token this player can see? The message must be spoken by an actor
 * the caller owns, so one player cannot cite another's roll.
 */
function targetInCitedSnapshot(
  deps: EffectApplyHandlerDeps,
  ctx: HandlerContext,
  messageId: string,
  targetActorId: string,
): boolean {
  const message = readMessage(deps.store, messageId);
  if (message === null) return false;
  const speakerActorId = asRecord(message["speaker"])["actorId"];
  if (typeof speakerActorId !== "string") return false;
  let speaker: Doc;
  try {
    speaker = deps.store.get("actors", speakerActorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return false;
    throw err;
  }
  if (!callerOwns(speaker, ctx)) return false;

  const tokens = tokenLookupSourceFromStore(deps.store);
  return readSnapshot(message).some((entry) => {
    if (entry.actorId !== targetActorId) return false;
    const token = tokens.findToken(entry.tokenId);
    // Fail closed: a token that no longer resolves cannot be proven visible.
    return token !== undefined && !tokenIsHiddenFromViewer(token, ctx.userId);
  });
}

function readEffectDoc(
  deps: EffectApplyHandlerDeps,
  role: number,
  ref: EffectApplyPayload["effect"],
): Doc | null {
  return deps.compendium.getDocument(role, buildPackDocUuid(ref.packId, "Item", ref.docId));
}

function assertIsEffect(doc: Doc): Doc {
  if (doc["type"] !== "effect") {
    throw new EffectApplyError("VALIDATION_FAILED", "effect:apply only applies Effect documents");
  }
  return doc;
}

/** Source ids (`system.fusion.effectRefs`) of the effects the actor's own items point at. */
function embeddedItemEffectRefs(actor: Doc): Set<string> {
  const refs = new Set<string>();
  const items = actor["items"];
  if (!Array.isArray(items)) return refs;
  for (const item of items as unknown[]) {
    const list = asRecord(asRecord(asRecord(item)["system"])["fusion"])["effectRefs"];
    if (!Array.isArray(list)) continue;
    for (const ref of list as unknown[]) if (typeof ref === "string") refs.add(ref);
  }
  return refs;
}

/**
 * The Support effect of an animal companion type (`system.support.effectRef`,
 * plan section 2.4), looked up by the slug the companion carries in
 * `system.companion.typeSlug`. Read as the server itself: the viewer's pack
 * audience is applied later, to the EFFECT, not to this lookup.
 */
function companionTypeSupportRef(
  deps: EffectApplyHandlerDeps,
  typeSlug: string,
): { packId: string; docId: string } | null {
  for (const pack of deps.compendium.listPacks(UserRole.GAMEMASTER, { documentType: "Item" })) {
    const index = deps.compendium.getPackIndex(UserRole.GAMEMASTER, pack.id);
    const entry = index?.entries.find(
      (e) => e.type === "companionType" && e.index["system.slug"] === typeSlug,
    );
    if (entry === undefined) continue;
    const type = deps.compendium.getDocument(UserRole.GAMEMASTER, entry.uuid);
    const ref = asRecord(asRecord(asRecord(type)["system"])["support"])["effectRef"];
    const { packId, docId } = asRecord(ref);
    if (typeof packId === "string" && typeof docId === "string") return { packId, docId };
  }
  return null;
}

/**
 * Is `effect` (named `ref`, already read from the pack) referenced by the ORIGIN?
 * Two sources count (onda-6 review I-2, DC-06 "an effect of the actor itself"):
 *   - an embedded item of the source whose `effectRefs` lists the effect's source id;
 *   - the Support effect of the companion type of the source, or of a companion
 *     whose `masterActorId` is the source.
 */
function isReferencedByOrigin(
  deps: EffectApplyHandlerDeps,
  sourceActorId: string,
  source: Doc,
  ref: EffectApplyPayload["effect"],
  effect: Doc,
): boolean {
  const effectSourceId = asRecord(asRecord(effect["flags"])["fusion"])["sourceId"];
  if (typeof effectSourceId === "string" && embeddedItemEffectRefs(source).has(effectSourceId)) {
    return true;
  }
  const slugs = new Set<string>();
  const slugOf = (actor: Doc): void => {
    const slug = asRecord(asRecord(actor["system"])["companion"])["typeSlug"];
    if (typeof slug === "string" && slug !== "") slugs.add(slug);
  };
  slugOf(source);
  for (const actor of deps.store.getAll("actors")) {
    if (asRecord(actor["system"])["masterActorId"] === sourceActorId) slugOf(actor);
  }
  for (const slug of slugs) {
    const support = companionTypeSupportRef(deps, slug);
    if (support !== null && support.packId === ref.packId && support.docId === ref.docId) {
      return true;
    }
  }
  return false;
}

/**
 * The reasons the Support of a companion is blocked (REQ-PET-121, REQ-BHR-178), when `ref` is the Support
 * effect of the type of a companion tied to the source (the source itself, or a companion of the source).
 * Same predicate the sheets use (`companionSupportBlockReasons`), so the button and the server agree.
 */
function supportBlockedReasons(
  deps: EffectApplyHandlerDeps,
  sourceActorId: string,
  source: Doc,
  ref: EffectApplyPayload["effect"],
): string[] {
  const companions: Doc[] = [];
  if (asRecord(source["system"])["companionKind"] === "animalCompanion") companions.push(source);
  for (const actor of deps.store.getAll("actors")) {
    const system = asRecord(actor["system"]);
    if (
      system["masterActorId"] === sourceActorId &&
      system["companionKind"] === "animalCompanion"
    ) {
      companions.push(actor);
    }
  }
  const scenes = deps.store.getAll("scenes") as Doc[];
  const combats = deps.store.getAll("combats") as Doc[];
  const reasons: string[] = [];
  for (const companion of companions) {
    const slug = asRecord(asRecord(companion["system"])["companion"])["typeSlug"];
    if (typeof slug !== "string" || slug === "") continue;
    const support = companionTypeSupportRef(deps, slug);
    if (support === null || support.packId !== ref.packId || support.docId !== ref.docId) continue;
    reasons.push(...companionSupportBlockReasons({ scenes, combats, companion }));
  }
  return reasons;
}

/**
 * Resolve the pack effect — server-side, never trusting client content.
 *
 * Mestre/assistant name any effect. A player may only name an effect the
 * source actor REFERENCES (see `isReferencedByOrigin`), and it is then read with
 * the PLAYER's pack audience: a pack hidden from the role answers
 * `PERMISSION_DENIED`, the same as an unreferenced or unknown effect, so the
 * ack teaches nothing about hidden packs (REQ-CPD-071, REQ-SEC-020).
 */
function resolveEffect(
  deps: EffectApplyHandlerDeps,
  ctx: HandlerContext,
  privileged: boolean,
  payload: EffectApplyPayload,
  source: Doc,
): Doc {
  const ref = payload.effect;
  if (privileged) {
    const doc = readEffectDoc(deps, UserRole.GAMEMASTER, ref);
    if (doc === null) {
      throw new EffectApplyError("NOT_FOUND", `Effect not found: ${ref.packId}/${ref.docId}`);
    }
    return assertIsEffect(doc);
  }
  const asServer = readEffectDoc(deps, UserRole.GAMEMASTER, ref);
  if (
    asServer === null ||
    !isReferencedByOrigin(deps, payload.sourceActorId, source, ref, asServer)
  ) {
    throw denied("effect:apply: the source actor does not reference that effect");
  }
  const visible = readEffectDoc(deps, ctx.role, ref);
  if (visible === null) throw denied("effect:apply: that effect is not available to your role");
  return assertIsEffect(visible);
}

/**
 * The expiry stamped on the embedded effect. The shape comes from the pack's own
 * `system.fusion.expiryTemplate`; the client contributes only `ownerActorId`
 * (validated in `authorizePlayer`), defaulting to the source. The Mestre/assistant
 * may send a whole `expiry` (`on` present) to override the template.
 */
function buildExpiry(
  effect: Doc,
  payload: EffectApplyPayload,
  privileged: boolean,
): FusionExpiry | undefined {
  const requested = payload.expiry;
  if (privileged && requested?.on !== undefined) {
    const full = FusionExpirySchema.safeParse(requested);
    if (full.success) return full.data;
  }
  const template = asRecord(asRecord(effect["system"])["fusion"])["expiryTemplate"];
  if (template === null || typeof template !== "object" || Array.isArray(template)) {
    return undefined;
  }
  const built = FusionExpirySchema.safeParse({
    ...(template as Doc),
    ownerActorId: requested?.ownerActorId ?? payload.sourceActorId,
  });
  return built.success ? built.data : undefined;
}

function authorizePlayer(
  deps: EffectApplyHandlerDeps,
  ctx: HandlerContext,
  payload: EffectApplyPayload,
  source: Doc,
  targets: Map<string, Doc>,
  effect: Doc,
): void {
  if (!callerOwns(source, ctx)) {
    throw denied("effect:apply requires OWNER of the source actor");
  }

  const allowOnTarget = asRecord(asRecord(effect["system"])["fusion"])["allowOnTarget"] === true;
  for (const [targetId, target] of targets) {
    if (targetId === payload.sourceActorId) continue; // (a)
    if (
      areCompanionLinked(
        { _id: payload.sourceActorId, doc: source },
        { _id: targetId, doc: target },
      )
    ) {
      continue; // (b)
    }
    if (
      payload.messageId !== undefined &&
      allowOnTarget && // (c) — only effects that opt in
      targetInCitedSnapshot(deps, ctx, payload.messageId, targetId)
    ) {
      continue;
    }
    throw denied(`effect:apply is not allowed onto actor ${targetId}`);
  }

  const clockOwner = payload.expiry?.ownerActorId;
  if (
    clockOwner !== undefined &&
    clockOwner !== payload.sourceActorId &&
    !targets.has(clockOwner)
  ) {
    throw denied("expiry.ownerActorId must be the source or one of the targets");
  }
}

/** The origin round, when the source actor is in an active combat. */
export function startedAtFor(
  store: DocumentStore,
  actorId: string,
): { combatId: string | null; round: number | null } {
  for (const combat of store.getAll("combats")) {
    if (combat["ended"] === true) continue;
    const combatants = combat["combatants"];
    if (!Array.isArray(combatants)) continue;
    if (!(combatants as Doc[]).some((c) => c["actorId"] === actorId)) continue;
    const round = combat["round"];
    return {
      combatId: typeof combat["_id"] === "string" ? combat["_id"] : null,
      round: typeof round === "number" ? round : 0,
    };
  }
  return { combatId: null, round: null };
}

export function buildEmbeddedEffect(
  effect: Doc,
  payload: EffectApplyPayload,
  startedAt: { combatId: string | null; round: number | null },
  expiry: FusionExpiry | undefined,
): { id: string; item: Doc } {
  const system = asRecord(effect["system"]);
  const fusion = asRecord(system["fusion"]);
  const sourceId = asRecord(asRecord(effect["flags"])["fusion"])["sourceId"];
  const id = createDocumentId();
  return {
    id,
    item: {
      _id: id,
      name: effect["name"],
      type: "effect",
      img: effect["img"],
      system: {
        ...system,
        fusion: {
          ...fusion,
          // Server-stamped (DF-06): who applied it, and when.
          origin: {
            actorId: payload.sourceActorId,
            ...(typeof sourceId === "string" ? { itemSourceId: sourceId } : {}),
          },
          startedAt,
          // Built on the server from the pack's `expiryTemplate` (review I-1).
          ...(expiry !== undefined ? { expiry } : {}),
        },
      },
    },
  };
}

function applyEffect(
  deps: EffectApplyHandlerDeps,
  rawPayload: unknown,
  ctx: HandlerContext,
): EffectApplyAck {
  // Defence in depth: the strict schema below already rejects unknown keys, but
  // a prototype-polluting key never gets as far as being looked at.
  const polluting = findPollutingKey(rawPayload);
  if (polluting !== null) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: `effect:apply payload contains the forbidden key segment "${polluting}"`,
    };
  }
  const parsed = EffectApplyPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_FAILED", message: parsed.error.message };
  }
  const payload = parsed.data;

  try {
    const privileged = isRolePrivileged(ctx.role);
    const source = readActor(deps.store, payload.sourceActorId);
    if (!privileged && !callerOwns(source, ctx)) {
      throw denied("effect:apply requires OWNER of the source actor");
    }
    const targets = new Map<string, Doc>();
    for (const targetId of payload.targetActorIds) {
      if (!targets.has(targetId)) targets.set(targetId, readActor(deps.store, targetId));
    }
    const effect = resolveEffect(deps, ctx, privileged, payload, source);
    const blocked = supportBlockedReasons(deps, payload.sourceActorId, source, payload.effect);
    if (blocked.length > 0) throw new EffectApplyError("CONFLICT", blocked.join(" "));
    if (!privileged) authorizePlayer(deps, ctx, payload, source, targets, effect);
    const expiry = buildExpiry(effect, payload, privileged);

    const startedAt = startedAtFor(deps.store, payload.sourceActorId);
    const applied: { actorId: string; itemId: string }[] = [];
    const updated = deps.store.transaction((txn) => {
      const docs: Doc[] = [];
      for (const [targetId] of targets) {
        // Re-read inside the transaction: the write must extend the CURRENT items.
        const fresh = deps.store.get("actors", targetId);
        const current = Array.isArray(fresh["items"]) ? (fresh["items"] as Doc[]) : [];
        const { id, item } = buildEmbeddedEffect(effect, payload, startedAt, expiry);
        const doc = txn.update("actors", targetId, { items: [...current, item] });
        if (doc !== null) docs.push(doc);
        applied.push({ actorId: targetId, itemId: id });
      }
      return docs;
    });

    const seq = deps.seqStore.next();
    const envelope: Envelope = {
      type: "doc:update",
      seq,
      ts: Date.now(),
      payload: { documentType: "Actor", documents: updated },
    };
    deps.opBuffer.push(envelope);
    broadcastToWorld(deps.ns, envelope, "Actor");
    return { ok: true, seq, result: { applied } };
  } catch (err) {
    if (err instanceof EffectApplyError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}

export function buildEffectApplyHandler(deps: EffectApplyHandlerDeps): HandlerFn {
  return (rawPayload: unknown, ctx: HandlerContext) => applyEffect(deps, rawPayload, ctx);
}
