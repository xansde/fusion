/**
 * mapDemo.ts — SCAFFOLDING. Delete when the real region-map tools exist.
 *
 * The pin foundation (schema, per-viewer redaction, the four emission paths)
 * and the NoteLayer are both in, and neither can be looked at: there is no
 * "new region scene" dialog yet, no click-to-place tool and no reveal menu on
 * a pin — those are the next slice (REQ-MREG-001/006/007).
 *
 * Until they land this is the only way to SEE any of it, and a feature nobody
 * can look at is a feature nobody reviews. So: three buttons for the GM that
 * build a region, drop pins on it and walk them through the three reveal
 * states, using nothing but the ordinary embedded ops a real tool would use
 * (REQ-MREG-021 — the Console gets no privileged endpoint of its own).
 */

import type { Socket } from "socket.io-client";
import { OwnershipLevel } from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";

/** Query-string switch, same convention as the notice demo. */
export const MAP_DEMO_HOOK = "fusionMapDemo";

export function isMapDemoRequested(search: string): boolean {
  return new URLSearchParams(search).has(MAP_DEMO_HOOK);
}

/** Terrain image of the demo scene, and its true pixel size. */
const DEMO_BACKGROUND = "/assets/taverna-demo.jpg";
const DEMO_WIDTH = 1065;
const DEMO_HEIGHT = 1394;

/**
 * The pins the demo scene is seeded with, placed over the tavern map: places
 * a GM would reveal one at a time, not lore.
 */
const DEMO_PINS = [
  { x: 530, y: 390, text: "A lareira" },
  { x: 720, y: 330, text: "Mesa dos forasteiros" },
  { x: 400, y: 520, text: "Mesa redonda" },
  { x: 700, y: 640, text: "O balcão" },
  { x: 600, y: 1130, text: "A cozinha" },
  { x: 250, y: 200, text: "Horta dos fundos" },
];

interface CreatedDocs {
  documents: Array<{ _id: string }>;
}

/**
 * Create the demo scene with the region preset of DEC-MREG-01, over a real
 * map image, and seed it with pins.
 *
 * The image is a tavern rather than a region because the point of the demo is
 * the REVEAL, and a picture with recognisable places makes it obvious where
 * each pin sits — a blank canvas made it impossible to tell a missing pin from
 * a pin drawn off-screen. The preset is the region one all the same: the pins
 * behave identically at either scale.
 *
 * The scene is left inactive — activating it is the GM's call from the scene
 * list.
 */
export async function createDemoRegion(socket: Socket): Promise<string> {
  const scene = await sendOp<CreatedDocs>(socket, {
    type: "doc:create",
    payload: {
      documentType: "Scene",
      data: [
        {
          name: "Taverna (demo de pinos)",
          width: DEMO_WIDTH,
          height: DEMO_HEIGHT,
          background: DEMO_BACKGROUND,
          // The region preset: no grid, distance in kilometres, no vision or
          // fog — the terrain is not a secret, the places on it are.
          grid: { type: "gridless", size: 100, distance: 4, units: "km" },
          tokenVision: false,
          ownership: { default: OwnershipLevel.OBSERVER },
          flags: { fusion: { mapScale: "region" } },
        },
      ],
    },
  });

  const sceneId = scene.documents[0]?._id;
  if (!sceneId) throw new Error("cena de demo não retornou id");

  await sendOp(socket, {
    type: "doc:create",
    payload: {
      documentType: "Note",
      data: DEMO_PINS.map((pin) => ({ ...pin, iconSize: 40 })),
      parent: { type: "Scene", id: sceneId },
    },
  });

  return sceneId;
}

/** The slice of the mirror this demo reads: the world's user list. */
export interface UserSource {
  getByType<T>(type: string): T[];
}

/**
 * Every non-GM user in the world, so the demo can reveal "to the players"
 * without asking which. A real Console picks per player (REQ-MREG-007).
 */
export function listNonGmUserIds(mirror: UserSource): string[] {
  const users = mirror.getByType<{ _id: string; role?: number }>("User");
  return users.filter((user) => (user.role ?? 0) < 3).map((user) => user._id);
}

/** The three states a pin can be in for one player, in reveal order. */
export type RevealState = "none" | "rumour" | "known";

const LEVEL_OF: Record<RevealState, OwnershipLevel> = {
  none: OwnershipLevel.NONE,
  rumour: OwnershipLevel.LIMITED,
  known: OwnershipLevel.OBSERVER,
};

/**
 * Set one player's level on every pin of a scene.
 *
 * A real Console reveals pin by pin and in batches (REQ-MREG-006/007); this
 * moves the whole map at once because the point here is to watch the OTHER
 * client change, not to be a good tool.
 */
export async function revealAllPins(
  socket: Socket,
  sceneId: string,
  noteIds: readonly string[],
  userId: string,
  state: RevealState,
): Promise<void> {
  if (noteIds.length === 0) return;
  await sendOp(socket, {
    type: "doc:update",
    payload: {
      documentType: "Note",
      updates: noteIds.map((id) => ({
        _id: id,
        diff: {
          ownership: { default: OwnershipLevel.NONE, [userId]: LEVEL_OF[state] },
        },
        embedded: { type: "Note", id: sceneId },
      })),
    },
  });
}
