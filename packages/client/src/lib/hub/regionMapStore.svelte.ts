/**
 * regionMapStore.svelte.ts — the Mapa panel's state and the ops behind it.
 *
 * Spec: 34 (DEC-MREG-08, REQ-MREG-025..030), 28 (the Hub's Mapa panel).
 *
 * The panel component draws; this module owns everything else — which map is
 * open, what the mirror currently holds, and the five ops a client may send.
 * Keeping them apart is what makes the panel testable at all: the store is
 * plain TypeScript over a mirror and a socket, and the client's Vitest runs in
 * `environment: "node"`, where a `.svelte` file has no DOM to mount into.
 *
 * Nothing here decides visibility. The server already cut each payload for
 * this viewer (`redactRegionMapForViewer`), so a pin that arrived is a pin
 * this user may see; a pin at `limited` arrives with its content blanked and
 * is drawn as a rumour. The client mirrors that reading — it never re-derives
 * it.
 */

import type { Socket } from "socket.io-client";
import { OwnershipLevel, getUserLevel, type MapPin, type RegionMapDocument } from "@fusion/shared";
import { worldMirror } from "../docs/worldSync.js";
import { sendOp } from "../docs/sendOp.js";

/** Document type as the server names it on the wire. */
const DOC_TYPE = "RegionMap";

/** How one pin reads for the local viewer. */
export type PinReading = "known" | "rumour";

/** Content a client may write on a pin. */
export interface PinContent {
  x: number;
  y: number;
  text?: string;
  description?: string;
  icon?: string;
}

/**
 * Read how a pin should be drawn for this viewer.
 *
 * A privileged viewer receives every pin as authored, so their reading comes
 * from the pin's own ownership map; a player's payload was already redacted,
 * and resolving the level simply reproduces the server's decision.
 */
export function readPin(pin: MapPin, userId: string, role: number): PinReading {
  // A privileged viewer receives every pin as authored — there is no rumour to
  // draw for them, only the "nobody sees this yet" dimming below.
  if (role >= 3) return "known";
  return getUserLevel(pin.ownership, userId) >= OwnershipLevel.OBSERVER ? "known" : "rumour";
}

/**
 * Is this pin still invisible to the whole table? (GM affordance only.)
 *
 * The GM cannot otherwise tell prep from published at a glance, and that is
 * the question they ask of a region map constantly.
 */
export function isHiddenFromTable(pin: MapPin): boolean {
  for (const [key, level] of Object.entries(pin.ownership)) {
    if (key === "default") continue;
    if (level >= OwnershipLevel.LIMITED) return false;
  }
  return (pin.ownership["default"] ?? OwnershipLevel.NONE) < OwnershipLevel.LIMITED;
}

/**
 * Reactive view over the world's region maps.
 *
 * A class with `$state` fields rather than a store factory: the Hub has one
 * Mapa panel, its selection has to survive the panel being closed and
 * reopened, and a module-level singleton is the shortest honest way to say so.
 */
class RegionMapStore {
  /** Every map that reached this client, newest last. */
  maps = $state<RegionMapDocument[]>([]);

  /** `_id` of the map on screen; null falls back to the first available. */
  selectedId = $state<string | null>(null);

  /** The pin whose details are open, if any. */
  openPinId = $state<string | null>(null);

  private _unsubscribe: (() => void) | null = null;

  /** Start mirroring. Safe to call more than once. */
  attach(): void {
    this.refresh();
    this._unsubscribe ??= worldMirror.subscribe<RegionMapDocument>(DOC_TYPE, (docs) => {
      this.maps = [...docs];
      this._reconcileSelection();
    });
  }

  detach(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  /** Re-read the mirror without waiting for the next change event. */
  refresh(): void {
    this.maps = worldMirror.getByType<RegionMapDocument>(DOC_TYPE);
    this._reconcileSelection();
  }

  /** The map currently on screen. */
  get selected(): RegionMapDocument | null {
    if (this.maps.length === 0) return null;
    const chosen = this.maps.find((map) => map._id === this.selectedId);
    return chosen ?? this.maps[0] ?? null;
  }

  /** The pin whose detail panel is open, resolved against the live document. */
  get openPin(): MapPin | null {
    const map = this.selected;
    if (!map || this.openPinId === null) return null;
    return map.pins.find((pin) => pin._id === this.openPinId) ?? null;
  }

  select(mapId: string): void {
    this.selectedId = mapId;
    this.openPinId = null;
  }

  /**
   * Keep the selection pointing at something real.
   *
   * A map can vanish (deleted, or un-shared from under a player) while its
   * detail panel is open; leaving the id dangling would show an empty panel
   * with no way back.
   */
  private _reconcileSelection(): void {
    if (this.selectedId !== null && !this.maps.some((map) => map._id === this.selectedId)) {
      this.selectedId = null;
      this.openPinId = null;
    }
  }
}

export const regionMapStore = new RegionMapStore();

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

/** Create the map itself. GM only — the server enforces it too. */
export async function createRegionMap(
  socket: Socket,
  fields: { name: string; image?: string | null; imageWidth?: number; imageHeight?: number },
): Promise<string> {
  const result = await sendOp<{ documents: Array<{ _id: string }> }>(socket, {
    type: "doc:create",
    payload: {
      documentType: DOC_TYPE,
      data: [
        {
          name: fields.name,
          image: fields.image ?? null,
          ...(fields.imageWidth !== undefined ? { imageWidth: fields.imageWidth } : {}),
          ...(fields.imageHeight !== undefined ? { imageHeight: fields.imageHeight } : {}),
          // A new map is open to the table: what stays hidden is the pins.
          ownership: { default: OwnershipLevel.OBSERVER },
        },
      ],
    },
  });
  const id = result.documents[0]?._id;
  if (id === undefined) throw new Error("o servidor não devolveu o mapa criado");
  return id;
}

/** Change the map's own fields (name, terrain image, scale). GM only. */
export async function updateRegionMap(
  socket: Socket,
  mapId: string,
  diff: Record<string, unknown>,
): Promise<void> {
  await sendOp(socket, {
    type: "doc:update",
    payload: { documentType: DOC_TYPE, updates: [{ _id: mapId, diff }] },
  });
}

/** Drop a pin. Any player may; the server decides what kind it is. */
export async function createPin(socket: Socket, mapId: string, pin: PinContent): Promise<void> {
  await sendOp(socket, { type: "regionMap:createPin", payload: { mapId, pin } });
}

/** Move or re-word a pin. A player may only touch their own. */
export async function updatePin(
  socket: Socket,
  mapId: string,
  pinId: string,
  patch: Partial<PinContent>,
): Promise<void> {
  await sendOp(socket, { type: "regionMap:updatePin", payload: { mapId, pinId, patch } });
}

export async function deletePin(socket: Socket, mapId: string, pinId: string): Promise<void> {
  await sendOp(socket, { type: "regionMap:deletePin", payload: { mapId, pinId } });
}

/**
 * Move a pin's reveal for one player, or for the table.
 *
 * An empty `userIds` writes the pin's `default`, which is how "everyone" is
 * expressed without enumerating who happens to be connected.
 */
export async function revealPin(
  socket: Socket,
  mapId: string,
  pinId: string,
  userIds: string[],
  level: OwnershipLevel,
): Promise<void> {
  await sendOp(socket, {
    type: "regionMap:reveal",
    payload: { mapId, pinId, userIds, level },
  });
}

/** Comment on a pin. The author is taken from the socket, never sent. */
export async function commentOnPin(
  socket: Socket,
  mapId: string,
  pinId: string,
  text: string,
): Promise<void> {
  await sendOp(socket, { type: "regionMap:comment", payload: { mapId, pinId, text } });
}

// ---------------------------------------------------------------------------
// Players, for the reveal controls
// ---------------------------------------------------------------------------

export interface TablePlayer {
  id: string;
  name: string;
}

/** Every non-GM user in the world — the rows of the reveal matrix. */
export function listTablePlayers(): TablePlayer[] {
  const users = worldMirror.getByType<{ _id: string; name?: string; role?: number }>("User");
  return users
    .filter((user) => (user.role ?? 0) < 3)
    .map((user) => ({ id: user._id, name: user.name ?? "?" }));
}

/** This player's current level on a pin, for the reveal controls. */
export function levelFor(pin: MapPin, userId: string): OwnershipLevel {
  return getUserLevel(pin.ownership, userId);
}
