/**
 * Tests for the typed hook bus:
 *   - on / once / off
 *   - emit: call order, isolation of errors, cancellation (pre hooks)
 *   - listenerCount
 *
 * REQ-SYS-060 / REQ-SYS-066.
 */
import { describe, it, expect, vi } from "vitest";
import { HookBus } from "../hooks.js";

// ---------------------------------------------------------------------------
// Basic registration
// ---------------------------------------------------------------------------

describe("HookBus — registration", () => {
  it("on() returns a HookRef with name and _id", () => {
    const bus = new HookBus();
    const ref = bus.on("create", vi.fn());
    expect(ref.name).toBe("create");
    expect(typeof ref._id).toBe("number");
  });

  it("once() returns a HookRef", () => {
    const bus = new HookBus();
    const ref = bus.once("create", vi.fn());
    expect(ref.name).toBe("create");
    expect(typeof ref._id).toBe("number");
  });

  it("listenerCount returns 0 for unregistered hook", () => {
    const bus = new HookBus();
    expect(bus.listenerCount("create")).toBe(0);
  });

  it("listenerCount increments with on()", () => {
    const bus = new HookBus();
    bus.on("create", vi.fn());
    bus.on("create", vi.fn());
    expect(bus.listenerCount("create")).toBe(2);
  });

  it("off() removes a listener", () => {
    const bus = new HookBus();
    const ref = bus.on("create", vi.fn());
    expect(bus.listenerCount("create")).toBe(1);
    bus.off(ref);
    expect(bus.listenerCount("create")).toBe(0);
  });

  it("off() is a no-op for unknown ref", () => {
    const bus = new HookBus();
    expect(() => bus.off({ name: "create", _id: 9999 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// emit — invocation order
// ---------------------------------------------------------------------------

describe("HookBus — emit order", () => {
  it("calls listeners in registration order", () => {
    const bus = new HookBus();
    const calls: number[] = [];

    bus.on("create", () => {
      calls.push(1);
    });
    bus.on("create", () => {
      calls.push(2);
    });
    bus.on("create", () => {
      calls.push(3);
    });

    bus.emit("create", {}, {}, "user1");
    expect(calls).toEqual([1, 2, 3]);
  });

  it("emit returns true when all listeners complete normally", () => {
    const bus = new HookBus();
    bus.on("create", vi.fn());
    expect(bus.emit("create", {}, {}, "user1")).toBe(true);
  });

  it("emit returns true when no listeners are registered", () => {
    const bus = new HookBus();
    expect(bus.emit("create", {}, {}, "user1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// once — single invocation
// ---------------------------------------------------------------------------

describe("HookBus — once()", () => {
  it("once listener is called only on first emit", () => {
    const bus = new HookBus();
    const fn = vi.fn();
    bus.once("create", fn);

    bus.emit("create", {}, {}, "user1");
    bus.emit("create", {}, {}, "user2");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("create")).toBe(0);
  });

  it("multiple once listeners each fire exactly once", () => {
    const bus = new HookBus();
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    bus.once("create", fn1);
    bus.once("create", fn2);

    bus.emit("create", {}, {}, "u");
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    bus.emit("create", {}, {}, "u");
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error isolation — REQ-SYS-066
// ---------------------------------------------------------------------------

describe("HookBus — error isolation (REQ-SYS-066)", () => {
  it("error in one listener does not prevent subsequent listeners from running", () => {
    const bus = new HookBus();
    const calls: string[] = [];

    bus.on("create", () => {
      throw new Error("first listener explodes");
    });
    bus.on("create", () => {
      calls.push("second");
    });
    bus.on("create", () => {
      calls.push("third");
    });

    // Must not throw
    expect(() => bus.emit("create", {}, {}, "u")).not.toThrow();
    expect(calls).toEqual(["second", "third"]);
  });

  it("emit still returns true when a listener throws (no cancellation)", () => {
    const bus = new HookBus();
    bus.on("create", () => {
      throw new Error("boom");
    });
    expect(bus.emit("create", {}, {}, "u")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cancellation via pre* hooks — REQ-SYS-061 (pre hooks return false to cancel)
// ---------------------------------------------------------------------------

describe("HookBus — pre* hook cancellation", () => {
  it("preCreate returning false causes emit to return false", () => {
    const bus = new HookBus();
    bus.on("preCreate", () => false);

    const result = bus.emit("preCreate", {}, {}, {}, "u");
    expect(result).toBe(false);
  });

  it("cancellation stops subsequent listeners from running", () => {
    const bus = new HookBus();
    const calls: string[] = [];

    bus.on("preCreate", () => {
      calls.push("first");
      return false;
    });
    bus.on("preCreate", () => {
      calls.push("second");
    });

    bus.emit("preCreate", {}, {}, {}, "u");
    expect(calls).toEqual(["first"]);
  });

  it("preCreate returning undefined (void) does not cancel", () => {
    const bus = new HookBus();
    bus.on("preCreate", () => {
      /* no return */
    });
    expect(bus.emit("preCreate", {}, {}, {}, "u")).toBe(true);
  });

  it("preCreate returning true does not cancel", () => {
    const bus = new HookBus();
    // Return type is `boolean | void`; returning true is treated as non-cancellation
    bus.on("preCreate", () => true as unknown as void);
    expect(bus.emit("preCreate", {}, {}, {}, "u")).toBe(true);
  });

  it("preUpdate: second listener cancels, first already ran", () => {
    const bus = new HookBus();
    const calls: string[] = [];

    bus.on("preUpdate", () => {
      calls.push("a");
    });
    bus.on("preUpdate", () => {
      calls.push("b");
      return false;
    });
    bus.on("preUpdate", () => {
      calls.push("c");
    });

    const result = bus.emit("preUpdate", {}, {}, {}, "u");
    expect(result).toBe(false);
    expect(calls).toEqual(["a", "b"]);
    expect(calls).not.toContain("c");
  });
});

// ---------------------------------------------------------------------------
// Combat hooks — REQ-SYS-062
// ---------------------------------------------------------------------------

describe("HookBus — combat hooks", () => {
  it("combatStart emits correctly", () => {
    const bus = new HookBus();
    const fn = vi.fn();
    bus.on("combatStart", fn);
    bus.emit("combatStart", { id: "combat-1" });
    expect(fn).toHaveBeenCalledWith({ id: "combat-1" });
  });

  it("roundStart / roundEnd pass round number", () => {
    const bus = new HookBus();
    const startFn = vi.fn();
    const endFn = vi.fn();

    bus.on("roundStart", startFn);
    bus.on("roundEnd", endFn);

    bus.emit("roundStart", { id: "c" }, 2);
    bus.emit("roundEnd", { id: "c" }, 2);

    expect(startFn).toHaveBeenCalledWith({ id: "c" }, 2);
    expect(endFn).toHaveBeenCalledWith({ id: "c" }, 2);
  });

  it("turnStart / turnEnd pass combatant", () => {
    const bus = new HookBus();
    const turnStartFn = vi.fn();
    const turnEndFn = vi.fn();

    bus.on("turnStart", turnStartFn);
    bus.on("turnEnd", turnEndFn);

    const combat = { id: "c" };
    const combatant = { id: "cbt-1" };
    const prev = { round: 1, turn: 2 };

    bus.emit("turnStart", combat, combatant, prev);
    bus.emit("turnEnd", combat, combatant);

    expect(turnStartFn).toHaveBeenCalledWith(combat, combatant, prev);
    expect(turnEndFn).toHaveBeenCalledWith(combat, combatant);
  });
});

// ---------------------------------------------------------------------------
// preRoll cancellation — REQ-SYS-063
// ---------------------------------------------------------------------------

describe("HookBus — preRoll", () => {
  it("preRoll can cancel by returning false", () => {
    const bus = new HookBus();
    bus.on("preRoll", () => false);
    expect(bus.emit("preRoll", { formula: "1d20" })).toBe(false);
  });

  it("postRoll fires after roll", () => {
    const bus = new HookBus();
    const fn = vi.fn();
    bus.on("postRoll", fn);
    bus.emit("postRoll", { total: 15 }, { formula: "1d20" });
    expect(fn).toHaveBeenCalledWith({ total: 15 }, { formula: "1d20" });
  });
});
