/**
 * token-interaction.test.ts — Vitest tests for the token drag state machine
 * and related pure helpers.
 *
 * No PIXI, no DOM. Safe under Vitest node environment.
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-034..036, §DEC-CNV-05
 * Spec: 04-rede-e-sincronizacao.md §REQ-NET-050..052
 */

import { describe, it, expect } from "vitest";
import {
  canMoveToken,
  snapTokenToGrid,
  arrowMoveToken,
  createDragMachine,
  startDrag,
  updateDragPosition,
  confirmDrop,
  cancelDrag,
  confirmMove,
  rollbackMove,
  resetToIdle,
  isTokenPending,
  canStartDrag,
  ROLE_ASSISTANT,
  ROLE_GAMEMASTER,
} from "../token-interaction.js";
import { SquareGrid } from "@fusion/shared";
import type { GridConfig, TokenDocument } from "@fusion/shared";

/** Build a square grid for the tests, with an optional origin offset. */
function squareGrid(size: number, offsetX = 0, offsetY = 0): SquareGrid {
  const config: GridConfig = {
    type: "square",
    size,
    distance: 5,
    units: "ft",
    color: "#000000",
    alpha: 0.4,
    diagonalRule: "alternating_1",
  };
  return new SquareGrid(config, { x: offsetX, y: offsetY });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return {
    _id: "AAAA0000000001",
    name: "Goblin",
    actorId: "actor001",
    texture: null,
    x: 100,
    y: 100,
    width: 1,
    height: 1,
    rotation: 0,
    elevation: 0,
    hidden: false,
    disposition: 0,
    bar1: { attribute: null },
    bar2: { attribute: null },
    flags: {},
    vision: {
      enabled: false,
      range: null,
      angle: 360,
      visionMode: "basic",
      detectionModes: [{ id: "sight", range: null, enabled: true }],
    },
    light: {
      brightRadius: 0,
      dimRadius: 0,
      angle: 360,
      color: "#ffffff",
      intensity: 0.5,
      gradual: true,
      enabled: false,
    },
    ...overrides,
  };
}

const GRID = squareGrid(100);
const GRID_WITH_OFFSET = squareGrid(100, 50, 25);

// ---------------------------------------------------------------------------
// canMoveToken
// ---------------------------------------------------------------------------

describe("canMoveToken", () => {
  it("GM (role 4) can move any token", () => {
    const token = makeToken({ actorId: "actor-xyz" });
    expect(canMoveToken(token, "user-gm", ROLE_GAMEMASTER, new Set())).toBe(true);
  });

  it("ASSISTANT (role 3) can move any token", () => {
    const token = makeToken({ actorId: "actor-xyz" });
    expect(canMoveToken(token, "user-assist", ROLE_ASSISTANT, new Set())).toBe(true);
  });

  it("PLAYER can move token linked to their actor", () => {
    const token = makeToken({ actorId: "actor001" });
    expect(canMoveToken(token, "player1", 1, new Set(["actor001"]))).toBe(true);
  });

  it("PLAYER cannot move token linked to another actor", () => {
    const token = makeToken({ actorId: "actor999" });
    expect(canMoveToken(token, "player1", 1, new Set(["actor001"]))).toBe(false);
  });

  it("PLAYER cannot move token with null actorId (anonymous token)", () => {
    const token = makeToken({ actorId: null });
    expect(canMoveToken(token, "player1", 1, new Set(["actor001"]))).toBe(false);
  });

  it("PLAYER cannot move token when ownedActorIds is empty", () => {
    const token = makeToken({ actorId: "actor001" });
    expect(canMoveToken(token, "player1", 1, new Set())).toBe(false);
  });

  it("TRUSTED (role 2) follows same ownership rule as PLAYER", () => {
    const token = makeToken({ actorId: "actor001" });
    expect(canMoveToken(token, "player2", 2, new Set(["actor001"]))).toBe(true);
    expect(canMoveToken(token, "player2", 2, new Set())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapTokenToGrid
// ---------------------------------------------------------------------------

describe("snapTokenToGrid", () => {
  it("snaps 1x1 token at exact center position to same cell center top-left", () => {
    // Grid size 100, center of cell (0,0) is (50,50). Token top-left at (0,0).
    const result = snapTokenToGrid(0, 0, 1, 1, GRID);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("snaps 1x1 token from arbitrary point to nearest cell top-left", () => {
    // Cursor at (60,60) — center of footprint is at (110, 110) → snaps to cell (1,1) center (150,150)
    // → top-left = (100, 100)
    const result = snapTokenToGrid(60, 60, 1, 1, GRID);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
  });

  it("snaps 2x2 token correctly (multi-cell footprint)", () => {
    // Grid size 100. Cursor top-left at (80, 80).
    // Footprint center = (80 + 100, 80 + 100) = (180, 180)
    // Nearest cell center at size=100 → cell (1,1) center = (150,150)
    // top-left = (150 - 100, 150 - 100) = (50, 50)
    const result = snapTokenToGrid(80, 80, 2, 2, GRID);
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
  });

  it("respects grid offset", () => {
    // Grid offset (50, 25), size 100. Cell (0,0) center = (100, 75).
    // Cursor at (60, 40), footprint 1x1: center = (110, 90)
    // Nearest center = (100, 75) → top-left = (50, 25)
    const result = snapTokenToGrid(60, 40, 1, 1, GRID_WITH_OFFSET);
    expect(result.x).toBe(50);
    expect(result.y).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// arrowMoveToken
// ---------------------------------------------------------------------------

describe("arrowMoveToken", () => {
  it("moves up by one grid size", () => {
    const result = arrowMoveToken(100, 200, "up", GRID);
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it("moves down by one grid size", () => {
    const result = arrowMoveToken(100, 200, "down", GRID);
    expect(result).toEqual({ x: 100, y: 300 });
  });

  it("moves left by one grid size", () => {
    const result = arrowMoveToken(200, 100, "left", GRID);
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it("moves right by one grid size", () => {
    const result = arrowMoveToken(200, 100, "right", GRID);
    expect(result).toEqual({ x: 300, y: 100 });
  });

  it("handles large grid size (e.g., 150px)", () => {
    const bigGrid = squareGrid(150);
    const result = arrowMoveToken(0, 0, "right", bigGrid);
    expect(result).toEqual({ x: 150, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// Drag machine — basic transitions
// ---------------------------------------------------------------------------

describe("Drag machine — basic transitions", () => {
  it("starts in idle state", () => {
    const m = createDragMachine();
    expect(m.state).toBe("idle");
    expect(m.context).toBeNull();
  });

  it("idle → dragging on startDrag", () => {
    const m = createDragMachine();
    const m2 = startDrag(m, "tok1", 100, 200, "req-001");
    expect(m2.state).toBe("dragging");
    expect(m2.context?.tokenId).toBe("tok1");
    expect(m2.context?.originalX).toBe(100);
    expect(m2.context?.originalY).toBe(200);
    expect(m2.context?.ghostX).toBe(100);
    expect(m2.context?.ghostY).toBe(200);
    expect(m2.context?.isPending).toBe(false);
  });

  it("startDrag is a no-op when already dragging", () => {
    const m = startDrag(createDragMachine(), "tok1", 0, 0, "req-001");
    const m2 = startDrag(m, "tok2", 100, 100, "req-002");
    expect(m2).toBe(m); // same reference — no-op
  });

  it("dragging → updates ghost on updateDragPosition", () => {
    const m = startDrag(createDragMachine(), "tok1", 100, 100, "req-001");
    const m2 = updateDragPosition(m, 200, 300);
    expect(m2.state).toBe("dragging");
    expect(m2.context?.ghostX).toBe(200);
    expect(m2.context?.ghostY).toBe(300);
    expect(m2.context?.originalX).toBe(100); // unchanged
  });

  it("updateDragPosition is a no-op when not dragging", () => {
    const m = createDragMachine();
    const m2 = updateDragPosition(m, 200, 300);
    expect(m2).toBe(m);
  });

  it("dragging → pending on confirmDrop (ghost moved)", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 100, 100, "req-001");
    m = updateDragPosition(m, 200, 300);
    const m2 = confirmDrop(m);
    expect(m2.state).toBe("pending");
    expect(m2.context?.isPending).toBe(true);
  });

  it("dragging → confirmed directly when ghost didn't move", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 100, 100, "req-001");
    // Ghost same as original
    const m2 = confirmDrop(m);
    expect(m2.state).toBe("confirmed");
  });

  it("dragging → idle on cancelDrag (ESC)", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 100, 100, "req-001");
    m = updateDragPosition(m, 200, 200);
    const m2 = cancelDrag(m);
    expect(m2.state).toBe("idle");
    expect(m2.context).toBeNull();
  });

  it("cancelDrag is a no-op when not dragging", () => {
    const m = createDragMachine();
    const m2 = cancelDrag(m);
    expect(m2).toBe(m);
  });

  it("pending → confirmed on confirmMove", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 100, 100, "req-001");
    m = updateDragPosition(m, 200, 300);
    m = confirmDrop(m);
    const m2 = confirmMove(m);
    expect(m2.state).toBe("confirmed");
    expect(m2.context?.isPending).toBe(false);
  });

  it("confirmed → idle on resetToIdle", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 100, 100, "req-001");
    m = updateDragPosition(m, 200, 300);
    m = confirmDrop(m);
    m = confirmMove(m);
    const m2 = resetToIdle(m);
    expect(m2.state).toBe("idle");
    expect(m2.context).toBeNull();
  });

  it("resetToIdle is a no-op from non-terminal states", () => {
    const m = startDrag(createDragMachine(), "tok1", 0, 0, "req");
    const m2 = resetToIdle(m);
    expect(m2).toBe(m); // no-op from dragging
  });
});

// ---------------------------------------------------------------------------
// Drag machine — ACK failure → rollback (REQ-NET-051)
// ---------------------------------------------------------------------------

describe("Drag machine — ack error → rollback", () => {
  it("pending → rolledback with authoritative position on rollbackMove", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 100, 100, "req-001");
    m = updateDragPosition(m, 400, 500);
    m = confirmDrop(m);
    expect(m.state).toBe("pending");

    const m2 = rollbackMove(m, 100, 100);
    expect(m2.state).toBe("rolledback");
    expect(m2.context?.ghostX).toBe(100); // authoritative position
    expect(m2.context?.ghostY).toBe(100);
    expect(m2.context?.isPending).toBe(false);
  });

  it("rolledback → idle on resetToIdle", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 100, 100, "req-001");
    m = updateDragPosition(m, 400, 500);
    m = confirmDrop(m);
    m = rollbackMove(m, 100, 100);
    expect(m.state).toBe("rolledback");
    const m2 = resetToIdle(m);
    expect(m2.state).toBe("idle");
    expect(m2.context).toBeNull();
  });

  it("rollbackMove is a no-op when not pending", () => {
    const m = createDragMachine();
    const m2 = rollbackMove(m, 50, 50);
    expect(m2).toBe(m);
  });

  it("rollback preserves originalX/Y for reference", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 50, 75, "req-001");
    m = updateDragPosition(m, 300, 400);
    m = confirmDrop(m);
    m = rollbackMove(m, 50, 75);
    // The rollback target = original position
    expect(m.context?.originalX).toBe(50);
    expect(m.context?.originalY).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Drag machine — two rapid moves in sequence (REQ-NET-051)
// ---------------------------------------------------------------------------

describe("Drag machine — two rapid moves in sequence", () => {
  it("second drag cannot start while first is pending", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    expect(m.state).toBe("pending");

    // Attempt second drag — should be blocked
    expect(canStartDrag(m, "tok1")).toBe(false);
    const m2 = startDrag(m, "tok1", 100, 100, "req-002");
    expect(m2.state).toBe("pending"); // no-op, state unchanged
    expect(m2).toBe(m);
  });

  it("second drag can start after first is confirmed+reset", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    m = confirmMove(m);
    m = resetToIdle(m);
    expect(m.state).toBe("idle");

    expect(canStartDrag(m, "tok1")).toBe(true);
    const m2 = startDrag(m, "tok1", 100, 100, "req-002");
    expect(m2.state).toBe("dragging");
    expect(m2.context?.ghostX).toBe(100);
  });

  it("second drag can start after first is rolled back+reset", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    m = rollbackMove(m, 0, 0);
    m = resetToIdle(m);
    expect(m.state).toBe("idle");

    expect(canStartDrag(m, "tok1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pending indicator (RTT feedback)
// ---------------------------------------------------------------------------

describe("isTokenPending", () => {
  it("returns true for the pending token", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    expect(m.state).toBe("pending");
    expect(isTokenPending(m, "tok1")).toBe(true);
  });

  it("returns false for a different token while another is pending", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    expect(isTokenPending(m, "tok2")).toBe(false);
  });

  it("returns false after move confirmed", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    m = confirmMove(m);
    expect(isTokenPending(m, "tok1")).toBe(false);
  });

  it("returns false in idle state", () => {
    const m = createDragMachine();
    expect(isTokenPending(m, "tok1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ESC cancels drag mid-flight
// ---------------------------------------------------------------------------

describe("ESC cancels drag mid-flight", () => {
  it("cancels during dragging — context cleared", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 50, 50, "req-001");
    m = updateDragPosition(m, 200, 200);
    m = cancelDrag(m);

    expect(m.state).toBe("idle");
    expect(m.context).toBeNull();
  });

  it("cancelDrag from confirmed is a no-op", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    m = confirmMove(m);
    const m2 = cancelDrag(m);
    expect(m2).toBe(m); // no-op from non-dragging state
  });

  it("cancelDrag from pending is a no-op (too late — already sent to server)", () => {
    let m = createDragMachine();
    m = startDrag(m, "tok1", 0, 0, "req-001");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    expect(m.state).toBe("pending");
    const m2 = cancelDrag(m);
    // cancelDrag only transitions from dragging; pending is not dragging
    expect(m2).toBe(m); // no-op
    expect(m2.state).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// canStartDrag
// ---------------------------------------------------------------------------

describe("canStartDrag", () => {
  it("allows start in idle", () => {
    expect(canStartDrag(createDragMachine(), "tok1")).toBe(true);
  });

  it("blocks start while dragging", () => {
    const m = startDrag(createDragMachine(), "tok1", 0, 0, "req");
    expect(canStartDrag(m, "tok1")).toBe(false);
    expect(canStartDrag(m, "tok2")).toBe(false);
  });

  it("blocks start while pending", () => {
    let m = startDrag(createDragMachine(), "tok1", 0, 0, "req");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    expect(canStartDrag(m, "tok1")).toBe(false);
  });

  it("allows start from confirmed (terminal)", () => {
    let m = startDrag(createDragMachine(), "tok1", 0, 0, "req");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    m = confirmMove(m);
    expect(canStartDrag(m, "tok1")).toBe(true);
  });

  it("allows start from rolledback (terminal)", () => {
    let m = startDrag(createDragMachine(), "tok1", 0, 0, "req");
    m = updateDragPosition(m, 100, 100);
    m = confirmDrop(m);
    m = rollbackMove(m, 0, 0);
    expect(canStartDrag(m, "tok1")).toBe(true);
  });
});
