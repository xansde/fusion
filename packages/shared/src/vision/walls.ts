/**
 * Wall filtering API.
 *
 * Given an array of Wall documents, these functions return the subset that
 * blocks a specific perception dimension (sight, light, move, sound) according
 * to the restriction modes, door state, and directionality rules.
 *
 * Design notes:
 *  - An OPEN door never blocks any dimension (REQ-VIS-004).
 *  - A SECRET door is indistinguishable from a regular door for blocking
 *    purposes — the caller is responsible for filtering secret doors from
 *    non-GM walls before passing them here (REQ-VIS-005).
 *  - "limited" (terrain) walls ARE included in the result: the sweep algorithm
 *    itself handles the "one-layer" counting (REQ-VIS-025 / D5).
 *  - Directionality is a property of the Wall struct; the sweep algorithm
 *    checks it at intersection time (REQ-VIS-026). The filter here only removes
 *    walls whose restriction mode is "none" for the dimension.
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-001 – REQ-VIS-004, D1, D5
 */

import type { Wall, WallDimension } from "./types.js";

// ---------------------------------------------------------------------------
// Core filter
// ---------------------------------------------------------------------------

/**
 * Return all walls that potentially block the given `dimension`.
 *
 * A wall is included when:
 *   1. It is NOT an open door (doorState !== "open").
 *   2. Its restriction for `dimension` is "normal" or "limited" (not "none").
 *
 * "limited" walls are included so the sweep can count terrain layers
 * (REQ-VIS-025). The caller (sweep) differentiates "normal" from "limited".
 *
 * For `move`, only "none" | "normal" are valid restriction values (spec), so
 * "limited" will never appear in the move dimension in practice.
 */
export function wallsBlockingDimension(walls: readonly Wall[], dimension: WallDimension): Wall[] {
  const result: Wall[] = [];

  for (const wall of walls) {
    // Open doors never block (REQ-VIS-004).
    if (wall.doorState === "open") continue;

    const mode = wall[dimension];
    if (mode === "none") continue;

    result.push(wall);
  }

  return result;
}

/**
 * Return walls that block sight (vision).
 *
 * Open doors and sight:"none" walls are excluded.
 * sight:"limited" (terrain) walls are included.
 *
 * REQ-VIS-020, REQ-VIS-025.
 */
export function wallsBlockingSight(walls: readonly Wall[]): Wall[] {
  return wallsBlockingDimension(walls, "sight");
}

/**
 * Return walls that block light (illumination).
 *
 * Open doors and light:"none" walls are excluded.
 * light:"limited" walls are included.
 *
 * REQ-VIS-020, REQ-VIS-042.
 */
export function wallsBlockingLight(walls: readonly Wall[]): Wall[] {
  return wallsBlockingDimension(walls, "light");
}

/**
 * Return walls that block movement.
 *
 * Open doors and move:"none" walls are excluded.
 * Only "normal" is meaningful here (spec REQ-VIS-002: move only uses none/normal).
 *
 * REQ-VIS-091: server uses this to validate token:move.
 */
export function wallsBlockingMovement(walls: readonly Wall[]): Wall[] {
  return wallsBlockingDimension(walls, "move");
}

/**
 * Return walls that block sound.
 *
 * Open doors and sound:"none" walls are excluded.
 * sound:"limited" walls are included.
 */
export function wallsBlockingSound(walls: readonly Wall[]): Wall[] {
  return wallsBlockingDimension(walls, "sound");
}

// ---------------------------------------------------------------------------
// Movement collision test
// REQ-VIS-091: server validates token:move against movement-blocking walls
// REQ-VIS-103: deterministic — same geometry ⇒ same result on any client
// ---------------------------------------------------------------------------

import { segmentIntersect, DIST_EPSILON } from "./primitives.js";

/**
 * Test whether movement from `from` to `to` is blocked by any wall in `walls`.
 *
 * Returns true if the movement segment crosses any wall that blocks movement,
 * taking into account:
 *  - Directionality (dir): a one-way wall only blocks from its restricted side.
 *  - Open doors: never block (filtered before this call, or handled here).
 *
 * Directionality convention (spec REQ-VIS-003, REQ-VIS-026):
 *   The wall's "left" side is determined by the cross product of (a→b) × (a→origin).
 *   Positive cross product ⇒ origin is to the LEFT of a→b.
 *   Wall.dir = "left"  ⇒ only blocks movement whose FROM point is to the LEFT.
 *   Wall.dir = "right" ⇒ only blocks movement whose FROM point is to the RIGHT.
 *   Wall.dir = "both"  ⇒ always blocks (regardless of side).
 *
 * @param from  Starting position in scene pixels.
 * @param to    Target position in scene pixels.
 * @param walls Walls to test (typically output of wallsBlockingMovement).
 * @returns true if any wall blocks the movement segment.
 */
export function moveBlocked(
  from: { x: number; y: number },
  to: { x: number; y: number },
  walls: readonly Wall[],
): boolean {
  for (const wall of walls) {
    // Skip open doors (should already be filtered, but guard here too).
    if (wall.doorState === "open") continue;
    if (wall.move === "none") continue;

    const result = segmentIntersect(
      from.x,
      from.y,
      to.x,
      to.y,
      wall.a.x,
      wall.a.y,
      wall.b.x,
      wall.b.y,
    );

    if (!result.hit) continue;

    // Check directionality (REQ-VIS-003, REQ-VIS-026).
    if (wall.dir !== "both") {
      // Cross product of wall direction (a→b) with vector from wall.a to `from`.
      const wallDx = wall.b.x - wall.a.x;
      const wallDy = wall.b.y - wall.a.y;
      const toDx = from.x - wall.a.x;
      const toDy = from.y - wall.a.y;
      const cross = wallDx * toDy - wallDy * toDx;

      // cross > 0: `from` is to the LEFT of a→b
      // cross < 0: `from` is to the RIGHT of a→b
      // cross ≈ 0: `from` is on the wall line — treat as blocked (conservative)
      if (wall.dir === "left" && cross < -DIST_EPSILON) continue;
      if (wall.dir === "right" && cross > DIST_EPSILON) continue;
    }

    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Wall preset helpers — for ergonomic wall creation in tests/tooling
// ---------------------------------------------------------------------------

/** Common preset configurations. */
export function makeWall(
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  overrides: Partial<Omit<Wall, "_id" | "a" | "b">> = {},
): Wall {
  return {
    _id: id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    move: "normal",
    sight: "normal",
    light: "normal",
    sound: "normal",
    dir: "both",
    doorType: "none",
    doorState: "closed",
    ...overrides,
  };
}

/** Terrain wall preset (sight/light limited, move normal). */
export function makeTerrainWall(id: string, ax: number, ay: number, bx: number, by: number): Wall {
  return makeWall(id, ax, ay, bx, by, {
    sight: "limited",
    light: "limited",
    sound: "limited",
  });
}

/** Invisible wall preset (sight/light none, move normal — glass-like). */
export function makeInvisibleWall(
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Wall {
  return makeWall(id, ax, ay, bx, by, {
    sight: "none",
    light: "none",
    sound: "none",
  });
}

/** Ethereal wall preset (sight/light normal, move none). */
export function makeEtherealWall(id: string, ax: number, ay: number, bx: number, by: number): Wall {
  return makeWall(id, ax, ay, bx, by, {
    move: "none",
  });
}

/** Door (closed). */
export function makeDoor(
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  state: DoorState = "closed",
): Wall {
  return makeWall(id, ax, ay, bx, by, {
    doorType: "door",
    doorState: state,
  });
}

import type { DoorState } from "./types.js";
