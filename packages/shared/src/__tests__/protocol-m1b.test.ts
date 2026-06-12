/**
 * Protocol M1-B tests — world sync payloads and Ack with requestId.
 *
 * REQ-NET-011: Ack must echo requestId.
 * REQ-NET-062..063: resync request, delta, full snapshot.
 * M1-B: world:snapshot, world:resync, world:activeScene.
 */

import { describe, it, expect } from "vitest";
import {
  EnvelopeSchema,
  WorldSnapshotPayloadSchema,
  WorldResyncRequestPayloadSchema,
  ResyncDeltaPayloadSchema,
  ResyncFullPayloadSchema,
  WorldActiveScenePayloadSchema,
  type Ack,
} from "../protocol.js";

// ---------------------------------------------------------------------------
// Ack type — REQ-NET-011: requestId must be present in ack
// ---------------------------------------------------------------------------

describe("Ack type — requestId (REQ-NET-011)", () => {
  it("success ack accepts requestId field", () => {
    const ack: Ack<{ docId: string }> = {
      ok: true,
      requestId: "01HWSOMEULIDSTR0000000001",
      seq: 42,
      result: { docId: "A".repeat(16) },
    };
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.requestId).toBe("01HWSOMEULIDSTR0000000001");
      expect(ack.seq).toBe(42);
    }
  });

  it("error ack accepts requestId field", () => {
    const ack: Ack<never> = {
      ok: false,
      requestId: "01HWSOMEULIDSTR0000000002",
      code: "PERMISSION_DENIED",
      message: "You do not have permission to update this document.",
    };
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.requestId).toBe("01HWSOMEULIDSTR0000000002");
      expect(ack.code).toBe("PERMISSION_DENIED");
    }
  });

  it("ack works without requestId (backward compatible)", () => {
    const ack: Ack<string> = {
      ok: true,
      result: "done",
    };
    expect(ack.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EnvelopeTypeSchema — M1-B additions
// ---------------------------------------------------------------------------

describe("EnvelopeTypeSchema — M1-B additions", () => {
  it("accepts world:snapshot as envelope type", () => {
    const r = EnvelopeSchema.safeParse({
      type: "world:snapshot",
      ts: Date.now(),
      payload: {},
    });
    expect(r.success).toBe(true);
  });

  it("accepts world:activeScene as envelope type", () => {
    const r = EnvelopeSchema.safeParse({
      type: "world:activeScene",
      ts: Date.now(),
      payload: { sceneId: "A".repeat(16) },
    });
    expect(r.success).toBe(true);
  });

  it("still accepts doc:update", () => {
    const r = EnvelopeSchema.safeParse({
      type: "doc:update",
      requestId: "01HWSOMEULIDSTR0000000003",
      ts: Date.now(),
      payload: {},
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WorldSnapshotPayloadSchema
// ---------------------------------------------------------------------------

describe("WorldSnapshotPayloadSchema", () => {
  it("accepts a minimal snapshot with no documents", () => {
    const r = WorldSnapshotPayloadSchema.safeParse({
      seq: 0,
      activeSceneId: null,
      documents: {},
    });
    expect(r.success).toBe(true);
  });

  it("accepts a snapshot with documents and active scene", () => {
    const r = WorldSnapshotPayloadSchema.safeParse({
      seq: 57,
      activeSceneId: "A".repeat(16),
      documents: {
        Scene: [
          {
            _id: "A".repeat(16),
            name: "Forest",
            active: true,
          },
        ],
        Actor: [],
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.seq).toBe(57);
      expect(r.data.activeSceneId).toBe("A".repeat(16));
      expect(r.data.documents["Scene"]).toHaveLength(1);
    }
  });

  it("rejects negative seq", () => {
    const r = WorldSnapshotPayloadSchema.safeParse({
      seq: -1,
      activeSceneId: null,
      documents: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing seq", () => {
    const r = WorldSnapshotPayloadSchema.safeParse({
      activeSceneId: null,
      documents: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing activeSceneId key", () => {
    const r = WorldSnapshotPayloadSchema.safeParse({
      seq: 0,
      documents: {},
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorldResyncRequestPayloadSchema
// ---------------------------------------------------------------------------

describe("WorldResyncRequestPayloadSchema", () => {
  it("accepts a valid resync request", () => {
    const r = WorldResyncRequestPayloadSchema.safeParse({ lastSeq: 999 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lastSeq).toBe(999);
  });

  it("accepts lastSeq === 0 (fresh client)", () => {
    const r = WorldResyncRequestPayloadSchema.safeParse({ lastSeq: 0 });
    expect(r.success).toBe(true);
  });

  it("rejects negative lastSeq", () => {
    const r = WorldResyncRequestPayloadSchema.safeParse({ lastSeq: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects missing lastSeq", () => {
    const r = WorldResyncRequestPayloadSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ResyncDeltaPayloadSchema
// ---------------------------------------------------------------------------

describe("ResyncDeltaPayloadSchema", () => {
  it("accepts an empty delta (no ops)", () => {
    const r = ResyncDeltaPayloadSchema.safeParse({
      fromSeq: 10,
      toSeq: 10,
      ops: [],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a delta with ops", () => {
    const op = {
      type: "doc:update",
      requestId: "01HWSOMEULIDSTR0000000004",
      seq: 11,
      ts: Date.now(),
      payload: {
        documentType: "Actor",
        updates: [{ _id: "A".repeat(16), diff: { name: "Gandalf" } }],
      },
    };
    const r = ResyncDeltaPayloadSchema.safeParse({
      fromSeq: 10,
      toSeq: 11,
      ops: [op],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ops).toHaveLength(1);
      expect(r.data.fromSeq).toBe(10);
    }
  });

  it("rejects missing fromSeq", () => {
    const r = ResyncDeltaPayloadSchema.safeParse({ toSeq: 10, ops: [] });
    expect(r.success).toBe(false);
  });

  it("rejects ops that are not valid envelopes", () => {
    const r = ResyncDeltaPayloadSchema.safeParse({
      fromSeq: 10,
      toSeq: 11,
      ops: [{ notAnEnvelope: true }],
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ResyncFullPayloadSchema
// ---------------------------------------------------------------------------

describe("ResyncFullPayloadSchema", () => {
  it("accepts a resync full with inline snapshot", () => {
    const r = ResyncFullPayloadSchema.safeParse({
      reason: "lastSeq not in buffer",
      snapshot: {
        seq: 1500,
        activeSceneId: null,
        documents: {},
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.reason).toBe("lastSeq not in buffer");
      expect(r.data.snapshot?.seq).toBe(1500);
    }
  });

  it("accepts a resync full with null snapshot (client re-joins)", () => {
    const r = ResyncFullPayloadSchema.safeParse({
      snapshot: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.snapshot).toBeNull();
  });

  it("accepts without optional reason", () => {
    const r = ResyncFullPayloadSchema.safeParse({
      snapshot: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing snapshot key", () => {
    const r = ResyncFullPayloadSchema.safeParse({
      reason: "some reason",
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorldActiveScenePayloadSchema
// ---------------------------------------------------------------------------

describe("WorldActiveScenePayloadSchema", () => {
  it("accepts a valid sceneId", () => {
    const r = WorldActiveScenePayloadSchema.safeParse({
      sceneId: "A".repeat(16),
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sceneId).toBe("A".repeat(16));
  });

  it("accepts null sceneId (all scenes deactivated)", () => {
    const r = WorldActiveScenePayloadSchema.safeParse({ sceneId: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sceneId).toBeNull();
  });

  it("rejects missing sceneId", () => {
    const r = WorldActiveScenePayloadSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

// Note: EmbeddedAddressSchema tests were removed in M1-B (FIX-6) together with
// the schema itself — it was dead code that was never wired into the payload
// schemas. See the comment in protocol.ts for context.
