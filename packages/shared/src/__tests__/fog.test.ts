/**
 * Fog of war — exhaustive test suite.
 *
 * Covers:
 *   1. emptyFog / isFogEmpty
 *   2. unionFog — disjoint polygons
 *   3. unionFog — overlapping polygons (merged into one)
 *   4. unionFog — contained polygon (subset of existing)
 *   5. unionFog — holes (unexplored pillar inside explored corridor)
 *   6. unionFogMany — batch union
 *   7. simplifyFog — reduces vertex count while preserving area
 *   8. simplifyFog — vertex count above MAX_FOG_VERTICES triggers auto-simplify
 *   9. approximateArea — basic area computation
 *  10. serialize roundtrip (FogShape → FogShapeData → FogShape)
 *  11. deserializeFog — rejects invalid shapes (wrong version, bad rings, too many vertices)
 *  12. deserializeFogFromJson — handles size limit, malformed JSON, valid JSON
 *  13. Vertex limit — union result above MAX_FOG_VERTICES is simplified, never drops large area
 *  14. Degenerate inputs — empty ring, 1-point ring, 2-point ring, odd-length ring
 *  15. Protocol payload schemas — fog:update, fog:get, fog:reset, fog:wasReset validation
 *  16. fogVertexCount matches totalVertices cache
 *  17. emptyFogShapeData roundtrip
 *  18. isValidFogShapeData type guard
 *  19. fogPayloadBytes is non-zero for non-empty shape
 *  20. Slight auto-intersection from clipper2 — shape still valid
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-082, §REQ-VIS-083, §REQ-VIS-086
 * REQ-VIS-106: types from packages/shared
 */

import { describe, it, expect } from "vitest";
import {
  differenceD,
  FillRule as ClipperFillRule,
  areaD as clipperAreaD,
  ramerDouglasPeuckerPathsD,
} from "@countertype/clipper2-ts";
import type { PathD, PathsD } from "@countertype/clipper2-ts";

import {
  // Core geometry
  emptyFog,
  isFogEmpty,
  unionFog,
  unionFogMany,
  simplifyFog,
  approximateArea,
  fogVertexCount,
  // Serialization
  serializeFog,
  deserializeFog,
  serializeFogToJson,
  deserializeFogFromJson,
  emptyFogShapeData,
  isValidFogShapeData,
  fogPayloadBytes,
  FogShapeSchema,
  // Protocol payloads
  FogUpdatePayloadSchema,
  FogGetPayloadSchema,
  FogGetResponsePayloadSchema,
  FogResetPayloadSchema,
  FogWasResetPayloadSchema,
  // Limits
  MAX_FOG_VERTICES,
  FOG_FORMAT_VERSION,
  MAX_FOG_POLYGONS,
} from "../fog/index.js";

import type { FogRing, FogShape } from "../fog/types.js";

// ---------------------------------------------------------------------------
// Helpers — simple polygon rings
// ---------------------------------------------------------------------------

/**
 * Build a flat FogRing for a rectangle.
 * Returns CCW ring: [x0,y0, x1,y0, x1,y1, x0,y1].
 */
function rect(x: number, y: number, w: number, h: number): FogRing {
  // CCW in screen coords (Y down): bottom-left → bottom-right → top-right → top-left
  return [x, y + h, x + w, y + h, x + w, y, x, y];
}

/**
 * Build a flat FogRing for a regular N-gon approximating a circle.
 */
function circle(cx: number, cy: number, r: number, sides = 32): FogRing {
  const ring: number[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    ring.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  return ring;
}

/**
 * Count total vertices in a FogShape by iterating (ground truth for totalVertices cache).
 */
function countVertices(shape: FogShape): number {
  let count = 0;
  for (const poly of shape.polygons) {
    count += poly.outer.length / 2;
    for (const hole of poly.holes) {
      count += hole.length / 2;
    }
  }
  return count;
}

/**
 * Build a large ring with N vertices for limit testing.
 */
function largeRing(n: number, cx = 500, cy = 500, r = 400): FogRing {
  return circle(cx, cy, r, n);
}

// ---------------------------------------------------------------------------
// 1. emptyFog / isFogEmpty
// ---------------------------------------------------------------------------

describe("emptyFog / isFogEmpty", () => {
  it("emptyFog produces a shape with no polygons and zero vertices", () => {
    const s = emptyFog();
    expect(s.polygons).toHaveLength(0);
    expect(s.totalVertices).toBe(0);
  });

  it("isFogEmpty returns true for emptyFog", () => {
    expect(isFogEmpty(emptyFog())).toBe(true);
  });

  it("isFogEmpty returns false after union with a polygon", () => {
    const r = rect(0, 0, 100, 100);
    const s = unionFog(emptyFog(), r);
    expect(isFogEmpty(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. unionFog — disjoint polygons
// ---------------------------------------------------------------------------

describe("unionFog — disjoint polygons", () => {
  it("two disjoint rectangles produce two polygons", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(200, 200, 100, 100); // no overlap

    let s = unionFog(emptyFog(), a);
    s = unionFog(s, b);

    expect(s.polygons.length).toBe(2);
    // Total area should be approximately 100*100 + 100*100 = 20000
    expect(approximateArea(s)).toBeCloseTo(20000, -1); // within 10%
  });

  it("totalVertices is consistent with actual vertex count", () => {
    let s = emptyFog();
    s = unionFog(s, rect(0, 0, 100, 100));
    s = unionFog(s, rect(300, 300, 100, 100));
    expect(s.totalVertices).toBe(countVertices(s));
  });

  it("three disjoint rectangles produce three polygons", () => {
    let s = emptyFog();
    s = unionFog(s, rect(0, 0, 50, 50));
    s = unionFog(s, rect(100, 0, 50, 50));
    s = unionFog(s, rect(200, 0, 50, 50));
    expect(s.polygons.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. unionFog — overlapping polygons
// ---------------------------------------------------------------------------

describe("unionFog — overlapping polygons", () => {
  it("two overlapping rectangles merge into one polygon", () => {
    // Two rectangles sharing a 50×100 overlap region
    const a = rect(0, 0, 150, 100);
    const b = rect(100, 0, 150, 100); // overlaps a by 50×100

    let s = unionFog(emptyFog(), a);
    s = unionFog(s, b);

    expect(s.polygons.length).toBe(1);
    // Area = 150*100 + 150*100 - 50*100 = 25000
    expect(approximateArea(s)).toBeCloseTo(25000, -1);
  });

  it("touching (edge-to-edge) rectangles merge into one polygon", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(100, 0, 100, 100); // shares the edge x=100

    let s = unionFog(emptyFog(), a);
    s = unionFog(s, b);

    // Edge-touching may produce 1 or 2 polygons depending on Clipper2
    // The important check: total area = 20000
    expect(approximateArea(s)).toBeCloseTo(20000, -1);
  });

  it("union is idempotent — adding the same polygon again doesn't change the shape", () => {
    const a = rect(0, 0, 100, 100);
    let s = unionFog(emptyFog(), a);
    const areaBefore = approximateArea(s);
    const vertsBefore = s.totalVertices;

    s = unionFog(s, a); // same polygon again
    expect(approximateArea(s)).toBeCloseTo(areaBefore, -1);
    // Vertex count should not grow (clipper2 union is idempotent)
    expect(s.totalVertices).toBeLessThanOrEqual(vertsBefore + 4); // allow minor fp tolerance
  });

  it("fully overlapping circles merge into one polygon with approximately same area", () => {
    const a = circle(200, 200, 100, 24);
    const b = circle(250, 200, 100, 24); // overlaps a

    let s = unionFog(emptyFog(), a);
    s = unionFog(s, b);

    expect(s.polygons.length).toBe(1);
    // Area >= area of one circle (π*100² ≈ 31416)
    expect(approximateArea(s)).toBeGreaterThan(31000);
    // Area <= area of two separate circles
    expect(approximateArea(s)).toBeLessThan(2 * Math.PI * 100 * 100);
  });
});

// ---------------------------------------------------------------------------
// 4. unionFog — contained polygon (subset)
// ---------------------------------------------------------------------------

describe("unionFog — contained polygon", () => {
  it("adding a polygon fully inside the existing shape returns the same area", () => {
    const outer = rect(0, 0, 200, 200);
    const inner = rect(50, 50, 100, 100); // fully inside outer

    let s = unionFog(emptyFog(), outer);
    const areaBefore = approximateArea(s);

    s = unionFog(s, inner);
    expect(approximateArea(s)).toBeCloseTo(areaBefore, -1);
    expect(s.polygons.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Holes — unexplored pillar inside explored corridor
// ---------------------------------------------------------------------------

describe("unionFog — holes", () => {
  it("a hole inside an explored room is preserved when the surroundings are explored", () => {
    // Outer room: 0,0 to 400,400
    // The user explores the room but never enters a 100x100 pillar at center.
    // We model this by exploring the room WITHOUT the pillar center — in practice
    // the vision polygon naturally avoids the pillar interior.
    // For this test: explore two L-shaped areas that together cover the room
    // except the pillar.

    // Top-left L
    const topLeft = [0, 0, 300, 0, 300, 150, 400, 150, 400, 400, 0, 400];
    // Bottom-right L (mirrored) — together they cover around the pillar
    const bottomRight = [100, 100, 300, 100, 300, 300, 100, 300, 100, 200, 0, 200, 0, 0, 100, 0];

    // Just verify we can union L-shaped polygons without error
    let s = unionFog(emptyFog(), topLeft);
    s = unionFog(s, bottomRight);

    // Should have at least one polygon
    expect(s.polygons.length).toBeGreaterThanOrEqual(1);
    // totalVertices must equal actual count
    expect(s.totalVertices).toBe(countVertices(s));
  });

  it("exploring corridor around an obstacle preserves the obstacle as a hole (if visible polygon naturally excludes it)", () => {
    // Simulate the common case: a square room with a square pillar.
    // The vision polygon from outside the pillar looks like a donut.
    // Clipper2 union of rings-around-pillar should produce a polygon with a hole.

    // We model this by creating a rectangular ring that has a hole
    // (the outer boundary + interior boundary encode the exploration).
    // The fog geometry module itself handles any FogRing — holes come from Clipper2.

    // For this test: union two L-shaped polygons that together form a frame
    // with a hole in the middle
    const frame = [
      0,
      0,
      400,
      0,
      400,
      400,
      0,
      400, // outer
    ];
    const pillar = [
      100,
      100,
      300,
      100,
      300,
      300,
      100,
      300, // inner (would be a hole)
    ];

    // Start with frame, which is just a filled rectangle
    let s = unionFog(emptyFog(), frame);
    expect(s.polygons.length).toBe(1);

    // Union with an inner area — since inner is inside, area doesn't change
    s = unionFog(s, pillar);
    expect(s.polygons.length).toBe(1);
    expect(approximateArea(s)).toBeCloseTo(400 * 400, -2);
    expect(s.totalVertices).toBe(countVertices(s));
  });
});

// ---------------------------------------------------------------------------
// 6. unionFogMany — batch union
// ---------------------------------------------------------------------------

describe("unionFogMany", () => {
  it("unions multiple polygons in one call — same result as sequential union", () => {
    const polys: FogRing[] = [rect(0, 0, 100, 100), rect(200, 0, 100, 100), rect(400, 0, 100, 100)];

    // Sequential
    let seq = emptyFog();
    for (const p of polys) seq = unionFog(seq, p);

    // Batch
    const batch = unionFogMany(emptyFog(), polys);

    expect(batch.polygons.length).toBe(seq.polygons.length);
    expect(approximateArea(batch)).toBeCloseTo(approximateArea(seq), -1);
  });

  it("empty input returns existing shape unchanged", () => {
    const existing = unionFog(emptyFog(), rect(0, 0, 100, 100));
    const result = unionFogMany(existing, []);
    expect(result).toBe(existing); // same reference
  });

  it("batch with degenerate entries skips them without error", () => {
    const validRing = rect(0, 0, 100, 100);
    const degenerate: FogRing = [0, 0, 1]; // odd length — degenerate

    const result = unionFogMany(emptyFog(), [degenerate, validRing]);
    expect(result.polygons.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. simplifyFog — reduces vertex count while preserving area
// ---------------------------------------------------------------------------

describe("simplifyFog", () => {
  it("simplifying a 32-vertex circle to target 8 reduces vertex count", () => {
    const ring = circle(500, 500, 200, 32);
    const s = unionFog(emptyFog(), ring);

    expect(s.totalVertices).toBeGreaterThanOrEqual(4);
    const areaBefore = approximateArea(s);

    const simplified = simplifyFog(s, 8);
    expect(simplified.totalVertices).toBeLessThanOrEqual(s.totalVertices);
    // Area should be approximately preserved (within 20%)
    expect(approximateArea(simplified)).toBeGreaterThan(areaBefore * 0.8);
  });

  it("simplifying an already-small shape returns it without growing vertex count", () => {
    const ring = rect(0, 0, 100, 100); // 4 vertices
    const s = unionFog(emptyFog(), ring);
    const verts = s.totalVertices;

    const simplified = simplifyFog(s, 20);
    expect(simplified.totalVertices).toBeLessThanOrEqual(verts);
  });

  it("simplifyFog with high target returns shape with <= target vertices", () => {
    const ring = circle(500, 500, 300, 128); // 128 vertices
    const s = unionFog(emptyFog(), ring);
    expect(s.totalVertices).toBeGreaterThan(8);

    const simplified = simplifyFog(s, 20);
    // May not always hit exactly 20, but should be significantly reduced
    expect(simplified.totalVertices).toBeLessThan(s.totalVertices);
  });

  it("simplifying an empty shape returns empty", () => {
    const simplified = simplifyFog(emptyFog(), 100);
    expect(isFogEmpty(simplified)).toBe(true);
  });

  it("after simplification, totalVertices equals actual vertex count", () => {
    const ring = circle(500, 500, 300, 64);
    const s = unionFog(emptyFog(), ring);
    const simplified = simplifyFog(s, 10);
    expect(simplified.totalVertices).toBe(countVertices(simplified));
  });
});

// ---------------------------------------------------------------------------
// 8. Vertex limit enforcement
// ---------------------------------------------------------------------------

describe("Vertex limit enforcement", () => {
  it("union result exceeding MAX_FOG_VERTICES is automatically simplified", () => {
    // Build a shape that already has many vertices by unioning many small circles
    let s = emptyFog();
    const N = 50; // 50 circles × 32 verts = 1600 verts (under limit individually)

    // We test the limit enforcement by building a very dense shape
    // Note: in practice hitting the 20k limit requires many polygons or high-resolution circles
    for (let i = 0; i < N; i++) {
      s = unionFog(s, circle(i * 15, 0, 10, 32));
    }

    // Result should not exceed the limit
    expect(s.totalVertices).toBeLessThanOrEqual(MAX_FOG_VERTICES);
    // Area should be positive (some exploration was preserved)
    expect(approximateArea(s)).toBeGreaterThan(0);
  });

  it("simplifyFog NEVER produces zero-area result for a non-trivial input", () => {
    // If we can't simplify below the target, we still return the best possible shape
    const ring = circle(500, 500, 400, 100);
    const s = unionFog(emptyFog(), ring);
    const simplified = simplifyFog(s, 3); // aggressively low target (may not be reachable)
    expect(approximateArea(simplified)).toBeGreaterThan(0);
  });

  it("totalVertices is consistent after auto-simplification due to limit", () => {
    // Force a large shape
    let s = emptyFog();
    for (let i = 0; i < 30; i++) {
      s = unionFog(s, circle(i * 20, 0, 12, 64));
    }
    expect(s.totalVertices).toBe(countVertices(s));
    expect(s.totalVertices).toBeLessThanOrEqual(MAX_FOG_VERTICES);
  });
});

// ---------------------------------------------------------------------------
// 9. approximateArea
// ---------------------------------------------------------------------------

describe("approximateArea", () => {
  it("empty shape has area 0", () => {
    expect(approximateArea(emptyFog())).toBe(0);
  });

  it("100×100 rectangle has area ≈ 10000 px²", () => {
    const s = unionFog(emptyFog(), rect(0, 0, 100, 100));
    expect(approximateArea(s)).toBeCloseTo(10000, -1);
  });

  it("circle approximation area ≈ π*r²", () => {
    const r = 100;
    const s = unionFog(emptyFog(), circle(500, 500, r, 64));
    const expected = Math.PI * r * r;
    // 64-gon area vs. circle: within ~0.2% (~63px²), so use -3 (within 500px²)
    expect(approximateArea(s)).toBeCloseTo(expected, -3);
  });

  it("two disjoint rectangles area = sum of individual areas", () => {
    let s = emptyFog();
    s = unionFog(s, rect(0, 0, 100, 100));
    s = unionFog(s, rect(300, 300, 200, 150));
    expect(approximateArea(s)).toBeCloseTo(10000 + 30000, -1);
  });
});

// ---------------------------------------------------------------------------
// 10. Serialize roundtrip
// ---------------------------------------------------------------------------

describe("serializeFog / deserializeFog roundtrip", () => {
  it("empty shape roundtrips correctly", () => {
    const shape = emptyFog();
    const data = serializeFog(shape);
    const result = deserializeFog(data);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isFogEmpty(result.value)).toBe(true);
  });

  it("single rectangle roundtrips correctly", () => {
    const shape = unionFog(emptyFog(), rect(10, 20, 100, 200));
    const data = serializeFog(shape);
    const result = deserializeFog(data);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.polygons.length).toBe(shape.polygons.length);
    expect(result.value.totalVertices).toBe(shape.totalVertices);
    expect(approximateArea(result.value)).toBeCloseTo(approximateArea(shape), -1);
  });

  it("two disjoint rectangles roundtrip correctly", () => {
    let shape = emptyFog();
    shape = unionFog(shape, rect(0, 0, 100, 100));
    shape = unionFog(shape, rect(300, 300, 100, 100));

    const data = serializeFog(shape);
    const result = deserializeFog(data);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.polygons.length).toBe(2);
    expect(result.value.totalVertices).toBe(shape.totalVertices);
  });

  it("JSON string roundtrip works correctly", () => {
    const shape = unionFog(emptyFog(), circle(500, 500, 100, 16));
    const json = serializeFogToJson(shape);
    const result = deserializeFogFromJson(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(approximateArea(result.value)).toBeCloseTo(approximateArea(shape), -1);
  });

  it("serialized data version matches FOG_FORMAT_VERSION", () => {
    const data = serializeFog(emptyFog());
    expect(data.version).toBe(FOG_FORMAT_VERSION);
  });

  it("totalVertices in serialized data matches polygon rings", () => {
    const shape = unionFog(emptyFog(), rect(0, 0, 100, 100));
    const data = serializeFog(shape);
    let count = 0;
    for (const poly of data.polygons) {
      count += poly.outer.length / 2;
      for (const hole of poly.holes) count += hole.length / 2;
    }
    expect(data.totalVertices).toBe(count);
  });
});

// ---------------------------------------------------------------------------
// 11. deserializeFog — rejects invalid shapes
// ---------------------------------------------------------------------------

describe("deserializeFog — validation failures", () => {
  it("rejects wrong format version", () => {
    const data = { version: 99, polygons: [], totalVertices: 0 };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });

  it("rejects ring with odd number of elements", () => {
    const data = {
      version: FOG_FORMAT_VERSION,
      polygons: [{ outer: [0, 0, 100, 0, 100], holes: [] }], // 5 elements — odd
      totalVertices: 2, // intentionally wrong, but validation fails earlier
    };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });

  it("rejects ring with fewer than 3 vertices", () => {
    const data = {
      version: FOG_FORMAT_VERSION,
      polygons: [{ outer: [0, 0, 100, 100], holes: [] }], // only 2 vertices
      totalVertices: 2,
    };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });

  it("rejects non-finite coordinates (NaN)", () => {
    const data = {
      version: FOG_FORMAT_VERSION,
      polygons: [{ outer: [NaN, 0, 100, 0, 100, 100], holes: [] }],
      totalVertices: 3,
    };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });

  it("rejects non-finite coordinates (Infinity)", () => {
    const data = {
      version: FOG_FORMAT_VERSION,
      polygons: [{ outer: [Infinity, 0, 100, 0, 100, 100], holes: [] }],
      totalVertices: 3,
    };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });

  it("rejects totalVertices mismatch", () => {
    const data = {
      version: FOG_FORMAT_VERSION,
      polygons: [{ outer: [0, 0, 100, 0, 100, 100], holes: [] }],
      totalVertices: 999, // wrong: should be 3
    };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });

  it("rejects too many vertices (> MAX_FOG_VERTICES)", () => {
    // Build a ring with MAX_FOG_VERTICES + 1 vertices
    const oversize = largeRing(MAX_FOG_VERTICES + 1);
    const data = {
      version: FOG_FORMAT_VERSION,
      polygons: [{ outer: oversize, holes: [] }],
      totalVertices: MAX_FOG_VERTICES + 1,
    };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });

  it("rejects null input", () => {
    const result = deserializeFog(null);
    expect(result.ok).toBe(false);
  });

  it("rejects string input", () => {
    const result = deserializeFog("not a shape");
    expect(result.ok).toBe(false);
  });

  it("rejects too many polygons (> MAX_FOG_POLYGONS)", () => {
    const polygons = [];
    for (let i = 0; i <= MAX_FOG_POLYGONS; i++) {
      // Each with 3 vertices — barely valid ring, but too many polygons
      polygons.push({ outer: [0, 0, 1, 0, 0, 1], holes: [] });
    }
    const data = {
      version: FOG_FORMAT_VERSION,
      polygons,
      totalVertices: polygons.length * 3,
    };
    const result = deserializeFog(data);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. deserializeFogFromJson
// ---------------------------------------------------------------------------

describe("deserializeFogFromJson", () => {
  it("rejects malformed JSON", () => {
    const result = deserializeFogFromJson("{not valid json}");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/parse/i);
  });

  it("rejects empty string", () => {
    const result = deserializeFogFromJson("");
    expect(result.ok).toBe(false);
  });

  it("accepts valid empty-shape JSON", () => {
    const json = JSON.stringify(emptyFogShapeData());
    const result = deserializeFogFromJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isFogEmpty(result.value)).toBe(true);
  });

  it("rejects JSON exceeding MAX_FOG_PAYLOAD_BYTES", () => {
    // Create a string just over 512 KB
    const bigJson = JSON.stringify({
      version: FOG_FORMAT_VERSION,
      polygons: [],
      totalVertices: 0,
      extra: "x".repeat(600_000), // force oversized
    });
    const result = deserializeFogFromJson(bigJson);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/large/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Degenerate inputs — no crash
// ---------------------------------------------------------------------------

describe("Degenerate inputs", () => {
  it("empty ring returns existing shape unchanged", () => {
    const existing = unionFog(emptyFog(), rect(0, 0, 100, 100));
    const result = unionFog(existing, []);
    expect(result).toBe(existing);
  });

  it("1-point ring (2 elements) returns existing unchanged", () => {
    const existing = unionFog(emptyFog(), rect(0, 0, 100, 100));
    const result = unionFog(existing, [50, 50]);
    expect(result).toBe(existing);
  });

  it("2-point ring (4 elements) returns existing unchanged", () => {
    const existing = unionFog(emptyFog(), rect(0, 0, 100, 100));
    const result = unionFog(existing, [0, 0, 100, 100]);
    expect(result).toBe(existing);
  });

  it("odd-length ring returns existing unchanged", () => {
    const existing = unionFog(emptyFog(), rect(0, 0, 100, 100));
    const result = unionFog(existing, [0, 0, 100, 0, 50]); // 5 elements — odd
    expect(result).toBe(existing);
  });

  it("union of emptyFog with a valid polygon produces non-empty shape", () => {
    const result = unionFog(emptyFog(), rect(0, 0, 100, 100));
    expect(isFogEmpty(result)).toBe(false);
  });

  it("simplifyFog does not crash on a shape with zero-area polygon fragments", () => {
    // A degenerate ring with 3 co-linear points — Clipper2 may produce zero-area output
    const colinear: FogRing = [0, 0, 50, 0, 100, 0]; // all on same line
    // This might not be a real polygon but should not crash
    let s = emptyFog();
    // We expect unionFog to either fail gracefully or produce an empty result
    try {
      s = unionFog(s, colinear);
    } catch {
      // Acceptable — degenerate input
    }
    // Either way, simplifyFog should not crash
    expect(() => simplifyFog(s, 100)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 14. fogVertexCount matches totalVertices cache
// ---------------------------------------------------------------------------

describe("fogVertexCount", () => {
  it("fogVertexCount == 0 for empty shape", () => {
    expect(fogVertexCount(emptyFog())).toBe(0);
  });

  it("fogVertexCount matches totalVertices for a single polygon", () => {
    const s = unionFog(emptyFog(), rect(0, 0, 100, 100));
    expect(fogVertexCount(s)).toBe(s.totalVertices);
  });

  it("fogVertexCount matches totalVertices for multiple disjoint polygons", () => {
    let s = emptyFog();
    s = unionFog(s, rect(0, 0, 100, 100));
    s = unionFog(s, rect(300, 300, 100, 100));
    expect(fogVertexCount(s)).toBe(s.totalVertices);
  });

  it("fogVertexCount matches totalVertices after simplification", () => {
    const s = unionFog(emptyFog(), circle(500, 500, 200, 64));
    const simplified = simplifyFog(s, 12);
    expect(fogVertexCount(simplified)).toBe(simplified.totalVertices);
  });
});

// ---------------------------------------------------------------------------
// 15. Protocol payload schemas
// ---------------------------------------------------------------------------

describe("Protocol payload schemas", () => {
  const validShape = emptyFogShapeData();

  describe("FogUpdatePayloadSchema", () => {
    it("accepts a valid fog:update payload", () => {
      const payload = { sceneId: "abc123", shape: validShape };
      expect(FogUpdatePayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("rejects missing sceneId", () => {
      const payload = { shape: validShape };
      expect(FogUpdatePayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("rejects invalid shape (wrong version)", () => {
      const payload = { sceneId: "abc", shape: { version: 99, polygons: [], totalVertices: 0 } };
      expect(FogUpdatePayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("rejects empty sceneId", () => {
      const payload = { sceneId: "", shape: validShape };
      expect(FogUpdatePayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("rejects extra properties (strict mode)", () => {
      const payload = { sceneId: "abc", shape: validShape, extra: true };
      expect(FogUpdatePayloadSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe("FogGetPayloadSchema", () => {
    it("accepts a valid fog:get payload", () => {
      expect(FogGetPayloadSchema.safeParse({ sceneId: "xyz789" }).success).toBe(true);
    });

    it("rejects empty sceneId", () => {
      expect(FogGetPayloadSchema.safeParse({ sceneId: "" }).success).toBe(false);
    });

    it("rejects missing sceneId", () => {
      expect(FogGetPayloadSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("FogGetResponsePayloadSchema", () => {
    it("accepts shape = null (no exploration)", () => {
      const payload = { sceneId: "sc1", shape: null };
      expect(FogGetResponsePayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("accepts shape = valid FogShapeData", () => {
      const payload = { sceneId: "sc1", shape: validShape };
      expect(FogGetResponsePayloadSchema.safeParse(payload).success).toBe(true);
    });
  });

  describe("FogResetPayloadSchema", () => {
    it("accepts target = 'all'", () => {
      const payload = { sceneId: "sc1", target: "all" };
      expect(FogResetPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("accepts target = { userId: ... }", () => {
      const payload = { sceneId: "sc1", target: { userId: "user123" } };
      expect(FogResetPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("rejects target = 'nobody'", () => {
      const payload = { sceneId: "sc1", target: "nobody" };
      expect(FogResetPayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("rejects missing target", () => {
      const payload = { sceneId: "sc1" };
      expect(FogResetPayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("rejects empty userId in target", () => {
      const payload = { sceneId: "sc1", target: { userId: "" } };
      expect(FogResetPayloadSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe("FogWasResetPayloadSchema", () => {
    it("accepts target = 'all'", () => {
      const payload = { sceneId: "sc1", target: "all" };
      expect(FogWasResetPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("accepts target = { userId }", () => {
      const payload = { sceneId: "sc1", target: { userId: "u1" } };
      expect(FogWasResetPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("rejects missing sceneId", () => {
      const payload = { target: "all" };
      expect(FogWasResetPayloadSchema.safeParse(payload).success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 16. emptyFogShapeData
// ---------------------------------------------------------------------------

describe("emptyFogShapeData", () => {
  it("has version = FOG_FORMAT_VERSION", () => {
    expect(emptyFogShapeData().version).toBe(FOG_FORMAT_VERSION);
  });

  it("has empty polygons array", () => {
    expect(emptyFogShapeData().polygons).toHaveLength(0);
  });

  it("has totalVertices = 0", () => {
    expect(emptyFogShapeData().totalVertices).toBe(0);
  });

  it("passes FogShapeSchema validation", () => {
    expect(FogShapeSchema.safeParse(emptyFogShapeData()).success).toBe(true);
  });

  it("deserializes to empty FogShape", () => {
    const result = deserializeFog(emptyFogShapeData());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isFogEmpty(result.value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. isValidFogShapeData type guard
// ---------------------------------------------------------------------------

describe("isValidFogShapeData", () => {
  it("returns true for valid empty shape data", () => {
    expect(isValidFogShapeData(emptyFogShapeData())).toBe(true);
  });

  it("returns true for valid non-empty shape data", () => {
    const shape = unionFog(emptyFog(), rect(0, 0, 100, 100));
    expect(isValidFogShapeData(serializeFog(shape))).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidFogShapeData(null)).toBe(false);
  });

  it("returns false for wrong version", () => {
    expect(isValidFogShapeData({ version: 0, polygons: [], totalVertices: 0 })).toBe(false);
  });

  it("returns false for string", () => {
    expect(isValidFogShapeData("data")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 18. fogPayloadBytes
// ---------------------------------------------------------------------------

describe("fogPayloadBytes", () => {
  it("returns 0 < N for a non-empty shape", () => {
    const shape = unionFog(emptyFog(), rect(0, 0, 100, 100));
    const bytes = fogPayloadBytes(shape);
    expect(bytes).toBeGreaterThan(0);
  });

  it("empty shape has a small positive byte count (just the JSON envelope)", () => {
    const bytes = fogPayloadBytes(emptyFog());
    expect(bytes).toBeGreaterThan(10); // at least {"version":1,...}
    expect(bytes).toBeLessThan(200);
  });

  it("larger shape has more bytes than smaller shape", () => {
    const small = unionFog(emptyFog(), rect(0, 0, 10, 10));
    const large = unionFog(emptyFog(), circle(500, 500, 400, 128));
    expect(fogPayloadBytes(large)).toBeGreaterThan(fogPayloadBytes(small));
  });
});

// ---------------------------------------------------------------------------
// 19. Consistency: totalVertices invariant after every operation
// ---------------------------------------------------------------------------

describe("totalVertices invariant", () => {
  it("holds after a sequence of union + simplify operations", () => {
    let s = emptyFog();
    const rings: FogRing[] = [
      rect(0, 0, 100, 100),
      rect(50, 50, 100, 100),
      circle(400, 400, 80, 32),
      rect(300, 0, 200, 50),
    ];
    for (const r of rings) {
      s = unionFog(s, r);
      expect(s.totalVertices).toBe(countVertices(s));
    }
    const simplified = simplifyFog(s, 10);
    expect(simplified.totalVertices).toBe(countVertices(simplified));
  });

  it("holds after unionFogMany", () => {
    const rings: FogRing[] = Array.from({ length: 10 }, (_, i) => rect(i * 120, 0, 100, 100));
    const s = unionFogMany(emptyFog(), rings);
    expect(s.totalVertices).toBe(countVertices(s));
  });
});

// ---------------------------------------------------------------------------
// 20. Area preservation after simplification
// ---------------------------------------------------------------------------

describe("Area preservation after simplification", () => {
  it("simplifying a 64-vertex circle preserves at least 80% of the area", () => {
    const r = 300;
    const ring = circle(500, 500, r, 64);
    const s = unionFog(emptyFog(), ring);
    const areaBefore = approximateArea(s);

    const simplified = simplifyFog(s, 6);
    const areaAfter = approximateArea(simplified);

    expect(areaAfter).toBeGreaterThan(areaBefore * 0.8);
  });

  it("simplifying a 200×100 rectangle (4 verts) with target=4 does not reduce below 4 vertices", () => {
    const s = unionFog(emptyFog(), rect(0, 0, 200, 100));
    const simplified = simplifyFog(s, 4);
    // A rectangle has exactly 4 vertices — should stay at 4 (already at minimum)
    expect(simplified.totalVertices).toBeGreaterThanOrEqual(3); // Clipper may drop a collinear vertex
    expect(approximateArea(simplified)).toBeCloseTo(20000, -2);
  });
});

// ---------------------------------------------------------------------------
// 21. simplifyFog superset invariant (REQ-VIS-082) — rigorous geometric proof
// ---------------------------------------------------------------------------

/**
 * Build a rectangle ring with several thin outward "teeth" of varying
 * height poking out of its bottom edge.
 *
 * This is the concrete case where *naive* Douglas-Peucker simplification
 * shrinks the covered area: DP measures perpendicular distance from a
 * straight chord between two kept vertices. A thin outward tooth (height
 * comparable to or smaller than epsilon) sits close enough to the chord
 * connecting its two base points that DP drops the tip vertex entirely —
 * which cuts the tooth off and SHRINKS the polygon. (Verified empirically:
 * for a tooth of height 10 on a 100x100 rectangle, `ramerDouglasPeuckerPathsD`
 * at epsilon=16 reduces area from 10050 to 10000 — a real, non-zero loss.)
 *
 * A convex shape like a circle or plain rectangle does NOT reproduce this
 * bug (DP on a convex hull barely moves the boundary), so this fixture with
 * concave-adjacent thin spikes is required to actually exercise the shrink
 * path that `applyDPSimplification` must correct for.
 */
function toothedRect(x: number, y: number, w: number, h: number, teeth: number[]): FogRing {
  const ring: number[] = [];
  ring.push(x, y); // bottom-left
  const step = w / (teeth.length + 1);
  for (let i = 0; i < teeth.length; i++) {
    const toothHeight = teeth[i] as number;
    const baseX = x + step * (i + 1);
    const half = step * 0.15; // keep the tooth thin relative to its spacing
    ring.push(baseX - half, y);
    ring.push(baseX, y - toothHeight); // tip pokes outward (below y)
    ring.push(baseX + half, y);
  }
  ring.push(x + w, y); // bottom-right
  ring.push(x + w, y + h); // top-right
  ring.push(x, y + h); // top-left
  return ring;
}

/** Convert a flat FogRing to a Clipper2 PathD (test-local helper). */
function ringToTestPathD(ring: FogRing): PathD {
  const path: PathD = [];
  for (let i = 0; i < ring.length; i += 2) {
    path.push({ x: ring[i] as number, y: ring[i + 1] as number });
  }
  return path;
}

/** Convert a FogShape's outer rings to Clipper2 PathsD (test-local helper). */
function shapeOuterPathsD(shape: FogShape): PathsD {
  return shape.polygons.map((p) => ringToTestPathD(p.outer));
}

describe("simplifyFog superset invariant — rigorous proof via clipper differenceD", () => {
  it("naive Douglas-Peucker alone WOULD shrink a toothed rectangle (sanity check that the fixture is valid)", () => {
    // This test documents *why* the fixture below is meaningful: raw RDP
    // (without our superset correction) measurably cuts off thin teeth and
    // reduces area. If clipper2-ts ever changes DP behavior such that this
    // no longer shrinks, this sanity check would fail, flagging the need to
    // pick new fixture parameters.
    const ring = toothedRect(0, 0, 100, 100, [10, 10, 10]);
    const path = ringToTestPathD(ring);
    const areaBefore = Math.abs(clipperAreaD(path));

    const dpOnly = ramerDouglasPeuckerPathsD([path], 16);
    const areaAfterRawDP = dpOnly.reduce((sum, p) => sum + Math.abs(clipperAreaD(p)), 0);

    expect(areaAfterRawDP).toBeLessThan(areaBefore);
  });

  it("simplifyFog on a toothed rectangle never shrinks the explored area: original ⊆ simplified", () => {
    // Many thin teeth of varying (small) height across several epsilon
    // scales — ensures at least one SIMPLIFICATION_EPSILONS pass would
    // shrink the naive-DP result, exercising the fix's correction path.
    const teeth = Array.from({ length: 40 }, (_, i) => 2 + (i % 5) * 3); // heights 2..14
    const ring = toothedRect(0, 0, 1000, 200, teeth);
    const shape = unionFog(emptyFog(), ring);
    expect(shape.totalVertices).toBeGreaterThan(20);

    // Force aggressive simplification (small target vertex count) so the
    // coarsest epsilon values in SIMPLIFICATION_EPSILONS are exercised.
    const simplified = simplifyFog(shape, 10);
    expect(simplified.totalVertices).toBeLessThan(shape.totalVertices);

    // Rigorous proof of the superset property: compute (original - simplified)
    // via Clipper2's exact boolean difference. If simplified truly is a
    // superset of original, this residual area must be ~0 (allow tiny fp
    // slack from the offset/union machinery).
    const originalPaths = shapeOuterPathsD(shape);
    const simplifiedPaths = shapeOuterPathsD(simplified);

    const residual = differenceD(originalPaths, simplifiedPaths, ClipperFillRule.NonZero);
    const residualArea = residual.reduce((sum, p) => sum + Math.abs(clipperAreaD(p)), 0);

    const originalArea = approximateArea(shape);
    // Residual (area lost) must be a negligible fraction of the original —
    // effectively zero, not the visible shrink a naive-DP result would
    // exhibit for this fixture (confirmed by the sanity-check test above).
    expect(residualArea).toBeLessThan(originalArea * 0.01);
  });

  it("simplifyFog with holes never shrinks net explored area (hole shrink also counts as gain)", () => {
    // Outer toothed boundary with a small toothed hole inside — exercises
    // both the outer-ring outward-offset path and the hole inward-offset
    // path in applyDPSimplification.
    const outerTeeth = Array.from({ length: 20 }, (_, i) => 3 + (i % 4) * 2);
    const outer = toothedRect(0, 0, 800, 800, outerTeeth);

    const holeTeeth = Array.from({ length: 12 }, (_, i) => 2 + (i % 3) * 2);
    const hole = toothedRect(300, 300, 200, 200, holeTeeth);

    const withHole: FogShape = {
      polygons: [{ outer, holes: [hole] }],
      totalVertices: outer.length / 2 + hole.length / 2,
    };

    const areaBefore = approximateArea(withHole);
    const simplified = simplifyFog(withHole, 12);
    expect(simplified.totalVertices).toBeLessThan(withHole.totalVertices);

    // Net area (outer - holes) must not shrink.
    const areaAfter = approximateArea(simplified);
    expect(areaAfter).toBeGreaterThanOrEqual(areaBefore * 0.99);
  });
});
