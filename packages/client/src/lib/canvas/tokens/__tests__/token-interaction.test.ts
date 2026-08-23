/**
 * token-interaction.test.ts — Vitest tests for the token drag state machine
 * and related pure helpers.
 *
 * No PIXI, no DOM. Safe under Vitest node environment.
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-034..036, §D5
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
  isEditableTarget,
  canOpenTokenSheet,
  registerTokenClick,
  DOUBLE_CLICK_WINDOW_MS,
  type GridSnapConfig,
} from "../token-interaction.js";
import type { TokenDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return {
    _id: "AAAA0000000001",
    name: "Goblin",
    actorId: "actor001",
    actorLink: true,
    actorDelta: null,
    x: 100,
    y: 100,
    rotation: 0,
    elevation: 0,
    hidden: false,
    disposition: 0,
    seenBy: [],
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

const GRID: GridSnapConfig = { size: 100, offsetX: 0, offsetY: 0 };
const GRID_WITH_OFFSET: GridSnapConfig = { size: 100, offsetX: 50, offsetY: 25 };

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

  // REQ-TOK-002 (DEC-TOK-04): `actorId` is a required field on
  // `TokenDocumentSchema` now — a token with no actor is not a representable
  // state anymore, so "anonymous token" has no runtime case left to test
  // here (the type system is the enforcement).

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
// arrowMoveToken — REQ-TOK-040/REQ-A11-036 (spec 41-token.md TK060, DEC-TOK-07):
// the four arrow keys move the selected token exactly one grid cell per
// keypress, orthogonally only (no diagonal offered by a single keypress) —
// this IS the non-drag alternative REQ-A11-036 (spec 23) requires for the
// token-move gesture, wired end-to-end in
// TokenInteractionManager._handleKeyDown (ArrowUp/Down/Left/Right →
// arrowMoveToken → the same _sendMoveOp drag uses, REQ-TOK-041).
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
    const bigGrid: GridSnapConfig = { size: 150, offsetX: 0, offsetY: 0 };
    const result = arrowMoveToken(0, 0, "right", bigGrid);
    expect(result).toEqual({ x: 150, y: 0 });
  });

  // REQ-TOK-043 (CA-TOK-002): a multi-cell footprint stays grid-snapped after
  // an arrow move. arrowMoveToken only ever adds/subtracts a whole
  // `grid.size` to an already grid-aligned coordinate — it never needs to
  // know the footprint's width/height to keep that invariant, unlike
  // REQ-CNV-023's snapping (snapTokenToGrid, exercised separately above),
  // which centers a drop using the footprint. This pins that a 2×2 (Grande)
  // token's position — the top-left corner its footprint is measured from —
  // is exactly as grid-aligned after the move as before it.
  it("keeps a multi-cell footprint's origin grid-aligned after an arrow move (REQ-TOK-043)", () => {
    // A 2x2 (Grande) token's top-left corner already sits on a grid line.
    const origin = { x: 200, y: 200 };
    expect(origin.x % GRID.size).toBe(0);
    expect(origin.y % GRID.size).toBe(0);

    const moved = arrowMoveToken(origin.x, origin.y, "right", GRID);
    expect(moved.x % GRID.size).toBe(0);
    expect(moved.y % GRID.size).toBe(0);
    expect(moved).toEqual({ x: 300, y: 200 });
  });
});

// ---------------------------------------------------------------------------
// Drag machine — basic transitions
//
// REQ-TOK-041 (TK061, spec 41-token.md): the drag gesture moves the token
// with "o mesmo efeito e a mesma validação" as the keyboard — not a second
// permission path. Both gestures are two entry points into ONE code path:
// TokenInteractionManager's `_handleKeyDown` (arrow keys, via
// `arrowMoveToken` above) and its pointer handlers (drag, machine below) both
// gate on the identical `canMoveToken` check and both end at the identical
// `_sendMoveOp` → `doc:update` (embedded Token) write — see
// TokenInteractionManager.ts, not a second implementation here.
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

// ---------------------------------------------------------------------------
// isEditableTarget — R3 keyboard target guard
// ---------------------------------------------------------------------------

describe("isEditableTarget", () => {
  it("returns false for null/undefined", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });

  it("returns true for INPUT, TEXTAREA, SELECT (any case)", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "input" })).toBe(true);
  });

  // P2 (post-#194 audit, REQ-A11-036): an `<input type="checkbox">` (the
  // side drawer has several) is not something the user TYPES into, so the
  // keyboard-alternative actions it guards (Backspace/arrows/KeyD on the
  // selected token) must still fire when one of those has focus. Only a
  // textual `type` should block them.
  it("gates INPUT by `type`: non-textual types are not editable, textual ones are", () => {
    expect(isEditableTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "radio" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "button" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "range" })).toBe(false);

    expect(isEditableTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true); // no `type` defaults to "text"
    expect(isEditableTarget({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT", type: "number" })).toBe(true);
  });

  it("returns true for a contenteditable element (e.g. TipTap's chat composer)", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("returns false for a plain, non-editable element like document.body", () => {
    expect(isEditableTarget({ tagName: "BODY" })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isEditableTarget({ tagName: "CANVAS" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TK110 — the gesture that opens the sheet (REQ-TOK-110..113)
// ---------------------------------------------------------------------------

describe("registerTokenClick (REQ-TOK-110): two clicks on the SAME token, close in time", () => {
  it("the first click is never a double click", () => {
    const first = registerTokenClick(null, "tok1", 1_000);
    expect(first.isDoubleClick).toBe(false);
    expect(first.tracker).not.toBeNull();
  });

  it("a second click on the same token inside the window IS a double click", () => {
    const first = registerTokenClick(null, "tok1", 1_000);
    const second = registerTokenClick(first.tracker, "tok1", 1_000 + DOUBLE_CLICK_WINDOW_MS - 1);
    expect(second.isDoubleClick).toBe(true);
  });

  it("a second click on a DIFFERENT token is not a double click, and re-arms on the new token", () => {
    const first = registerTokenClick(null, "tok1", 1_000);
    const second = registerTokenClick(first.tracker, "tok2", 1_050);
    expect(second.isDoubleClick).toBe(false);

    const third = registerTokenClick(second.tracker, "tok2", 1_100);
    expect(third.isDoubleClick).toBe(true);
  });

  it("a second click after the window closed is a fresh first click", () => {
    const first = registerTokenClick(null, "tok1", 1_000);
    const late = registerTokenClick(first.tracker, "tok1", 1_000 + DOUBLE_CLICK_WINDOW_MS + 1);
    expect(late.isDoubleClick).toBe(false);
    expect(late.tracker).not.toBeNull();
  });

  it("a THIRD rapid click does not open a second sheet — the pair is consumed", () => {
    const c1 = registerTokenClick(null, "tok1", 1_000);
    const c2 = registerTokenClick(c1.tracker, "tok1", 1_100);
    expect(c2.isDoubleClick).toBe(true);
    // The double click consumed the tracker: click 3 starts a NEW pair.
    const c3 = registerTokenClick(c2.tracker, "tok1", 1_200);
    expect(c3.isDoubleClick).toBe(false);
    const c4 = registerTokenClick(c3.tracker, "tok1", 1_300);
    expect(c4.isDoubleClick).toBe(true);
  });
});

describe("canOpenTokenSheet (REQ-TOK-111): the same rule as moving, never a second predicate", () => {
  const token = makeToken({ actorId: "actor001" });

  it("a privileged role opens the sheet of any token", () => {
    expect(canOpenTokenSheet(token, "gm", ROLE_GAMEMASTER, new Set())).toBe(true);
    expect(canOpenTokenSheet(token, "gm", ROLE_ASSISTANT, new Set())).toBe(true);
  });

  it("a player opens the sheet of an actor they own", () => {
    expect(canOpenTokenSheet(token, "p1", 1, new Set(["actor001"]))).toBe(true);
  });

  it("a player does NOT open the sheet of an actor they do not own (REQ-TOK-070)", () => {
    expect(canOpenTokenSheet(token, "p1", 1, new Set(["actor999"]))).toBe(false);
  });

  it("answers exactly what canMoveToken answers, for every combination", () => {
    const cases: { role: number; owned: Set<string> }[] = [
      { role: 1, owned: new Set() },
      { role: 1, owned: new Set(["actor001"]) },
      { role: 2, owned: new Set() },
      { role: ROLE_ASSISTANT, owned: new Set() },
      { role: ROLE_GAMEMASTER, owned: new Set() },
    ];
    for (const c of cases) {
      expect(canOpenTokenSheet(token, "u", c.role, c.owned)).toBe(
        canMoveToken(token, "u", c.role, c.owned),
      );
    }
  });
});
