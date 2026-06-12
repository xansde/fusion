/**
 * Tests for BaseDocument types and helpers.
 *
 * REQ-DOC-007, REQ-DOC-008, REQ-DOC-009, REQ-DOC-027, REQ-DOC-028, REQ-DOC-030.
 */

import { describe, it, expect } from "vitest";
import {
  BaseDocumentSchema,
  DocumentStatsSchema,
  OwnershipSchema,
  OwnershipLevel,
  FlagsSchema,
  defaultOwnership,
  defaultStats,
  getUserLevel,
  testUserLevel,
  DOCUMENT_TABLES,
} from "../document.js";

describe("OwnershipLevel", () => {
  it("has correct numeric values", () => {
    expect(OwnershipLevel.INHERIT).toBe(-1);
    expect(OwnershipLevel.NONE).toBe(0);
    expect(OwnershipLevel.LIMITED).toBe(1);
    expect(OwnershipLevel.OBSERVER).toBe(2);
    expect(OwnershipLevel.OWNER).toBe(3);
  });
});

describe("OwnershipSchema", () => {
  it("accepts valid ownership map with 'default' key", () => {
    const result = OwnershipSchema.safeParse({
      default: OwnershipLevel.NONE,
      user123: OwnershipLevel.OWNER,
    });
    expect(result.success).toBe(true);
  });

  it("rejects ownership map without 'default' key", () => {
    const result = OwnershipSchema.safeParse({
      user123: OwnershipLevel.OWNER,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid level values", () => {
    const result = OwnershipSchema.safeParse({ default: 99 });
    expect(result.success).toBe(false);
  });
});

describe("DocumentStatsSchema", () => {
  it("accepts valid stats", () => {
    const stats = defaultStats("0.1.0");
    const result = DocumentStatsSchema.safeParse(stats);
    expect(result.success).toBe(true);
  });

  it("rejects negative timestamps", () => {
    const stats = { ...defaultStats(), createdTime: -1 };
    const result = DocumentStatsSchema.safeParse(stats);
    expect(result.success).toBe(false);
  });
});

describe("FlagsSchema", () => {
  it("accepts a valid flags object", () => {
    const result = FlagsSchema.safeParse({
      core: { someKey: "value" },
      world: { anotherKey: 42 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty flags object", () => {
    const result = FlagsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("BaseDocumentSchema", () => {
  const validDoc = {
    _id: "A".repeat(16),
    _stats: defaultStats("0.1.0"),
    name: "Test Actor",
    sort: 0,
    ownership: defaultOwnership(),
    flags: {},
  };

  it("accepts a minimal valid document", () => {
    const result = BaseDocumentSchema.safeParse(validDoc);
    expect(result.success).toBe(true);
  });

  it("rejects _id with wrong length", () => {
    const result = BaseDocumentSchema.safeParse({ ...validDoc, _id: "tooshort" });
    expect(result.success).toBe(false);
  });

  it("rejects _id with invalid characters", () => {
    const result = BaseDocumentSchema.safeParse({ ...validDoc, _id: "A".repeat(15) + "-" });
    expect(result.success).toBe(false);
  });

  it("applies default ownership when omitted", () => {
    const { ownership: _, ...withoutOwnership } = validDoc;
    const result = BaseDocumentSchema.safeParse(withoutOwnership);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ownership["default"]).toBe(OwnershipLevel.NONE);
    }
  });

  it("applies default flags when omitted", () => {
    const { flags: _, ...withoutFlags } = validDoc;
    const result = BaseDocumentSchema.safeParse(withoutFlags);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flags).toEqual({});
    }
  });

  it("applies default sort = 0 when omitted", () => {
    const { sort: _, ...withoutSort } = validDoc;
    const result = BaseDocumentSchema.safeParse(withoutSort);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe(0);
    }
  });

  it("accepts optional fields: type, folder, system", () => {
    const result = BaseDocumentSchema.safeParse({
      ...validDoc,
      type: "character",
      folder: "folderIdABCDEFGH",
      system: { hp: 10, maxHp: 20 },
    });
    expect(result.success).toBe(true);
  });
});

describe("getUserLevel", () => {
  it("returns OWNER for explicit user entry", () => {
    const ownership = { default: OwnershipLevel.NONE, user1: OwnershipLevel.OWNER };
    expect(getUserLevel(ownership, "user1")).toBe(OwnershipLevel.OWNER);
  });

  it("falls back to default for unlisted user", () => {
    const ownership = { default: OwnershipLevel.LIMITED };
    expect(getUserLevel(ownership, "user_unknown")).toBe(OwnershipLevel.LIMITED);
  });

  it("returns NONE for null userId", () => {
    const ownership = { default: OwnershipLevel.OWNER };
    expect(getUserLevel(ownership, null)).toBe(OwnershipLevel.NONE);
  });

  it("returns NONE for undefined userId", () => {
    const ownership = { default: OwnershipLevel.OWNER };
    expect(getUserLevel(ownership, undefined)).toBe(OwnershipLevel.NONE);
  });

  it("uses default when explicit entry is INHERIT", () => {
    const ownership = {
      default: OwnershipLevel.OBSERVER,
      user1: OwnershipLevel.INHERIT,
    };
    expect(getUserLevel(ownership, "user1")).toBe(OwnershipLevel.OBSERVER);
  });
});

describe("testUserLevel", () => {
  it("returns true when user level >= minimum", () => {
    const ownership = { default: OwnershipLevel.NONE, user1: OwnershipLevel.OWNER };
    expect(testUserLevel(ownership, "user1", OwnershipLevel.OBSERVER)).toBe(true);
  });

  it("returns false when user level < minimum", () => {
    const ownership = { default: OwnershipLevel.LIMITED };
    expect(testUserLevel(ownership, "user_x", OwnershipLevel.OWNER)).toBe(false);
  });
});

describe("DOCUMENT_TABLES", () => {
  it("contains all expected table names", () => {
    const expected = [
      "actors",
      "items",
      "scenes",
      "journal_entries",
      "macros",
      "roll_tables",
      "playlists",
      "chat_messages",
      "combats",
      "users",
      "folders",
      "settings",
    ];
    for (const table of expected) {
      expect(DOCUMENT_TABLES.has(table as never)).toBe(true);
    }
  });
});

describe("defaultOwnership", () => {
  it("has default: NONE", () => {
    const o = defaultOwnership();
    expect(o["default"]).toBe(OwnershipLevel.NONE);
  });
});

describe("defaultStats", () => {
  it("sets engineSchemaVersion to 1", () => {
    const s = defaultStats();
    expect(s.engineSchemaVersion).toBe(1);
  });

  it("sets createdTime and modifiedTime to approximately now", () => {
    const before = Date.now();
    const s = defaultStats();
    const after = Date.now();
    expect(s.createdTime).toBeGreaterThanOrEqual(before);
    expect(s.createdTime).toBeLessThanOrEqual(after);
  });
});
