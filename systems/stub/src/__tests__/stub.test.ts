import { describe, it, expect, beforeEach } from "vitest";
import { stubSystem, DummyActorSchema } from "../index.js";
import { SystemRegistry, validateSystemModule } from "@fusion/system-api";

describe("stub system module", () => {
  it("has the correct manifest id", () => {
    expect(stubSystem.manifest.id).toBe("stub");
  });

  it("has a registered model for Actor:dummy", () => {
    expect(stubSystem.models.has("Actor:dummy")).toBe(true);
  });

  it("passes the contract test", () => {
    const report = validateSystemModule(stubSystem);
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

describe("DummyActorSchema", () => {
  it("accepts valid data with default", () => {
    const result = DummyActorSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dummyValue).toBe(0);
    }
  });

  it("accepts valid data with explicit value", () => {
    const result = DummyActorSchema.safeParse({ dummyValue: 42, label: "hero" });
    expect(result.success).toBe(true);
  });

  it("rejects negative dummyValue", () => {
    const result = DummyActorSchema.safeParse({ dummyValue: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer dummyValue", () => {
    const result = DummyActorSchema.safeParse({ dummyValue: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("SystemRegistry with stub", () => {
  let registry: SystemRegistry;

  beforeEach(() => {
    registry = new SystemRegistry();
  });

  it("registers the stub system successfully", () => {
    registry.register(stubSystem);
    expect(registry.has("stub")).toBe(true);
  });

  it("retrieves the stub system by id", () => {
    registry.register(stubSystem);
    const retrieved = registry.get("stub");
    expect(retrieved.manifest.id).toBe("stub");
  });

  it("throws on duplicate registration", () => {
    registry.register(stubSystem);
    expect(() => registry.register(stubSystem)).toThrow(/already registered/);
  });
});
