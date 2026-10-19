/**
 * `item:transfer` - give an item (or a part of a stack) to another actor.
 *
 * One atomic write on TWO actors, which is why no `doc:update` can do it: the sender must own the actor the item
 * leaves, but needs no ownership of the actor it lands on (a player hands loot to another player's character).
 *
 * RULES:
 *   - sender: OWNER of `fromActorId`, or a privileged role (GM / assistant);
 *   - receiver: a privileged sender may give to anyone; a player may give to a character some player owns, or to any
 *     actor the sender can at least perceive (LIMITED or better). Never to the same actor;
 *   - `expectedVersion` is the sender's `_stats.version` (the stale-read guard `item:consume` uses): a sheet that has
 *     not seen the latest edit cannot hand over an item that is not there any more or has a different count;
 *   - only physical items move; a container moves WITH what is inside it, and only whole (all of its quantity);
 *   - the receiver gets the item NOT in use (carried, uninvested, not in a container) and the stack merges into one
 *     it already has when the two are identical (same `system` apart from quantity and carry state), otherwise a new
 *     embedded item with a fresh id is created;
 *   - both writes commit in ONE `DocumentStore.transaction()`; the broadcast follows it.
 *
 * The game rule stays out: this module knows nothing of Bulk, investiture or runes beyond clearing the carry state.
 */

import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import { ItemTransferPayloadSchema, OwnershipLevel, createDocumentId } from "@fusion/shared";
import type { ChatSpeaker, Envelope, ItemTransferAck, ItemTransferPayload, ItemTransferResult, Ownership } from "@fusion/shared";

import type { HandlerContext, HandlerFn } from "../handler-registry.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import type { DocumentStore } from "../../documents/store.js";
import { isRolePrivileged, resolveOwnership } from "../../documents/ownership.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import { broadcastToWorld } from "./doc-handlers.js";
import { buildBaseMessage, persistChatMessage, broadcastChatMessage } from "../../chat/chat-handler.js";
import { tokenLookupSourceFromStore } from "../redaction.js";

export interface ItemTransferHandlerDeps {
  store: DocumentStore;
  db: Db;
  ns: Namespace;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  worldId: string;
}

type Obj = Record<string, unknown>;

const PHYSICAL_TYPES: ReadonlySet<string> = new Set(["weapon", "armor", "shield", "equipment", "consumable", "treasure", "container"]);

class TransferError extends Error {
  constructor(
    public readonly code: "PERMISSION_DENIED" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "TransferError";
  }
}

function asObj(value: unknown): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
}

function readOwnership(doc: Obj): Ownership {
  const ownership = doc["ownership"];
  return ownership && typeof ownership === "object" ? (ownership as Ownership) : { default: OwnershipLevel.NONE };
}

function readVersion(doc: Obj): number | undefined {
  const version = asObj(doc["_stats"])["version"];
  return typeof version === "number" ? version : undefined;
}

function itemsOf(actor: Obj): Obj[] {
  return Array.isArray(actor["items"]) ? (actor["items"] as Obj[]) : [];
}

function quantityOf(item: Obj): number {
  const q = asObj(item["system"])["quantity"];
  return typeof q === "number" && Number.isFinite(q) && q >= 0 ? Math.floor(q) : 1;
}

function containerIdOf(item: Obj): string | null {
  const id = asObj(item["system"])["containerId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Ids of everything stowed (at any depth) inside `rootId`. */
function descendantIds(items: readonly Obj[], rootId: string): string[] {
  const out: string[] = [];
  const queue = [rootId];
  for (let i = 0; i < queue.length && i < 512; i += 1) {
    for (const item of items) {
      const id = item["_id"];
      if (typeof id === "string" && containerIdOf(item) === queue[i] && !out.includes(id)) {
        out.push(id);
        queue.push(id);
      }
    }
  }
  return out;
}

/** Stable text for comparing two systems: keys sorted, with the fields that may differ between stacks left out. */
function stackSignature(item: Obj): string {
  const { quantity: _q, equipped: _e, containerId: _c, ...rest } = asObj(item["system"]);
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Obj)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, sort(v)]),
      );
    }
    return value;
  };
  const fusion = asObj(asObj(item["flags"])["fusion"]);
  return JSON.stringify([item["type"], item["name"], fusion["sourceId"] ?? null, sort(rest)]);
}

/** The item as the receiver gets it: out of use, uninvested, out of any container, with the given quantity. */
function asReceived(item: Obj, quantity: number, containerId: string | null): Obj {
  const system: Obj = { ...structuredClone(asObj(item["system"])), quantity };
  const previous = asObj(system["equipped"]);
  system["equipped"] = {
    value: false,
    carryType: "carried",
    handsHeld: 0,
    ...("invested" in previous ? { invested: false } : {}),
  };
  system["containerId"] = containerId;
  return { ...structuredClone(item), system };
}

function displayName(item: Obj): string {
  const bag = asObj(asObj(item["i18n"])["ptBR"])["name"];
  if (typeof bag === "string" && bag.length > 0) return bag;
  const snapshot = asObj(asObj(asObj(asObj(item["flags"])["fusion"])["i18n"])["pt-BR"])["name"];
  if (typeof snapshot === "string" && snapshot.length > 0) return snapshot;
  return typeof item["name"] === "string" ? item["name"] : "item";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A player may receive on a character a player owns, or on anything they can at least perceive. */
function canReceive(target: Obj, userId: string, role: number): boolean {
  if (isRolePrivileged(role)) return true;
  if (resolveOwnership(readOwnership(target), userId, role) >= OwnershipLevel.LIMITED) return true;
  if (target["type"] !== "character") return false;
  const ownership = readOwnership(target) as unknown as Record<string, number>;
  return Object.entries(ownership).some(([key, level]) => level >= OwnershipLevel.OWNER && key !== "default") || ownership["default"] === OwnershipLevel.OWNER;
}

interface Planned {
  readonly fromItems: Obj[];
  readonly toItems: Obj[];
  readonly merged: boolean;
  readonly itemName: string;
}

function plan(from: Obj, to: Obj, itemId: string, quantity: number): Planned {
  const fromItems = itemsOf(from);
  const toItems = itemsOf(to);
  const item = fromItems.find((i) => i["_id"] === itemId);
  if (!item) throw new TransferError("NOT_FOUND", `item "${itemId}" not found on the sender`);
  if (typeof item["type"] !== "string" || !PHYSICAL_TYPES.has(item["type"])) {
    throw new TransferError("VALIDATION_FAILED", "only physical items can be given");
  }
  const available = quantityOf(item);
  if (quantity > available) {
    throw new TransferError("VALIDATION_FAILED", `only ${String(available)} on hand, tried to give ${String(quantity)}`);
  }
  const inside = item["type"] === "container" ? descendantIds(fromItems, itemId) : [];
  if (inside.length > 0 && quantity !== available) {
    throw new TransferError("VALIDATION_FAILED", "a container with contents can only be given whole");
  }

  const whole = quantity === available;
  const moving = new Set<string>([itemId, ...inside]);
  const remaining = fromItems
    .filter((i) => !(whole && typeof i["_id"] === "string" && moving.has(i["_id"])))
    .map((i) => {
      if (whole || i["_id"] !== itemId) return i;
      return { ...i, system: { ...asObj(i["system"]), quantity: available - quantity } };
    });

  // Merge a plain stack into an identical one the receiver already has.
  const signature = stackSignature(item);
  const twin =
    inside.length === 0 && item["type"] !== "container"
      ? toItems.find((candidate) => stackSignature(candidate) === signature && containerIdOf(candidate) === null)
      : undefined;
  if (twin) {
    const grown = toItems.map((candidate) =>
      candidate === twin ? { ...candidate, system: { ...asObj(candidate["system"]), quantity: quantityOf(candidate) + quantity } } : candidate,
    );
    return { fromItems: remaining, toItems: grown, merged: true, itemName: displayName(item) };
  }

  // A new stack: fresh ids; what was inside a container keeps its place inside the NEW container.
  const idMap = new Map<string, string>([[itemId, createDocumentId()]]);
  for (const id of inside) idMap.set(id, createDocumentId());
  const arrivals: Obj[] = [{ ...asReceived(item, quantity, null), _id: idMap.get(itemId) }];
  for (const id of inside) {
    const child = fromItems.find((i) => i["_id"] === id);
    if (!child) continue;
    const parent = containerIdOf(child);
    const received = asReceived(child, quantityOf(child), parent !== null ? (idMap.get(parent) ?? null) : null);
    // What sits inside a bag keeps its carry state ("carried"), but is not equipped either.
    arrivals.push({ ...received, _id: idMap.get(id) });
  }
  return { fromItems: remaining, toItems: [...toItems, ...arrivals], merged: false, itemName: displayName(item) };
}

async function transfer(deps: ItemTransferHandlerDeps, rawPayload: unknown, ctx: HandlerContext): Promise<ItemTransferAck> {
  const parsed = ItemTransferPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED", message: parsed.error.message };
  const payload: ItemTransferPayload = parsed.data;
  if (payload.fromActorId === payload.toActorId) {
    return { ok: false, code: "VALIDATION_FAILED", message: "cannot give an item to the same actor" };
  }

  let outcome: { from: Obj; to: Obj; result: ItemTransferResult; fromName: string; toName: string };
  try {
    outcome = deps.store.transaction((txn) => {
      const load = (id: string): Obj => {
        try {
          return deps.store.get("actors", id);
        } catch (err) {
          if (err instanceof DocumentNotFoundError) throw new TransferError("NOT_FOUND", `actor "${id}" not found`);
          throw err;
        }
      };
      const from = load(payload.fromActorId);
      const to = load(payload.toActorId);

      if (!isRolePrivileged(ctx.role)) {
        if (resolveOwnership(readOwnership(from), ctx.userId, ctx.role) < OwnershipLevel.OWNER) {
          throw new TransferError("PERMISSION_DENIED", "not OWNER of the sending actor");
        }
        if (!canReceive(to, ctx.userId, ctx.role)) {
          throw new TransferError("PERMISSION_DENIED", "the receiving actor is not a character you may give items to");
        }
      }
      if (readVersion(from) !== payload.expectedVersion) {
        throw new TransferError("CONFLICT", "the sending actor changed since expectedVersion was read");
      }

      const planned = plan(from, to, payload.itemId, payload.quantity);
      const fromAfter = txn.update("actors", payload.fromActorId, { items: planned.fromItems }) ?? from;
      const toAfter = txn.update("actors", payload.toActorId, { items: planned.toItems }) ?? to;
      return {
        from: fromAfter,
        to: toAfter,
        result: { moved: payload.quantity, itemName: planned.itemName, toActorId: payload.toActorId, merged: planned.merged },
        fromName: typeof from["name"] === "string" ? from["name"] : "?",
        toName: typeof to["name"] === "string" ? to["name"] : "?",
      };
    });
  } catch (err) {
    if (err instanceof TransferError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }

  for (const actor of [outcome.from, outcome.to]) {
    const envelope: Envelope = {
      type: "doc:update",
      seq: deps.seqStore.next(),
      ts: Date.now(),
      payload: { documentType: "Actor", documents: [actor] },
    };
    deps.opBuffer.push(envelope);
    broadcastToWorld(deps.ns, envelope, "Actor");
  }

  // A line in the chat so the table sees who gave what to whom.
  const speaker: ChatSpeaker = { userId: ctx.userId, actorId: payload.fromActorId, alias: "Sistema" };
  const text = `${escapeHtml(outcome.fromName)} entregou ${String(outcome.result.moved)}x ${escapeHtml(outcome.result.itemName)} a ${escapeHtml(outcome.toName)}.`;
  const message = buildBaseMessage(deps.worldId, speaker, "system", text);
  persistChatMessage(deps.db, message);
  broadcastChatMessage(deps.ns, deps.seqStore, message, speaker.userId, "doc:create", tokenLookupSourceFromStore(deps.store));

  return { ok: true, result: outcome.result };
}

export function buildItemTransferHandler(deps: ItemTransferHandlerDeps): HandlerFn {
  return (rawPayload: unknown, ctx: HandlerContext) => transfer(deps, rawPayload, ctx);
}
