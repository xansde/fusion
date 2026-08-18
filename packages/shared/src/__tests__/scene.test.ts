/**
 * Tests for SceneDocument and TokenDocument schemas (M1-B).
 *
 * Covers:
 *  - TokenDocument: valid/invalid shapes, defaults, diff helpers
 *  - SceneDocument: valid/invalid shapes, embedded tokens, defaults
 *  - GridConfigSchema: valid/invalid, hex options, min size
 *  - tokenDiffPath / buildTokenMoveDiff helpers
 *  - Ack type includes requestId (REQ-NET-011)
 */

import { describe, it, expect } from "vitest";
import {
  TokenDocumentSchema,
  SceneDocumentSchema,
  GridConfigSchema,
  InitialViewSchema,
  DispositionSchema,
  TokenBarConfigSchema,
  defaultTokenDocument,
  defaultSceneDocument,
  tokenDiffPath,
  buildTokenMoveDiff,
} from "../scene.js";
import { defaultStats } from "../document.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validId(): string {
  return "A".repeat(16);
}

function validStats() {
  return defaultStats("0.1.0");
}

// ---------------------------------------------------------------------------
// DispositionSchema
// ---------------------------------------------------------------------------

describe("DispositionSchema", () => {
  it("accepts -1, 0, 1", () => {
    expect(DispositionSchema.safeParse(-1).success).toBe(true);
    expect(DispositionSchema.safeParse(0).success).toBe(true);
    expect(DispositionSchema.safeParse(1).success).toBe(true);
  });

  it("rejects values outside the enum", () => {
    expect(DispositionSchema.safeParse(2).success).toBe(false);
    expect(DispositionSchema.safeParse(-2).success).toBe(false);
    expect(DispositionSchema.safeParse(0.5).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TokenBarConfigSchema
// ---------------------------------------------------------------------------

describe("TokenBarConfigSchema", () => {
  it("accepts attribute string", () => {
    const r = TokenBarConfigSchema.safeParse({ attribute: "attributes.hp" });
    expect(r.success).toBe(true);
  });

  it("accepts null attribute", () => {
    const r = TokenBarConfigSchema.safeParse({ attribute: null });
    expect(r.success).toBe(true);
  });

  it("defaults attribute to null when omitted", () => {
    const r = TokenBarConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.attribute).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GridConfigSchema
// ---------------------------------------------------------------------------

describe("GridConfigSchema", () => {
  it("accepts a minimal square grid", () => {
    const r = GridConfigSchema.safeParse({
      type: "square",
      size: 100,
      distance: 5,
      units: "ft",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a hex grid with orientation", () => {
    const r = GridConfigSchema.safeParse({
      type: "hex",
      size: 100,
      distance: 5,
      units: "ft",
      hex: { orientation: "pointy", parity: "odd" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a gridless configuration", () => {
    const r = GridConfigSchema.safeParse({
      type: "gridless",
      size: 100,
      distance: 1,
      units: "m",
    });
    expect(r.success).toBe(true);
  });

  it("rejects size below minimum (50)", () => {
    const r = GridConfigSchema.safeParse({
      type: "square",
      size: 49,
      distance: 5,
      units: "ft",
    });
    expect(r.success).toBe(false);
  });

  it("accepts size exactly at minimum (50)", () => {
    const r = GridConfigSchema.safeParse({
      type: "square",
      size: 50,
      distance: 5,
      units: "ft",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown grid type", () => {
    const r = GridConfigSchema.safeParse({
      type: "isometric",
      size: 100,
      distance: 5,
      units: "ft",
    });
    expect(r.success).toBe(false);
  });

  it("applies default color and alpha when omitted", () => {
    const r = GridConfigSchema.safeParse({
      type: "square",
      size: 100,
      distance: 5,
      units: "ft",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.color).toBe("#000000");
      expect(r.data.alpha).toBe(1);
    }
  });

  it("accepts diagonal rule for square grid", () => {
    const r = GridConfigSchema.safeParse({
      type: "square",
      size: 100,
      distance: 5,
      units: "ft",
      diagonalRule: "alternating_1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid diagonal rule", () => {
    const r = GridConfigSchema.safeParse({
      type: "square",
      size: 100,
      distance: 5,
      units: "ft",
      diagonalRule: "zigzag",
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InitialViewSchema
// ---------------------------------------------------------------------------

describe("InitialViewSchema", () => {
  it("accepts a valid initial view", () => {
    const r = InitialViewSchema.safeParse({ x: 100, y: 200, scale: 1.5 });
    expect(r.success).toBe(true);
  });

  it("accepts null (fit to viewport)", () => {
    const r = InitialViewSchema.safeParse(null);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeNull();
  });

  it("rejects non-positive scale", () => {
    const r = InitialViewSchema.safeParse({ x: 0, y: 0, scale: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const r = InitialViewSchema.safeParse({ x: 0 });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TokenDocumentSchema
// ---------------------------------------------------------------------------

describe("TokenDocumentSchema", () => {
  it("accepts a minimal token with just _id and actorId", () => {
    const r = TokenDocumentSchema.safeParse({ _id: validId(), actorId: "B".repeat(16) });
    expect(r.success).toBe(true);
  });

  it("applies all defaults correctly", () => {
    const r = TokenDocumentSchema.safeParse({ _id: validId(), actorId: "B".repeat(16) });
    expect(r.success).toBe(true);
    if (r.success) {
      const d = r.data;
      expect(d.name).toBeNull();
      expect(d.actorId).toBe("B".repeat(16));
      expect(d.x).toBe(0);
      expect(d.y).toBe(0);
      expect(d.rotation).toBe(0);
      expect(d.elevation).toBe(0);
      expect(d.hidden).toBe(false);
      expect(d.seenBy).toEqual([]);
      expect(d.disposition).toBeNull();
      expect(d.bar1.attribute).toBeNull();
      expect(d.bar2.attribute).toBeNull();
      expect(d.flags).toEqual({});
      expect(d.actorLink).toBe(true);
      expect(d.actorDelta).toBeNull();
    }
  });

  // TK100 (spec 41-token.md REQ-TOK-101/102, DEC-TOK-18, D24): `vision`/
  // `light` stay declared — inert as far as spec 41 is concerned, not
  // removed from the model. See scene.ts's own field comments for why
  // "tirar de verdade" (project-wide) is explicitly out of spec 41's scope.
  it("REQ-TOK-101/102: declares `vision` and `light` (never `sight`), present with defaults", () => {
    const r = TokenDocumentSchema.safeParse({ _id: validId(), actorId: "B".repeat(16) });
    expect(r.success).toBe(true);
    if (r.success) {
      const d = r.data as unknown as Record<string, unknown>;
      expect(d).toHaveProperty("vision");
      expect(d).toHaveProperty("light");
      expect(d).not.toHaveProperty("sight");
    }
  });

  it("accepts a fully populated token", () => {
    const r = TokenDocumentSchema.safeParse({
      _id: validId(),
      name: "Goblin",
      actorId: "B".repeat(16),
      x: 250,
      y: 350,
      rotation: 90,
      elevation: 0,
      hidden: false,
      seenBy: ["C".repeat(16)],
      disposition: -1,
      bar1: { attribute: "attributes.hp" },
      bar2: { attribute: null },
      flags: { core: { sourceId: "Compendium.pf2e.bestiary.Actor.GoblindId" } },
      actorLink: false,
      actorDelta: { name: "Goblin (wounded)" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Goblin");
      expect(r.data.disposition).toBe(-1);
      expect(r.data.seenBy).toEqual(["C".repeat(16)]);
      expect(r.data.actorLink).toBe(false);
      expect(r.data.actorDelta).toEqual({ name: "Goblin (wounded)" });
    }
  });

  it("rejects _id with invalid format", () => {
    const r = TokenDocumentSchema.safeParse({ _id: "short", actorId: "B".repeat(16) });
    expect(r.success).toBe(false);
  });

  it("rejects rotation above 360", () => {
    const r = TokenDocumentSchema.safeParse({
      _id: validId(),
      actorId: "B".repeat(16),
      rotation: 361,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid disposition value", () => {
    const r = TokenDocumentSchema.safeParse({
      _id: validId(),
      actorId: "B".repeat(16),
      disposition: 5,
    });
    expect(r.success).toBe(false);
  });

  // Schema-level acceptance only (TK024). Read-time resolution against the
  // base actor's disposition is TK042 — no Actor schema carries a
  // `disposition` field yet, so inheritance itself isn't provable here.
  it("accepts disposition as null (schema-level null acceptance) — REQ-TOK-080", () => {
    const r = TokenDocumentSchema.safeParse({
      _id: validId(),
      actorId: "B".repeat(16),
      disposition: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.disposition).toBeNull();
  });

  it("accepts name as null (inherits from the effective actor) — REQ-TOK-060", () => {
    const r = TokenDocumentSchema.safeParse({
      _id: validId(),
      actorId: "B".repeat(16),
      name: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBeNull();
  });

  // REQ-TOK-002: actorId is required — null, missing, or omitted must all be refused.
  it("rejects actorId: null — REQ-TOK-002", () => {
    const r = TokenDocumentSchema.safeParse({ _id: validId(), actorId: null });
    expect(r.success).toBe(false);
  });

  it("rejects a payload missing actorId entirely — REQ-TOK-002", () => {
    const r = TokenDocumentSchema.safeParse({ _id: validId() });
    expect(r.success).toBe(false);
  });

  // REQ-TOK-010/REQ-TOK-012: texture/width/height no longer exist on the schema.
  // z.object() strips unknown keys silently on parse — this is documented here as the
  // shared-schema behavior; the SERVER'S explicit refusal of these fields in a create
  // payload (REQ-TOK-022) is TK025's responsibility, not this schema's.
  it("strips texture/width/height from the parsed output — REQ-TOK-010, REQ-TOK-012", () => {
    const r = TokenDocumentSchema.safeParse({
      _id: validId(),
      actorId: "B".repeat(16),
      texture: "/assets/goblin.webp",
      width: 2,
      height: 2,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("texture");
      expect(r.data).not.toHaveProperty("width");
      expect(r.data).not.toHaveProperty("height");
    }
  });

  // REQ-TOK-050: seenBy is the exception list to `hidden`.
  it("defaults seenBy to an empty array when omitted — REQ-TOK-050", () => {
    const r = TokenDocumentSchema.safeParse({ _id: validId(), actorId: "B".repeat(16) });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.seenBy).toEqual([]);
  });

  it("accepts an explicit seenBy list of userIds — REQ-TOK-050", () => {
    const r = TokenDocumentSchema.safeParse({
      _id: validId(),
      actorId: "B".repeat(16),
      seenBy: ["C".repeat(16), "D".repeat(16)],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.seenBy).toHaveLength(2);
  });

  // REQ-TOK-023/REQ-DOC-023: an unlinked token with a delta survives a parse -> JSON ->
  // parse round-trip (persistence) without the delta being dropped by validation.
  it("round-trips an unlinked token's actorDelta through parse -> JSON -> parse — REQ-TOK-023, REQ-DOC-018", () => {
    const first = TokenDocumentSchema.parse({
      _id: validId(),
      actorId: "B".repeat(16),
      actorLink: false,
      actorDelta: {
        name: "Goblin (elite)",
        system: { attributes: { hp: { value: 20, max: 20 } } },
        items: [{ name: "Elite Dagger" }],
      },
    });
    const roundTripped = TokenDocumentSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped.actorLink).toBe(false);
    expect(roundTripped.actorDelta).toEqual(first.actorDelta);
    expect(roundTripped.actorDelta?.items).toEqual([{ name: "Elite Dagger" }]);
  });
});

// ---------------------------------------------------------------------------
// defaultTokenDocument helper
// ---------------------------------------------------------------------------

describe("defaultTokenDocument", () => {
  it("produces a valid TokenDocument", () => {
    const token = defaultTokenDocument(validId(), "B".repeat(16));
    const r = TokenDocumentSchema.safeParse(token);
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SceneDocumentSchema
// ---------------------------------------------------------------------------

const baseSceneInput = () => ({
  _id: validId(),
  _stats: validStats(),
  name: "Test Scene",
});

describe("SceneDocumentSchema", () => {
  it("accepts a minimal scene with only _id and _stats", () => {
    const r = SceneDocumentSchema.safeParse(baseSceneInput());
    expect(r.success).toBe(true);
  });

  it("applies all scalar defaults correctly", () => {
    const r = SceneDocumentSchema.safeParse(baseSceneInput());
    expect(r.success).toBe(true);
    if (r.success) {
      const d = r.data;
      expect(d.active).toBe(false);
      expect(d.width).toBe(4000);
      expect(d.height).toBe(4000);
      expect(d.padding).toBe(0.25);
      expect(d.background).toBeNull();
      expect(d.backgroundColor).toBe("#000000");
      expect(d.tokenVision).toBe(false);
      expect(d.navigation).toBe(true);
      expect(d.navName).toBeNull();
      expect(d.thumb).toBeNull();
      expect(d.playlistId).toBeNull();
      expect(d.journalId).toBeNull();
      // EmbeddedCollections default to empty arrays
      expect(d.tokens).toEqual([]);
      expect(d.walls).toEqual([]);
      expect(d.lights).toEqual([]);
      expect(d.sounds).toEqual([]);
      expect(d.tiles).toEqual([]);
      expect(d.drawings).toEqual([]);
      expect(d.templates).toEqual([]);
      expect(d.notes).toEqual([]);
    }
  });

  it("applies default grid configuration", () => {
    const r = SceneDocumentSchema.safeParse(baseSceneInput());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.grid.type).toBe("square");
      expect(r.data.grid.size).toBe(100);
      expect(r.data.grid.distance).toBe(5);
      expect(r.data.grid.units).toBe("ft");
    }
  });

  it("accepts a scene with embedded tokens", () => {
    const tokenData = {
      _id: "B".repeat(16),
      actorId: "Z".repeat(16),
      name: "Hero",
      x: 100,
      y: 200,
    };
    const r = SceneDocumentSchema.safeParse({
      ...baseSceneInput(),
      tokens: [tokenData],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tokens).toHaveLength(1);
      expect(r.data.tokens[0]!.name).toBe("Hero");
      expect(r.data.tokens[0]!.x).toBe(100);
    }
  });

  it("accepts multiple tokens with different dispositions", () => {
    const tokens = [
      { _id: "A".repeat(16), actorId: "Z".repeat(16), disposition: 1 },
      { _id: "B".repeat(16), actorId: "Z".repeat(16), disposition: -1 },
      { _id: "C".repeat(16), actorId: "Z".repeat(16), disposition: 0 },
    ];
    const r = SceneDocumentSchema.safeParse({ ...baseSceneInput(), tokens });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tokens).toHaveLength(3);
    }
  });

  it("rejects a token with invalid _id inside tokens array", () => {
    const r = SceneDocumentSchema.safeParse({
      ...baseSceneInput(),
      tokens: [{ _id: "bad-id", actorId: "Z".repeat(16) }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects padding above 0.5", () => {
    const r = SceneDocumentSchema.safeParse({ ...baseSceneInput(), padding: 0.6 });
    expect(r.success).toBe(false);
  });

  it("rejects negative padding", () => {
    const r = SceneDocumentSchema.safeParse({ ...baseSceneInput(), padding: -0.1 });
    expect(r.success).toBe(false);
  });

  it("rejects non-positive width", () => {
    const r = SceneDocumentSchema.safeParse({ ...baseSceneInput(), width: 0 });
    expect(r.success).toBe(false);
  });

  it("accepts an initialView override", () => {
    const r = SceneDocumentSchema.safeParse({
      ...baseSceneInput(),
      initialView: { x: 2000, y: 2000, scale: 0.8 },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.initialView?.scale).toBe(0.8);
    }
  });

  it("accepts a background path string", () => {
    const r = SceneDocumentSchema.safeParse({
      ...baseSceneInput(),
      background: "/assets/maps/dungeon.webp",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.background).toBe("/assets/maps/dungeon.webp");
  });

  it("accepts a background URL", () => {
    const r = SceneDocumentSchema.safeParse({
      ...baseSceneInput(),
      background: "https://cdn.example.com/map.jpg",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing _id", () => {
    const r = SceneDocumentSchema.safeParse({ _stats: validStats() });
    expect(r.success).toBe(false);
  });

  it("rejects a missing _stats", () => {
    const r = SceneDocumentSchema.safeParse({ _id: validId() });
    expect(r.success).toBe(false);
  });

  it("accepts ownership override", () => {
    const r = SceneDocumentSchema.safeParse({
      ...baseSceneInput(),
      ownership: { default: 0, user1: 3 },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ownership["user1"]).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// defaultSceneDocument helper
// ---------------------------------------------------------------------------

describe("defaultSceneDocument", () => {
  it("produces a valid SceneDocument", () => {
    const scene = defaultSceneDocument(validId());
    const r = SceneDocumentSchema.safeParse(scene);
    expect(r.success).toBe(true);
  });

  it("uses provided name", () => {
    const scene = defaultSceneDocument(validId(), "Dragon's Lair");
    expect(scene.name).toBe("Dragon's Lair");
  });
});

// ---------------------------------------------------------------------------
// tokenDiffPath helper
// ---------------------------------------------------------------------------

describe("tokenDiffPath", () => {
  it("builds dot-path for x position", () => {
    expect(tokenDiffPath("A".repeat(16), "x")).toBe(`tokens.${"A".repeat(16)}.x`);
  });

  it("builds dot-path for hidden field", () => {
    expect(tokenDiffPath("B".repeat(16), "hidden")).toBe(`tokens.${"B".repeat(16)}.hidden`);
  });

  it("builds dot-path for disposition", () => {
    expect(tokenDiffPath("C".repeat(16), "disposition")).toBe(
      `tokens.${"C".repeat(16)}.disposition`,
    );
  });
});

// ---------------------------------------------------------------------------
// buildTokenMoveDiff helper
// ---------------------------------------------------------------------------

describe("buildTokenMoveDiff", () => {
  it("returns x and y paths without rotation", () => {
    const id = "D".repeat(16);
    const diff = buildTokenMoveDiff(id, 100, 200);
    expect(diff[`tokens.${id}.x`]).toBe(100);
    expect(diff[`tokens.${id}.y`]).toBe(200);
    expect(Object.keys(diff)).toHaveLength(2);
  });

  it("includes rotation path when provided", () => {
    const id = "E".repeat(16);
    const diff = buildTokenMoveDiff(id, 50, 75, 45);
    expect(diff[`tokens.${id}.x`]).toBe(50);
    expect(diff[`tokens.${id}.y`]).toBe(75);
    expect(diff[`tokens.${id}.rotation`]).toBe(45);
    expect(Object.keys(diff)).toHaveLength(3);
  });

  it("does not include rotation when undefined", () => {
    const id = "F".repeat(16);
    const diff = buildTokenMoveDiff(id, 0, 0, undefined);
    expect(`tokens.${id}.rotation` in diff).toBe(false);
  });
});
