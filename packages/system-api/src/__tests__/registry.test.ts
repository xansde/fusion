import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { defineSystem } from "../system-module.js";
import { SystemRegistry, DuplicateSystemIdError, SystemNotFoundError } from "../registry.js";

function makeModule(id: string) {
  return defineSystem(
    {
      id,
      title: id,
      version: "0.1.0",
      engineCompat: ">=0.1.0",
      authors: [{ name: "Test" }],
      documentTypes: { Actor: ["dummy"] },
      languages: [],
    },
    (r) => {
      r.defineModel({ documentType: "Actor", subtype: "dummy", schema: z.object({}) });
    },
  );
}

describe("SystemRegistry", () => {
  let registry: SystemRegistry;

  beforeEach(() => {
    registry = new SystemRegistry();
  });

  it("registers and retrieves a system", () => {
    const module = makeModule("pf2e");
    registry.register(module);
    const retrieved = registry.get("pf2e");
    expect(retrieved.manifest.id).toBe("pf2e");
  });

  it("throws DuplicateSystemIdError on duplicate registration", () => {
    registry.register(makeModule("pf2e"));
    expect(() => registry.register(makeModule("pf2e"))).toThrow(DuplicateSystemIdError);
  });

  it("throws SystemNotFoundError when getting unregistered system", () => {
    expect(() => registry.get("missing")).toThrow(SystemNotFoundError);
  });

  it("tryGet returns undefined for unregistered system", () => {
    expect(registry.tryGet("missing")).toBeUndefined();
  });

  it("tryGet returns the module if registered", () => {
    registry.register(makeModule("sf2e"));
    expect(registry.tryGet("sf2e")).toBeDefined();
  });

  it("list returns all registered system IDs", () => {
    registry.register(makeModule("pf2e"));
    registry.register(makeModule("sf2e"));
    const list = registry.list();
    expect(list).toContain("pf2e");
    expect(list).toContain("sf2e");
    expect(list).toHaveLength(2);
  });

  it("has returns true for registered, false for unregistered", () => {
    registry.register(makeModule("fake-system"));
    expect(registry.has("fake-system")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
  });

  it("size reflects the number of registered systems", () => {
    expect(registry.size).toBe(0);
    registry.register(makeModule("pf2e"));
    expect(registry.size).toBe(1);
    registry.register(makeModule("sf2e"));
    expect(registry.size).toBe(2);
  });
});
