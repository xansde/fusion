/**
 * combat:target handler + turnEnd targeting cleanup wiring.
 *
 * Spec: 10-combate-e-iniciativa.md §Canvas — Combat Turn Marker e Targeting
 * REQ-CBT-053: GM/player with permission marks tokens as targets.
 * REQ-CBT-054: targeted tokens get a visual indicator (client-side; server
 *   only broadcasts the targeting state).
 * REQ-CBT-055: targeting is cleared automatically at the end of the turn of the
 *   combatant that performed the targeting.
 *
 * Security:
 *   - userId is SERVER-AUTHORITATIVE: the acting user is taken from the
 *     authenticated socket context (ctx.userId). Any client-supplied userId in
 *     the payload is ignored (the payload schema does not even include it).
 *   - Targeting is ephemeral (TargetingStore, in-memory) — never persisted.
 */

import type { Namespace } from "socket.io";
import type { HandlerFn, HandlerContext } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import type { DocumentStore } from "../documents/store.js";
import type { CombatEventBus } from "./combat-event-bus.js";
import type { TargetingStore } from "./targeting-store.js";
import { CombatTargetPayloadSchema } from "@fusion/shared";
import type { Ack, ErrorCode, Envelope, CombatantDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Ack helpers
// ---------------------------------------------------------------------------

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface TargetHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  ns: Namespace;
  targetingStore: TargetingStore;
}

// ---------------------------------------------------------------------------
// Broadcast helper
// ---------------------------------------------------------------------------

/**
 * Broadcast a token:targeted event to all sockets in the namespace.
 *
 * Targeting carries no hidden-document data — it is a token id + a boolean +
 * the acting user id — so a plain namespace-wide emit is safe.
 */
function broadcastTargeted(
  ns: Namespace,
  seqStore: SeqStore,
  tokenId: string,
  targeted: boolean,
  userId: string,
): void {
  const seq = seqStore.next();
  const envelope: Envelope = {
    type: "token:targeted",
    seq,
    ts: Date.now(),
    payload: { tokenId, targeted, userId },
  };
  ns.emit("op", envelope);
}

// ---------------------------------------------------------------------------
// combat:target handler factory
// ---------------------------------------------------------------------------

/**
 * Build the combat:target handler.
 *
 * Any authenticated user (GM or player) may target tokens. The acting user is
 * resolved from the socket context — the client cannot forge another user's
 * targeting (the payload does not carry userId).
 *
 * REQ-CBT-053.
 */
export function buildCombatTargetHandler(deps: TargetHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    const parsed = CombatTargetPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { tokenId, targeted } = parsed.data;

    // userId is server-authoritative — taken from the authenticated socket,
    // never from the client payload.
    const userId = ctx.userId;

    const changed = deps.targetingStore.setTarget(userId, tokenId, targeted);

    // Always broadcast even when unchanged would be a no-op: we only broadcast
    // when the state actually changed to avoid redundant traffic.
    if (changed) {
      broadcastTargeted(deps.ns, deps.seqStore, tokenId, targeted, userId);
    }

    return ackOk({ tokenId, targeted, userId }, deps.seqStore.peek());
  };
}

// ---------------------------------------------------------------------------
// turnEnd cleanup wiring (REQ-CBT-055)
// ---------------------------------------------------------------------------

/**
 * Resolve the set of user ids that own the actor referenced by a combatant.
 *
 * A user "owns" the combatant when the combatant's actor grants them
 * OwnershipLevel.OWNER (level 3). The combatant whose turn ended had its
 * targeting set by one of its owning users; we clear targets for all of them.
 *
 * Returns an empty array when the combatant has no actor or the actor is gone.
 */
function ownersOfCombatant(store: DocumentStore, combatant: CombatantDocument): string[] {
  if (!combatant.actorId) return [];
  try {
    const actor = store.get("actors", combatant.actorId);
    const ownership = actor["ownership"];
    if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) return [];
    const ownerMap = ownership as Record<string, number>;
    const owners: string[] = [];
    for (const [key, level] of Object.entries(ownerMap)) {
      if (key === "default") continue;
      if (level >= 3) owners.push(key); // OWNER level
    }
    return owners;
  } catch {
    return [];
  }
}

/**
 * Register a turnEnd listener on the combat EventBus that clears the targeting
 * set by the owning user(s) of the combatant whose turn just ended, and
 * broadcasts a token:targeted(false) for each cleared token.
 *
 * REQ-CBT-055: targeting cleared at the end of the targeter's turn.
 *
 * Note: in the MVP, targeting cleanup keys off the combatant's *owning users*.
 * NPC combatants (no player owner) are handled by clearing the GM/assistant
 * targets when no player owners exist — but since we cannot attribute an
 * NPC's targets to a single GM session reliably, NPC turnEnd does not wipe GM
 * targets here (GMs manage their own targets manually). This matches the spec
 * intent (clear the targeter's targets) without over-clearing shared GM state.
 */
export function registerTargetingCleanup(deps: TargetHandlerDeps, eventBus: CombatEventBus): void {
  eventBus.onLifecycle("turnEnd", (event) => {
    if (event.type !== "turnEnd") return;
    const owners = ownersOfCombatant(deps.store, event.combatant);
    for (const userId of owners) {
      const cleared = deps.targetingStore.clearForUser(userId);
      for (const tokenId of cleared) {
        broadcastTargeted(deps.ns, deps.seqStore, tokenId, false, userId);
      }
    }
  });
}
