/**
 * window-manager.test.ts — Exhaustive unit tests for WindowManager pure logic.
 *
 * Covers (per task spec):
 *  1. Z-order with 5 windows and alternating focus
 *  2. Clamp on all edges
 *  3. Minimum resize enforcement
 *  4. Persistence roundtrip (localStorage)
 *  5. Cascade positioning
 *  6. Singleton window focus instead of duplicate
 *  7. Close + active window promotion
 *  8. onViewportResize re-clamps all windows
 */

import { describe, it, expect } from "vitest";
import {
  WindowManager,
  clampToViewport,
  cascadePosition,
  type ViewportSize,
} from "../window-manager.js";

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VP: ViewportSize = { width: 1280, height: 800 };

function freshManager(): WindowManager {
  localStorageMock.clear();
  const mgr = new WindowManager();
  mgr.viewport = VP;
  return mgr;
}

// ---------------------------------------------------------------------------
// clampToViewport — pure function tests
// ---------------------------------------------------------------------------

describe("clampToViewport", () => {
  it("identity: window fully inside viewport is unchanged", () => {
    const result = clampToViewport({ top: 100, left: 100, width: 400, height: 300 }, VP);
    expect(result).toEqual({ top: 100, left: 100, width: 400, height: 300 });
  });

  it("clamps top to 0 when negative", () => {
    const result = clampToViewport({ top: -50, left: 100, width: 400, height: 300 }, VP);
    expect(result.top).toBe(0);
  });

  it("clamps top so header stays above bottom edge (margin = 40 default)", () => {
    const result = clampToViewport(
      { top: VP.height + 100, left: 100, width: 400, height: 300 },
      VP,
    );
    // top must not exceed viewport.height - margin(40) = 760
    expect(result.top).toBe(VP.height - 40);
  });

  it("allows left to go negative as long as margin px remain on screen", () => {
    // left = -(width - margin) should be the min
    const width = 400;
    const margin = 40;
    const minLeft = -(width - margin); // -360
    const result = clampToViewport({ top: 100, left: -500, width, height: 300 }, VP);
    expect(result.left).toBe(minLeft);
  });

  it("clamps left when window pushed past right edge", () => {
    const result = clampToViewport({ top: 100, left: VP.width + 200, width: 400, height: 300 }, VP);
    // left must not exceed viewport.width - margin(40)
    expect(result.left).toBe(VP.width - 40);
  });

  it("enforces minimum width", () => {
    const result = clampToViewport(
      { top: 100, left: 100, width: 50, height: 300 },
      VP,
      40,
      200,
      100,
    );
    expect(result.width).toBe(200);
  });

  it("enforces minimum height", () => {
    const result = clampToViewport(
      { top: 100, left: 100, width: 400, height: 20 },
      VP,
      40,
      200,
      100,
    );
    expect(result.height).toBe(100);
  });

  it("clamps width to viewport width", () => {
    const result = clampToViewport({ top: 0, left: 0, width: VP.width + 500, height: 300 }, VP);
    expect(result.width).toBe(VP.width);
  });

  it("clamps height to viewport height", () => {
    const result = clampToViewport({ top: 0, left: 0, width: 400, height: VP.height + 500 }, VP);
    expect(result.height).toBe(VP.height);
  });

  it("custom margin is respected", () => {
    const margin = 80;
    const result = clampToViewport(
      { top: VP.height + 200, left: 100, width: 400, height: 300 },
      VP,
      margin,
    );
    expect(result.top).toBe(VP.height - margin);
  });
});

// ---------------------------------------------------------------------------
// cascadePosition
// ---------------------------------------------------------------------------

describe("cascadePosition", () => {
  it("returns base position when no windows open", () => {
    const mgr = freshManager();
    const pos = cascadePosition(mgr.windows, VP);
    expect(pos.top).toBeGreaterThan(0);
    expect(pos.left).toBeGreaterThan(0);
  });

  it("offsets each subsequent window by CASCADE_OFFSET", () => {
    const mgr = freshManager();
    const pos0 = cascadePosition(mgr.windows, VP);
    mgr.open({ title: "Win 1" });
    const pos1 = cascadePosition(mgr.windows, VP);
    expect(pos1.top).toBeGreaterThan(pos0.top);
    expect(pos1.left).toBeGreaterThan(pos0.left);
  });

  it("wraps after CASCADE_MAX_STEPS (12) windows", () => {
    const mgr = freshManager();
    // Open 12 windows
    for (let i = 0; i < 12; i++) mgr.open({ title: `Win ${i}` });
    const posAtWrap = cascadePosition(mgr.windows, VP);
    // After 12 windows, count % 12 = 0 → same as starting position
    const posAtStart = cascadePosition(new Map(), VP);
    expect(posAtWrap.top).toBe(posAtStart.top);
    expect(posAtWrap.left).toBe(posAtStart.left);
  });
});

// ---------------------------------------------------------------------------
// Z-order — 5 windows, alternating focus
// ---------------------------------------------------------------------------

describe("Z-order with 5 windows and alternating focus", () => {
  it("each newly opened window has higher zIndex than the previous", () => {
    const mgr = freshManager();
    const ids = ["a", "b", "c", "d", "e"].map((title) => mgr.open({ title }).id);
    const zIndices = ids.map((id) => mgr.windows.get(id)!.zIndex);
    for (let i = 1; i < zIndices.length; i++) {
      expect(zIndices[i]!).toBeGreaterThan(zIndices[i - 1]!);
    }
  });

  it("focusing a window gives it the highest zIndex", () => {
    const mgr = freshManager();
    const h0 = mgr.open({ title: "A" });
    const h1 = mgr.open({ title: "B" });
    const h2 = mgr.open({ title: "C" });
    const h3 = mgr.open({ title: "D" });
    const h4 = mgr.open({ title: "E" });

    // Focus A (the oldest one)
    mgr.focus(h0.id);
    const zA = mgr.windows.get(h0.id)!.zIndex;
    // zA must be higher than all others
    for (const h of [h1, h2, h3, h4]) {
      expect(zA).toBeGreaterThan(mgr.windows.get(h.id)!.zIndex);
    }
  });

  it("alternating focus keeps correct ordering: C > A > E > B > D", () => {
    const mgr = freshManager();
    const ids5 = ["A", "B", "C", "D", "E"].map((t) => mgr.open({ title: t }).id);
    const a = ids5[0]!;
    const b = ids5[1]!;
    const c = ids5[2]!;
    const d = ids5[3]!;
    const e = ids5[4]!;

    // Sequence: focus D, focus B, focus E, focus A, focus C
    const sequence = [d, b, e, a, c];
    for (const id of sequence) mgr.focus(id);

    const zOf = (id: string) => mgr.windows.get(id)!.zIndex;

    // After the sequence, c was focused last → highest
    expect(zOf(c)).toBeGreaterThan(zOf(a));
    expect(zOf(a)).toBeGreaterThan(zOf(e));
    expect(zOf(e)).toBeGreaterThan(zOf(b));
    expect(zOf(b)).toBeGreaterThan(zOf(d));
  });

  it("activeWindowId tracks the last focused window", () => {
    const mgr = freshManager();
    const ha = mgr.open({ title: "A" });
    const hb = mgr.open({ title: "B" });
    expect(mgr.activeWindowId).toBe(hb.id);
    mgr.focus(ha.id);
    expect(mgr.activeWindowId).toBe(ha.id);
  });
});

// ---------------------------------------------------------------------------
// Singleton / focus existing (REQ-UIF-014)
// ---------------------------------------------------------------------------

describe("Singleton window", () => {
  it("opening the same singletonKey focuses the existing window instead of opening a new one", () => {
    const mgr = freshManager();
    const h1 = mgr.open({ title: "Sheet A", singletonKey: "sheet:actor-1" });
    const h2 = mgr.open({ title: "Sheet A", singletonKey: "sheet:actor-1" });

    expect(h1.id).toBe(h2.id);
    expect(mgr.windows.size).toBe(1);
  });

  it("different singletonKeys open separate windows", () => {
    const mgr = freshManager();
    mgr.open({ title: "Sheet A", singletonKey: "sheet:actor-1" });
    mgr.open({ title: "Sheet B", singletonKey: "sheet:actor-2" });
    expect(mgr.windows.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Minimize / restore
// ---------------------------------------------------------------------------

describe("Minimize and restore", () => {
  it("minimized flag is set to true when minimized", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "Test" });
    mgr.minimize(h.id);
    expect(mgr.windows.get(h.id)!.minimized).toBe(true);
  });

  it("minimized flag is false after restore", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "Test" });
    mgr.minimize(h.id);
    mgr.restore(h.id);
    expect(mgr.windows.get(h.id)!.minimized).toBe(false);
  });

  it("restore brings the window to front", () => {
    const mgr = freshManager();
    const ha = mgr.open({ title: "A" });
    const hb = mgr.open({ title: "B" });
    mgr.minimize(ha.id);
    mgr.restore(ha.id);
    expect(mgr.windows.get(ha.id)!.zIndex).toBeGreaterThan(mgr.windows.get(hb.id)!.zIndex);
  });

  it("non-minimizable window is not minimized", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "Fixed", minimizable: false });
    mgr.minimize(h.id);
    expect(mgr.windows.get(h.id)!.minimized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Close + active window promotion
// ---------------------------------------------------------------------------

describe("Close", () => {
  it("removes the window from the registry", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A" });
    mgr.close(h.id);
    expect(mgr.windows.has(h.id)).toBe(false);
  });

  it("promotes the next highest-z window to active when active is closed", () => {
    const mgr = freshManager();
    const ha = mgr.open({ title: "A" });
    const hb = mgr.open({ title: "B" });
    const hc = mgr.open({ title: "C" }); // highest z, active

    // B is second highest
    mgr.close(hc.id);
    expect(mgr.activeWindowId).toBe(hb.id);

    // Close B → A becomes active
    mgr.close(hb.id);
    expect(mgr.activeWindowId).toBe(ha.id);
  });

  it("activeWindowId is null when all windows are closed", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A" });
    mgr.close(h.id);
    expect(mgr.activeWindowId).toBeNull();
  });

  it("closeAll removes all windows", () => {
    const mgr = freshManager();
    mgr.open({ title: "A" });
    mgr.open({ title: "B" });
    mgr.open({ title: "C" });
    mgr.closeAll();
    expect(mgr.windows.size).toBe(0);
    expect(mgr.activeWindowId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setPosition — move and resize with clamp
// ---------------------------------------------------------------------------

describe("setPosition", () => {
  it("updates position within valid bounds", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A" });
    mgr.setPosition(h.id, { top: 200, left: 300 });
    const w = mgr.windows.get(h.id)!;
    expect(w.top).toBe(200);
    expect(w.left).toBe(300);
  });

  it("clamps top to 0 if set negative", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A" });
    mgr.setPosition(h.id, { top: -100 });
    expect(mgr.windows.get(h.id)!.top).toBeGreaterThanOrEqual(0);
  });

  it("enforces minimum width on resize", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A", minWidth: 200 });
    mgr.setPosition(h.id, { width: 50 });
    expect(mgr.windows.get(h.id)!.width).toBeGreaterThanOrEqual(200);
  });

  it("enforces minimum height on resize", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A", minHeight: 100 });
    mgr.setPosition(h.id, { height: 30 });
    expect(mgr.windows.get(h.id)!.height).toBeGreaterThanOrEqual(100);
  });

  it("partial update preserves untouched properties", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A" });
    const before = { ...mgr.windows.get(h.id)! };
    mgr.setPosition(h.id, { top: 50 });
    const after = mgr.windows.get(h.id)!;
    expect(after.left).toBe(before.left);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });
});

// ---------------------------------------------------------------------------
// Persistence roundtrip
// ---------------------------------------------------------------------------

describe("Persistence roundtrip (localStorage)", () => {
  it("geometry is persisted after open and restored on next open with same singletonKey", () => {
    localStorageMock.clear();
    const mgr1 = new WindowManager();
    mgr1.viewport = VP;

    const h = mgr1.open({ title: "Sheet", singletonKey: "persist:test" });
    mgr1.setPosition(h.id, { top: 150, left: 200, width: 600, height: 450 });

    // New manager simulates page reload
    const mgr2 = new WindowManager();
    mgr2.viewport = VP;
    const h2 = mgr2.open({ title: "Sheet", singletonKey: "persist:test" });
    const w = mgr2.windows.get(h2.id)!;

    expect(w.top).toBe(150);
    expect(w.left).toBe(200);
    expect(w.width).toBe(600);
    expect(w.height).toBe(450);
  });

  it("minimized state is persisted", () => {
    localStorageMock.clear();
    const mgr1 = new WindowManager();
    mgr1.viewport = VP;

    const h = mgr1.open({ title: "Sheet", singletonKey: "persist:minimize" });
    mgr1.minimize(h.id);

    const mgr2 = new WindowManager();
    mgr2.viewport = VP;
    const h2 = mgr2.open({ title: "Sheet", singletonKey: "persist:minimize" });
    expect(mgr2.windows.get(h2.id)!.minimized).toBe(true);
  });

  it("persisted position off-screen is clamped back into viewport", () => {
    localStorageMock.clear();
    const mgr1 = new WindowManager();
    mgr1.viewport = { width: 2560, height: 1440 }; // large screen

    const h = mgr1.open({ title: "Sheet", singletonKey: "persist:clamp" });
    // Force save an off-screen position for a smaller viewport
    mgr1.setPosition(h.id, { top: 1200, left: 2000, width: 400, height: 300 });

    // New manager with smaller viewport
    const smallVP: ViewportSize = { width: 1024, height: 768 };
    const mgr2 = new WindowManager();
    mgr2.viewport = smallVP;
    const h2 = mgr2.open({ title: "Sheet", singletonKey: "persist:clamp" });
    const w = mgr2.windows.get(h2.id)!;

    // top must be within viewport
    expect(w.top).toBeLessThanOrEqual(smallVP.height - 40);
    // left must allow at least 40px margin on screen
    expect(w.left).toBeLessThanOrEqual(smallVP.width - 40);
  });

  it("geometry persisted by close() is used on reopen", () => {
    localStorageMock.clear();
    const mgr1 = new WindowManager();
    mgr1.viewport = VP;

    const h = mgr1.open({ title: "Sheet", singletonKey: "persist:close" });
    mgr1.setPosition(h.id, { top: 50, left: 80 });
    mgr1.close(h.id); // close should also persist

    const mgr2 = new WindowManager();
    mgr2.viewport = VP;
    const h2 = mgr2.open({ title: "Sheet", singletonKey: "persist:close" });
    expect(mgr2.windows.get(h2.id)!.top).toBe(50);
    expect(mgr2.windows.get(h2.id)!.left).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Viewport resize
// ---------------------------------------------------------------------------

describe("onViewportResize", () => {
  it("re-clamps all windows when viewport shrinks", () => {
    const mgr = freshManager();
    mgr.open({ title: "A" });
    mgr.setPosition(mgr.windows.keys().next().value as string, { top: 700, left: 1100 });

    const smallVP = { width: 800, height: 600 };
    mgr.onViewportResize(smallVP);

    for (const w of mgr.windows.values()) {
      expect(w.top).toBeLessThanOrEqual(smallVP.height - 40);
      expect(w.left).toBeLessThanOrEqual(smallVP.width - 40);
    }
  });

  it("updates stored viewport size", () => {
    const mgr = freshManager();
    const newVP = { width: 800, height: 600 };
    mgr.onViewportResize(newVP);
    expect(mgr.viewport).toEqual(newVP);
  });
});

// ---------------------------------------------------------------------------
// Handle API
// ---------------------------------------------------------------------------

describe("WindowHandle", () => {
  it("bringToFront() makes the window the active one", () => {
    const mgr = freshManager();
    const ha = mgr.open({ title: "A" });
    mgr.open({ title: "B" }); // B is now active
    ha.bringToFront();
    expect(mgr.activeWindowId).toBe(ha.id);
  });

  it("close() removes the window", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A" });
    h.close();
    expect(mgr.windows.has(h.id)).toBe(false);
  });

  it("get() returns undefined for closed window", () => {
    const mgr = freshManager();
    const h = mgr.open({ title: "A" });
    h.close();
    expect(mgr.get(h.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cascade: new windows without position fall at incremental offsets
// ---------------------------------------------------------------------------

describe("Cascade positioning", () => {
  it("6 windows without explicit positions have different top/left values", () => {
    const mgr = freshManager();
    const positions = Array.from({ length: 6 }, () => {
      const h = mgr.open({ title: "W" });
      const e = mgr.windows.get(h.id)!;
      return { top: e.top, left: e.left };
    });

    const unique = new Set(positions.map((p) => `${p.top}:${p.left}`));
    expect(unique.size).toBe(6);
  });
});
