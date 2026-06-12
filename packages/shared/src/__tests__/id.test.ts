import { describe, it, expect } from "vitest";
import {
  createDocumentId,
  isValidDocumentId,
  assertDocumentId,
  DOCUMENT_ID_LENGTH,
  DOCUMENT_ID_ALPHABET,
} from "../id.js";

describe("createDocumentId", () => {
  it("generates a string of exactly 16 characters", () => {
    const id = createDocumentId();
    expect(id).toHaveLength(DOCUMENT_ID_LENGTH);
  });

  it("uses only characters from [A-Za-z0-9]", () => {
    for (let i = 0; i < 100; i++) {
      const id = createDocumentId();
      expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
    }
  });

  it("generates unique IDs across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createDocumentId()));
    // With 95 bits of entropy, collisions in 1000 are essentially impossible
    expect(ids.size).toBe(1000);
  });

  it("alphabet contains exactly 62 characters", () => {
    expect(DOCUMENT_ID_ALPHABET).toHaveLength(62);
    // All uppercase letters
    expect(DOCUMENT_ID_ALPHABET).toContain("A");
    expect(DOCUMENT_ID_ALPHABET).toContain("Z");
    // All lowercase letters
    expect(DOCUMENT_ID_ALPHABET).toContain("a");
    expect(DOCUMENT_ID_ALPHABET).toContain("z");
    // Digits
    expect(DOCUMENT_ID_ALPHABET).toContain("0");
    expect(DOCUMENT_ID_ALPHABET).toContain("9");
  });
});

describe("isValidDocumentId", () => {
  it("accepts valid 16-char alphanumeric IDs", () => {
    expect(isValidDocumentId("abcdefghijklmnop")).toBe(true);
    expect(isValidDocumentId("ABCDEFGHIJKLMNOP")).toBe(true);
    expect(isValidDocumentId("1234567890123456")).toBe(true);
    expect(isValidDocumentId("aBcDeF0123456789")).toBe(true);
  });

  it("rejects IDs that are too short", () => {
    expect(isValidDocumentId("abc")).toBe(false);
    expect(isValidDocumentId("")).toBe(false);
  });

  it("rejects IDs that are too long", () => {
    expect(isValidDocumentId("abcdefghijklmnopq")).toBe(false);
  });

  it("rejects IDs with invalid characters", () => {
    expect(isValidDocumentId("abcdefghijklmno-")).toBe(false);
    expect(isValidDocumentId("abcdefghijklmno_")).toBe(false);
    expect(isValidDocumentId("abcdefghijklmno ")).toBe(false);
  });

  it("type-guards correctly", () => {
    const id = "aBcDeF0123456789";
    if (isValidDocumentId(id)) {
      // TypeScript should narrow to DocumentId here — just verify runtime
      expect(typeof id).toBe("string");
    }
  });
});

describe("assertDocumentId", () => {
  it("returns the id if valid", () => {
    const id = assertDocumentId("aBcDeF0123456789");
    expect(id).toBe("aBcDeF0123456789");
  });

  it("throws on invalid id", () => {
    expect(() => assertDocumentId("short")).toThrow(/Invalid DocumentId/);
    expect(() => assertDocumentId("abcdefghijklmno-")).toThrow(/Invalid DocumentId/);
  });
});
