import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  EnvelopeSchema,
  DocUpdatePayloadSchema,
  DocCreatePayloadSchema,
  DocDeletePayloadSchema,
  TokenMovePayloadSchema,
  ProtocolHandshakeSchema,
} from "../protocol.js";

describe("PROTOCOL_VERSION", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("EnvelopeSchema", () => {
  it("accepts a valid envelope", () => {
    const result = EnvelopeSchema.safeParse({
      type: "doc:update",
      ts: Date.now(),
      payload: { foo: "bar" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an envelope with requestId and seq", () => {
    const result = EnvelopeSchema.safeParse({
      type: "doc:create",
      requestId: "01HWSOMEULIDSTRING123456",
      seq: 42,
      ts: 1000000,
      payload: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an envelope with unknown type", () => {
    const result = EnvelopeSchema.safeParse({
      type: "unknown:action",
      ts: Date.now(),
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects an envelope missing ts", () => {
    const result = EnvelopeSchema.safeParse({
      type: "doc:update",
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("DocUpdatePayloadSchema", () => {
  it("accepts a valid update payload", () => {
    const result = DocUpdatePayloadSchema.safeParse({
      documentType: "Actor",
      updates: [
        {
          _id: "abc1234567890123",
          diff: { "system.attributes.hp.value": 10 },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts update with expectedVersion", () => {
    const result = DocUpdatePayloadSchema.safeParse({
      documentType: "Item",
      updates: [
        {
          _id: "xyz1234567890123",
          diff: { name: "Sword" },
          expectedVersion: 5,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("DocCreatePayloadSchema", () => {
  it("accepts a valid create payload", () => {
    const result = DocCreatePayloadSchema.safeParse({
      documentType: "Actor",
      data: [{ name: "Hero", type: "character" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("DocDeletePayloadSchema", () => {
  it("accepts a valid delete payload", () => {
    const result = DocDeletePayloadSchema.safeParse({
      documentType: "Actor",
      ids: ["abc1234567890123"],
    });
    expect(result.success).toBe(true);
  });
});

describe("TokenMovePayloadSchema", () => {
  it("accepts a valid token move payload", () => {
    const result = TokenMovePayloadSchema.safeParse({
      sceneId: "scene123456789012",
      tokenId: "token123456789012",
      x: 100,
      y: 200,
    });
    expect(result.success).toBe(true);
  });

  it("accepts with optional fields", () => {
    const result = TokenMovePayloadSchema.safeParse({
      sceneId: "scene123456789012",
      tokenId: "token123456789012",
      x: 100,
      y: 200,
      rotation: 45,
      optimistic: { x: 95, y: 195 },
    });
    expect(result.success).toBe(true);
  });
});

describe("ProtocolHandshakeSchema", () => {
  it("accepts a valid handshake", () => {
    const result = ProtocolHandshakeSchema.safeParse({
      protocolVersion: 1,
      engineVersion: "0.1.0",
    });
    expect(result.success).toBe(true);
  });

  it("rejects wrong protocol version", () => {
    const result = ProtocolHandshakeSchema.safeParse({
      protocolVersion: 2,
      engineVersion: "0.1.0",
    });
    expect(result.success).toBe(false);
  });
});
