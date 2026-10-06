/**
 * `companion:setActive` — swap the ACTIVE animal companion of a master (BHR-F4-10, spec 52
 * REQ-PET-120..121, DC-07, D-B09).
 *
 * DC-07: a master may hold more than one animal companion (Animal Companion + Beastmaster Dedication) but
 * only ONE is active (`system.companion.active`; absent counts as active, like `mount-handler`). The
 * active one acts, supports and inherits the Prey; the inactive one stays an actor with a readable sheet
 * and NO token in the scene. `system.companion.active` is not writable by a player through `doc:update`
 * (`touchesCompanionLink`), so this op is the one way a player changes it. The server decides:
 *
 *   - the companion is a `familiar` actor with `companionKind = "animalCompanion"` and a master;
 *   - permission: GM/assistant, or OWNER of the MASTER actor (the same call `mount:mount` makes);
 *   - while a previously active companion is mounted (`flags.fusion.mount`, MountState of BHR-F5-02) the
 *     swap is refused with the reason: moving it out of the scene would leave the rider's state dangling.
 *     The rider dismounts first;
 *   - every companion of THAT master other than the target ends with `active = false`, the target with
 *     `active = true` — exactly one active, even when the stored state was forged;
 *   - in each scene holding a token of a previously active companion, that token is replaced in the same
 *     square (position, rotation, elevation, visibility) by one of the target — or just removed when the
 *     target already has a token there (the Mestre placed it). Legacy tokens (no actor) are kept.
 *
 * Broadcast: one `doc:update` of the Actors that changed, then one of each Scene that changed, through
 * `broadcastToWorld` (same seq, OpBuffer replay and redaction funnel as every other write).
 */

import type { Namespace } from "socket.io";
import { CompanionSetActivePayloadSchema, createDocumentId, readMountState } from "@fusion/shared";
import type { Ack, Envelope, ErrorCode } from "@fusion/shared";
import type { HandlerContext, HandlerFn } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import type { OpBuffer } from "../net/op-buffer.js";
import { broadcastToWorld } from "../net/handlers/doc-handlers.js";
import type { DocumentStore } from "../documents/store.js";
import { DocumentNotFoundError } from "../documents/store.js";
import { OwnershipLevel, isRolePrivileged, resolveOwnership } from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";

export interface CompanionActiveHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
}

type Rec = Record<string, unknown>;

function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readActorOrNull(store: DocumentStore, actorId: string): Rec | null {
  try {
    return store.get("actors", actorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
}

function callerOwns(actor: Rec, ctx: HandlerContext): boolean {
  const raw = actor["ownership"];
  const ownership: Ownership = isRec(raw) ? (raw as Ownership) : { default: OwnershipLevel.NONE };
  return resolveOwnership(ownership, ctx.userId, ctx.role) >= OwnershipLevel.OWNER;
}

function systemOf(actor: Rec): Rec {
  return isRec(actor["system"]) ? actor["system"] : {};
}

/** The master of an animal companion actor, or undefined when it is not one. */
function masterOf(actor: Rec): string | undefined {
  if (actor["type"] !== "familiar") return undefined;
  const sys = systemOf(actor);
  if (sys["companionKind"] !== "animalCompanion") return undefined;
  const master = sys["masterActorId"];
  return typeof master === "string" && master !== "" ? master : undefined;
}

/** Absent `active` counts as active (a companion born before DC-07). */
function isActive(actor: Rec): boolean {
  const companion = systemOf(actor)["companion"];
  return !(isRec(companion) && companion["active"] === false);
}

function broadcast(
  deps: CompanionActiveHandlerDeps,
  documentType: "Actor" | "Scene",
  documents: Rec[],
): number {
  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type: "doc:update",
    seq,
    ts: Date.now(),
    payload: { documentType, documents },
  };
  deps.opBuffer.push(envelope);
  broadcastToWorld(deps.ns, envelope, documentType);
  return seq;
}

export function buildCompanionSetActiveHandler(deps: CompanionActiveHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = CompanionSetActivePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { companionActorId } = parsed.data;

    const target = readActorOrNull(deps.store, companionActorId);
    if (target === null)
      return ackError("NOT_FOUND", `Document not found: Actor/${companionActorId}`);
    const masterId = masterOf(target);
    if (masterId === undefined) {
      return ackError(
        "VALIDATION_FAILED",
        "The actor is not an animal companion linked to a master",
      );
    }
    const master = readActorOrNull(deps.store, masterId);
    if (master === null) return ackError("NOT_FOUND", `Document not found: Actor/${masterId}`);
    if (!isRolePrivileged(ctx.role) && !callerOwns(master, ctx)) {
      return ackError(
        "PERMISSION_DENIED",
        "companion:setActive requires OWNER of the master actor",
      );
    }

    // Every OTHER companion of THIS master.
    const siblings: Rec[] = [];
    for (const listed of deps.store.getAll("actors")) {
      const id = listed["_id"];
      if (typeof id !== "string") continue;
      if (id === companionActorId || masterOf(listed) !== masterId) continue;
      siblings.push(listed);
    }
    const toDeactivate = siblings.filter(isActive);
    const deactivateIds = new Set(toDeactivate.map((a) => String(a["_id"])));

    // Scenes: where do the tokens of the previously active companions stand? Raw read, so the legacy
    // tokens (no actor) the filtered get() hides stay in the row we write back (REQ-TOK-002).
    interface SceneEdit {
      sceneId: string;
      tokens: Rec[];
    }
    const edits: SceneEdit[] = [];
    for (const listed of deps.store.getAll("scenes")) {
      const sceneId = listed["_id"];
      if (typeof sceneId !== "string") continue;
      const raw = deps.store.getRaw("scenes", sceneId);
      const list = raw["tokens"];
      if (!Array.isArray(list)) continue;
      const tokens = list as Rec[];
      const olds = tokens.filter(
        (t) => typeof t["actorId"] === "string" && deactivateIds.has(t["actorId"]),
      );
      if (olds.length === 0) continue;
      for (const old of olds) {
        const mount = readMountState(old);
        if (mount.riderTokenId !== undefined || mount.mountTokenId !== undefined) {
          const name =
            typeof old["name"] === "string" && old["name"] !== ""
              ? old["name"]
              : "The active companion";
          return ackError(
            "CONFLICT",
            `${name} is mounted: the rider must dismount before the active companion is swapped`,
          );
        }
      }
      const hasTarget = tokens.some((t) => t["actorId"] === companionActorId);
      let placed = hasTarget;
      const next: Rec[] = [];
      for (const t of tokens) {
        const actorId = t["actorId"];
        if (typeof actorId === "string" && deactivateIds.has(actorId)) {
          if (!placed) {
            // The new token takes the square of the old one; its name and actor delta are its own.
            next.push({
              ...t,
              _id: createDocumentId(),
              actorId: companionActorId,
              name: null,
              actorLink: true,
              actorDelta: null,
            });
            placed = true;
          }
          continue;
        }
        next.push(t);
      }
      edits.push({ sceneId, tokens: next });
    }

    // Writes (everything that can refuse is above).
    const alreadyExact = isActive(target) && toDeactivate.length === 0;
    const changedActors: Rec[] = [];
    if (!alreadyExact) {
      for (const sibling of toDeactivate) {
        const updated = deps.store.update(
          "actors",
          String(sibling["_id"]),
          { system: { companion: { active: false } } },
          { userId: ctx.userId },
        );
        if (updated !== null) changedActors.push(updated);
      }
      if (!isActive(target)) {
        const updated = deps.store.update(
          "actors",
          companionActorId,
          { system: { companion: { active: true } } },
          { userId: ctx.userId },
        );
        if (updated !== null) changedActors.push(updated);
      }
    }
    let seq = deps.seqStore.peek();
    if (changedActors.length > 0) seq = broadcast(deps, "Actor", changedActors);
    for (const edit of edits) {
      deps.store.update("scenes", edit.sceneId, { tokens: edit.tokens }, { userId: ctx.userId });
      const scene = deps.store.get("scenes", edit.sceneId);
      seq = broadcast(deps, "Scene", [scene]);
    }
    return { ok: true, seq, result: { documentType: "Actor" as const, documents: changedActors } };
  };
}
