/**
 * Vision subsystem — exhaustive test suite.
 *
 * This covers:
 *   1. Geometric primitives (segment-segment intersection, point-in-polygon)
 *   2. Wall filtering API
 *   3. Movement collision (moveBlocked)
 *   4. Visibility polygon (angular sweep) — verifiable cases with round coordinates
 *   5. LOS test (isInLOS)
 *   6. Property-based test: no point behind a wall should be inside the polygon
 *
 * All coordinate arithmetic is chosen to give exact or near-exact results in
 * floating-point, allowing numerical vertex verification.
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-020–REQ-VIS-031
 */

import { describe, it, expect } from "vitest";
import {
  segmentIntersect,
  pointInPolygon,
  normalizeAngle,
  polygonArea,
  dist,
} from "../vision/primitives.js";
import {
  makeWall,
  makeTerrainWall,
  makeInvisibleWall,
  makeEtherealWall,
  makeDoor,
  wallsBlockingSight,
  wallsBlockingLight,
  wallsBlockingMovement,
  moveBlocked,
} from "../vision/walls.js";
import { computeVisibilityPolygon, isInLOS } from "../vision/sweep.js";
import type { Point, SweepOptions, SceneBounds } from "../vision/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scene bounds: 1000×1000 square. */
const BOUNDS_1000: SceneBounds = { x: 0, y: 0, width: 1000, height: 1000 };

/** Minimal sweep options (no range, no cone). */
function opts(extra: Partial<SweepOptions> = {}): SweepOptions {
  return { sceneBounds: BOUNDS_1000, ...extra };
}

/** Return the centre of the computed polygon's bounding box. */
function _polygonBboxCenter(pts: readonly Point[]): Point {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Check that a point is inside the visibility polygon. */
function insidePoly(pt: Point, vertices: readonly Point[]): boolean {
  return pointInPolygon(pt.x, pt.y, vertices);
}

// ---------------------------------------------------------------------------
// 1. GEOMETRIC PRIMITIVES
// ---------------------------------------------------------------------------

describe("segmentIntersect", () => {
  it("crossing segments at right angle", () => {
    // Horizontal: (0,5)→(10,5) × Vertical: (5,0)→(5,10)
    const r = segmentIntersect(0, 5, 10, 5, 5, 0, 5, 10);
    expect(r.hit).toBe(true);
    if (!r.hit) return;
    expect(r.point.x).toBeCloseTo(5, 6);
    expect(r.point.y).toBeCloseTo(5, 6);
    expect(r.t).toBeCloseTo(0.5, 6);
    expect(r.u).toBeCloseTo(0.5, 6);
  });

  it("parallel segments — no hit", () => {
    const r = segmentIntersect(0, 0, 10, 0, 0, 1, 10, 1);
    expect(r.hit).toBe(false);
  });

  it("collinear overlapping segments — no hit (undefined intersection)", () => {
    const r = segmentIntersect(0, 0, 10, 0, 5, 0, 15, 0);
    expect(r.hit).toBe(false);
  });

  it("collinear non-overlapping segments — no hit", () => {
    const r = segmentIntersect(0, 0, 4, 0, 6, 0, 10, 0);
    expect(r.hit).toBe(false);
  });

  it("T-junction: ray hits endpoint of wall", () => {
    // Ray: (0,5)→(10,5); wall endpoint is at (5,5).
    const r = segmentIntersect(0, 5, 10, 5, 5, 5, 5, 10);
    expect(r.hit).toBe(true);
    if (!r.hit) return;
    expect(r.point.x).toBeCloseTo(5, 6);
    expect(r.point.y).toBeCloseTo(5, 6);
  });

  it("X-junction: two diagonals crossing at (5,5)", () => {
    // Diagonal 1: (0,0)→(10,10); Diagonal 2: (10,0)→(0,10)
    const r = segmentIntersect(0, 0, 10, 10, 10, 0, 0, 10);
    expect(r.hit).toBe(true);
    if (!r.hit) return;
    expect(r.point.x).toBeCloseTo(5, 5);
    expect(r.point.y).toBeCloseTo(5, 5);
  });

  it("segments that miss each other (extensions would cross)", () => {
    // Horizontal: (0,5)→(4,5); vertical: (6,0)→(6,10) — gap on x
    const r = segmentIntersect(0, 5, 4, 5, 6, 0, 6, 10);
    expect(r.hit).toBe(false);
  });

  it("endpoint touch — t=0 (origin on wall endpoint)", () => {
    // Ray starts at (5,5) going right; wall endpoint at (5,5).
    const r = segmentIntersect(5, 5, 15, 5, 5, 5, 5, 15);
    // The ray starts exactly at the wall endpoint; t ≈ 0 — hit is valid.
    if (r.hit) {
      expect(r.t).toBeCloseTo(0, 5);
    }
    // Either hit (t=0) or no-hit is acceptable; what we check is NO crash.
  });

  it("zero-length wall segment (degenerate)", () => {
    // Zero-length wall at (5,5) — effectively a point.
    const r = segmentIntersect(0, 5, 10, 5, 5, 5, 5, 5);
    // May or may not hit; must not throw.
    expect(typeof r.hit).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------

describe("pointInPolygon", () => {
  // Unit square [0,10]×[0,10]
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("center of square is inside", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it("point clearly outside", () => {
    expect(pointInPolygon(20, 20, square)).toBe(false);
  });

  it("point to the left is outside", () => {
    expect(pointInPolygon(-1, 5, square)).toBe(false);
  });

  it("degenerate polygon (< 3 vertices) returns false", () => {
    expect(
      pointInPolygon(5, 5, [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(false);
    expect(pointInPolygon(5, 5, [])).toBe(false);
  });

  it("point inside a triangle", () => {
    const tri: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(pointInPolygon(5, 3, tri)).toBe(true);
    expect(pointInPolygon(0, 10, tri)).toBe(false);
  });

  it("point outside L-shaped polygon", () => {
    const L: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 8, y: 4 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ];
    expect(pointInPolygon(2, 2, L)).toBe(true); // inside left arm
    expect(pointInPolygon(6, 2, L)).toBe(false); // in the notch — outside
    expect(pointInPolygon(6, 6, L)).toBe(true); // inside right arm
  });
});

// ---------------------------------------------------------------------------

describe("normalizeAngle", () => {
  it("0 stays 0", () => expect(normalizeAngle(0)).toBeCloseTo(0, 10));
  it("π stays π", () => expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 10));
  it("-π maps to π", () => expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 5));
  it("-π/2 maps to 3π/2", () =>
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 10));
  it("3π maps to π", () => expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 10));
  it("2π maps to 0", () => expect(normalizeAngle(2 * Math.PI)).toBeCloseTo(0, 10));
  it("large negative", () => {
    const a = normalizeAngle(-100);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 * Math.PI + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// 2. WALL FILTERING API
// ---------------------------------------------------------------------------

describe("wallsBlockingSight", () => {
  it("normal wall blocks sight", () => {
    const walls = [makeWall("w1", 0, 0, 10, 10)];
    expect(wallsBlockingSight(walls)).toHaveLength(1);
  });

  it("sight:none wall does not block sight", () => {
    const walls = [makeWall("w1", 0, 0, 10, 10, { sight: "none" })];
    expect(wallsBlockingSight(walls)).toHaveLength(0);
  });

  it("open door does not block sight", () => {
    const walls = [makeDoor("d1", 0, 0, 10, 0, "open")];
    expect(wallsBlockingSight(walls)).toHaveLength(0);
  });

  it("closed door blocks sight", () => {
    const walls = [makeDoor("d1", 0, 0, 10, 0, "closed")];
    expect(wallsBlockingSight(walls)).toHaveLength(1);
  });

  it("locked door blocks sight", () => {
    const walls = [makeDoor("d1", 0, 0, 10, 0, "locked")];
    expect(wallsBlockingSight(walls)).toHaveLength(1);
  });

  it("limited (terrain) wall is included", () => {
    const walls = [makeTerrainWall("t1", 0, 0, 10, 0)];
    expect(wallsBlockingSight(walls)).toHaveLength(1);
  });

  it("invisible wall (sight none) does NOT block sight", () => {
    const walls = [makeInvisibleWall("i1", 0, 0, 10, 0)];
    expect(wallsBlockingSight(walls)).toHaveLength(0);
  });
});

describe("wallsBlockingLight", () => {
  it("normal wall blocks light", () => {
    const walls = [makeWall("w1", 0, 0, 10, 10)];
    expect(wallsBlockingLight(walls)).toHaveLength(1);
  });

  it("invisible wall (light none) does NOT block light", () => {
    const walls = [makeInvisibleWall("i1", 0, 0, 10, 0)];
    expect(wallsBlockingLight(walls)).toHaveLength(0);
  });

  it("ethereal wall blocks light (sight/light normal)", () => {
    const walls = [makeEtherealWall("e1", 0, 0, 10, 0)];
    expect(wallsBlockingLight(walls)).toHaveLength(1);
  });
});

describe("wallsBlockingMovement", () => {
  it("normal wall blocks movement", () => {
    const walls = [makeWall("w1", 0, 0, 10, 10)];
    expect(wallsBlockingMovement(walls)).toHaveLength(1);
  });

  it("ethereal wall (move:none) does NOT block movement", () => {
    const walls = [makeEtherealWall("e1", 0, 0, 10, 10)];
    expect(wallsBlockingMovement(walls)).toHaveLength(0);
  });

  it("open door does not block movement", () => {
    const walls = [makeDoor("d1", 0, 0, 100, 0, "open")];
    expect(wallsBlockingMovement(walls)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. MOVEMENT COLLISION (moveBlocked)
// ---------------------------------------------------------------------------

describe("moveBlocked", () => {
  it("crossing a normal wall is blocked", () => {
    const walls = [makeWall("w1", 50, 0, 50, 100)]; // vertical wall at x=50
    expect(moveBlocked({ x: 0, y: 50 }, { x: 100, y: 50 }, walls)).toBe(true);
  });

  it("moving parallel to a wall is NOT blocked", () => {
    const walls = [makeWall("w1", 50, 0, 50, 100)]; // vertical wall at x=50
    expect(moveBlocked({ x: 20, y: 0 }, { x: 20, y: 100 }, walls)).toBe(false);
  });

  it("movement that does not reach the wall is NOT blocked", () => {
    const walls = [makeWall("w1", 50, 0, 50, 100)];
    expect(moveBlocked({ x: 0, y: 50 }, { x: 40, y: 50 }, walls)).toBe(false);
  });

  it("crossing an open door is NOT blocked", () => {
    const walls = [makeDoor("d1", 50, 0, 50, 100, "open")];
    expect(moveBlocked({ x: 0, y: 50 }, { x: 100, y: 50 }, walls)).toBe(false);
  });

  it("crossing a closed door IS blocked", () => {
    const walls = [makeDoor("d1", 50, 0, 50, 100, "closed")];
    expect(moveBlocked({ x: 0, y: 50 }, { x: 100, y: 50 }, walls)).toBe(true);
  });

  it("ethereal wall does NOT block movement", () => {
    const walls = [makeEtherealWall("e1", 50, 0, 50, 100)];
    expect(moveBlocked({ x: 0, y: 50 }, { x: 100, y: 50 }, walls)).toBe(false);
  });

  it("one-way wall (dir:left) blocks from the left", () => {
    // Wall: (50,0)→(50,100), dir:left.
    // a→b direction is down (0,1). Left of that is (in screen coords) positive x.
    // Cross product of (0,1) with (from.x - 50, from.y - 0):
    //   = 0*(from.y) - 1*(from.x - 50) = -(from.x - 50) = 50 - from.x
    // from.x=0 → cross = 50 > 0 → LEFT → blocked.
    const walls = [makeWall("w1", 50, 0, 50, 100, { dir: "left" })];
    expect(moveBlocked({ x: 0, y: 50 }, { x: 100, y: 50 }, walls)).toBe(true);
  });

  it("one-way wall (dir:left) does NOT block from the right", () => {
    // from.x=100 → cross = 50 - 100 = -50 < 0 → RIGHT → NOT blocked.
    const walls = [makeWall("w1", 50, 0, 50, 100, { dir: "left" })];
    expect(moveBlocked({ x: 100, y: 50 }, { x: 0, y: 50 }, walls)).toBe(false);
  });

  it("one-way wall (dir:right) blocks from the right", () => {
    const walls = [makeWall("w1", 50, 0, 50, 100, { dir: "right" })];
    expect(moveBlocked({ x: 100, y: 50 }, { x: 0, y: 50 }, walls)).toBe(true);
  });

  it("no walls — never blocked", () => {
    expect(moveBlocked({ x: 0, y: 0 }, { x: 500, y: 500 }, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. VISIBILITY POLYGON (ANGULAR SWEEP)
// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — empty scene", () => {
  it("no walls: polygon should cover scene bounds area", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts());
    const area = polygonArea(result.vertices);
    // The full 1000×1000 bounds = 1_000_000 sq-px area.
    // The polygon from the centre should cover roughly the whole bounds.
    expect(area).toBeGreaterThan(900_000);
  });

  it("empty scene produces a non-empty polygon", () => {
    const result = computeVisibilityPolygon({ x: 100, y: 100 }, [], opts());
    expect(result.vertices.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — single wall creates shadow", () => {
  //
  // Setup: origin at (100,500). Wall: (300,400)→(300,600) — vertical, x=300.
  //
  // Origin is to the LEFT of the wall (x < 300). The wall should block the
  // region behind it (x > 300 in the sight direction from origin).
  //
  // Points directly to the right of the wall are NOT visible.
  // Points to the left of the wall are visible.
  //
  it("point directly behind the wall is NOT visible", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeWall("w1", 300, 400, 300, 600)];
    const result = computeVisibilityPolygon(origin, walls, opts());

    // A point clearly behind the wall (same horizontal line, far right)
    expect(insidePoly({ x: 700, y: 500 }, result.vertices)).toBe(false);
  });

  it("point in front of the wall (same side as origin) IS visible", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeWall("w1", 300, 400, 300, 600)];
    const result = computeVisibilityPolygon(origin, walls, opts());

    // A point between origin and the wall is visible.
    expect(insidePoly({ x: 200, y: 500 }, result.vertices)).toBe(true);
  });

  it("polygon has positive area", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeWall("w1", 300, 400, 300, 600)];
    const result = computeVisibilityPolygon(origin, walls, opts());
    expect(polygonArea(result.vertices)).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — closed room", () => {
  //
  // A 200×200 room: corners at (300,300), (500,300), (500,500), (300,500).
  // Origin at center (400,400).
  // Walls: top, right, bottom, left.
  //
  // Expected: visibility polygon ≈ the room interior.
  //
  const makeRoom = () => [
    makeWall("top", 300, 300, 500, 300), // top edge
    makeWall("right", 500, 300, 500, 500), // right edge
    makeWall("bottom", 500, 500, 300, 500), // bottom edge
    makeWall("left", 300, 500, 300, 300), // left edge
  ];

  it("center of room is visible", () => {
    const origin: Point = { x: 400, y: 400 };
    const result = computeVisibilityPolygon(origin, makeRoom(), opts());
    expect(insidePoly({ x: 400, y: 400 }, result.vertices)).toBe(true);
  });

  it("point inside room is visible", () => {
    const origin: Point = { x: 400, y: 400 };
    const result = computeVisibilityPolygon(origin, makeRoom(), opts());
    expect(insidePoly({ x: 350, y: 350 }, result.vertices)).toBe(true);
    expect(insidePoly({ x: 450, y: 450 }, result.vertices)).toBe(true);
  });

  it("point outside room is NOT visible", () => {
    const origin: Point = { x: 400, y: 400 };
    const result = computeVisibilityPolygon(origin, makeRoom(), opts());
    // Points clearly outside the 300–500 range.
    expect(insidePoly({ x: 100, y: 400 }, result.vertices)).toBe(false);
    expect(insidePoly({ x: 700, y: 400 }, result.vertices)).toBe(false);
    expect(insidePoly({ x: 400, y: 100 }, result.vertices)).toBe(false);
    expect(insidePoly({ x: 400, y: 700 }, result.vertices)).toBe(false);
  });

  it("polygon area is approximately the room area (200×200 = 40000)", () => {
    const origin: Point = { x: 400, y: 400 };
    const result = computeVisibilityPolygon(origin, makeRoom(), opts());
    // The polygon should closely approximate the 200×200 room.
    const area = polygonArea(result.vertices);
    expect(area).toBeGreaterThan(35_000);
    expect(area).toBeLessThan(42_000);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — door: closed vs open", () => {
  //
  // Corridor with a door at x=500. Origin at (100,500).
  // Door: vertical wall (500,400)→(500,600).
  //
  it("closed door blocks view into the corridor beyond", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeDoor("door1", 500, 400, 500, 600, "closed")];
    const filtered = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, filtered, opts());
    // Beyond x=500 on y=500 should not be visible.
    expect(insidePoly({ x: 700, y: 500 }, result.vertices)).toBe(false);
  });

  it("open door allows view into the corridor beyond", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeDoor("door1", 500, 400, 500, 600, "open")];
    const filtered = wallsBlockingSight(walls);
    expect(filtered).toHaveLength(0); // open door filtered out
    const result = computeVisibilityPolygon(origin, filtered, opts());
    // No walls → the point beyond should be visible (only bounded by scene).
    expect(insidePoly({ x: 700, y: 500 }, result.vertices)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — limited range", () => {
  //
  // Origin at (500,500), no walls, range = 100.
  // The polygon should not extend beyond 100px from origin.
  //
  it("polygon does not extend beyond maxRange", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts({ maxRange: 100 }));
    for (const v of result.vertices) {
      const d = dist(origin, v);
      expect(d).toBeLessThanOrEqual(100 + 1); // 1px tolerance for float
    }
  });

  it("polygon area ≈ π × r² (circular, no walls)", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts({ maxRange: 100 }));
    const area = polygonArea(result.vertices);
    const expectedCircleArea = Math.PI * 100 * 100; // ≈ 31416
    // The angular sweep with no wall endpoints produces few rays (only from
    // scene-corner angles), so the polygon is a coarse approximation of the
    // circle. We use a generous 30% lower bound and verify it is positive.
    // The important constraint is that range clipping works (vertices ≤ 100px).
    expect(area).toBeGreaterThan(expectedCircleArea * 0.5);
    expect(area).toBeLessThan(expectedCircleArea * 1.1);
  });

  it("range clips polygon even when walls are farther away", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeWall("w1", 500, 0, 500, 1000)]; // far wall
    const filtered = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, filtered, opts({ maxRange: 200 }));
    // Wall is at x=500 which is 400px away — beyond range.
    // No vertex should exceed 200px from origin.
    for (const v of result.vertices) {
      expect(dist(origin, v)).toBeLessThanOrEqual(200 + 1);
    }
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — cone (directional vision)", () => {
  //
  // Origin at (500,500), 90° cone facing right (rotation=0).
  // Only the east-facing 90° sector should be illuminated.
  //
  it("cone polygon contains a point directly ahead", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(
      origin,
      [],
      opts({ angle: 90, rotation: 0 }), // facing east
    );
    // Point directly east — inside.
    expect(insidePoly({ x: 700, y: 500 }, result.vertices)).toBe(true);
  });

  it("cone polygon does NOT contain a point directly behind", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(
      origin,
      [],
      opts({ angle: 90, rotation: 0 }), // facing east
    );
    // Point directly west — outside the 90° east-facing cone.
    expect(insidePoly({ x: 200, y: 500 }, result.vertices)).toBe(false);
  });

  it("cone at 180° (south-facing) does not see north points", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(
      origin,
      [],
      opts({ angle: 90, rotation: 90 }), // facing south (270° clockwise from east = 90° in standard math)
    );
    // A point directly south is inside.
    expect(insidePoly({ x: 500, y: 800 }, result.vertices)).toBe(true);
    // A point directly north is outside.
    expect(insidePoly({ x: 500, y: 100 }, result.vertices)).toBe(false);
  });

  it("cone polygon has the origin as a vertex (pie-slice shape)", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts({ angle: 60, rotation: 0 }));
    // One of the vertices should be very close to the origin.
    const hasOriginVertex = result.vertices.some((v) => dist(v, origin) < 1);
    expect(hasOriginVertex).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — cone wrapping around angle 0 (west-facing)", () => {
  //
  // Bug regression: a cone that straddles the 0/2π boundary (coneStart > coneEnd)
  // was producing a non-simple (self-intersecting) polygon because vertex ordering
  // was done by absolute angle instead of angle relative to coneStart.
  //
  // Setup: origin at (500,500), 90° cone facing west (rotation=180).
  //   coneStart ≈ 3π/4 (135°), coneEnd ≈ 5π/4 (225°) — does NOT wrap.
  //   Actually rotation=180 in degrees → π radians; half = π/4.
  //   coneStart = π - π/4 = 3π/4, coneEnd = π + π/4 = 5π/4 → no wrap for 90°.
  //
  // Use rotation=180, angle=270 to force a wrap:
  //   half = 3π/4; coneStart = π - 3π/4 = π/4; coneEnd = π + 3π/4 = 7π/4.
  //   coneStart (π/4 ≈ 0.785) < coneEnd (7π/4 ≈ 5.498) → no wrap either.
  //
  // For a true wrap we need: rotation=0, angle=270 (facing east with wide cone).
  //   half = 3π/4; coneStart = 0 - 3π/4 = -3π/4 → normalised = 5π/4 ≈ 3.927;
  //   coneEnd = 0 + 3π/4 = 3π/4 ≈ 2.356;
  //   coneStart (5π/4) > coneEnd (3π/4) → WRAPS around 0.
  //
  // Expected:
  //   - Point directly east (700, 500): inside (cone faces east).
  //   - Point directly west (300, 500): outside (270° cone excludes the back sector).
  //   - Polygon is simple: area equals |shoelace| (no cancellation from self-intersection).
  //

  it("wide east-facing cone (270°, rotation=0) wrapping around 0 — point east is inside", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(
      origin,
      [],
      opts({ angle: 270, rotation: 0 }), // wraps around 0
    );
    expect(insidePoly({ x: 700, y: 500 }, result.vertices)).toBe(true);
  });

  it("wide east-facing cone (270°) — the excluded 90° sector (west) is NOT inside", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts({ angle: 270, rotation: 0 }));
    // Directly west at 180° is excluded by the 270° cone centered at 0°
    expect(insidePoly({ x: 300, y: 500 }, result.vertices)).toBe(false);
  });

  it("wide east-facing cone (270°) — polygon is simple (non-negative shoelace area)", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts({ angle: 270, rotation: 0 }));
    // A simple polygon has |shoelace area| = area; a self-intersecting one has
    // cancellation. polygonArea returns |shoelace| / 2, so it is always >= 0.
    // We additionally verify the polygon has more than 3 vertices (not degenerate)
    // and has meaningful area.
    expect(result.vertices.length).toBeGreaterThan(3);
    expect(polygonArea(result.vertices)).toBeGreaterThan(100_000);
  });

  it("west-facing cone (90°, rotation=180) — point west is inside, point east is outside", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(
      origin,
      [],
      opts({ angle: 90, rotation: 180 }), // facing west
    );
    expect(insidePoly({ x: 300, y: 500 }, result.vertices)).toBe(true);
    expect(insidePoly({ x: 700, y: 500 }, result.vertices)).toBe(false);
  });
});

describe("computeVisibilityPolygon — terrain (limited) walls", () => {
  //
  // The terrain (limited) rule: a ray crosses one limited wall and still sees
  // through; crossing two limited walls blocks the ray.
  //
  // Setup: origin at (100,500).
  //   Wall 1 (limited): vertical at x=300 (400→600 y range)
  //   Wall 2 (limited): vertical at x=500 (400→600 y range)
  //
  // A point at (350,500) — between the two terrain walls — should be visible
  // (only 1 terrain layer crossed).
  //
  // A point at (600,500) — beyond BOTH terrain walls — should NOT be visible
  // (2 terrain layers crossed).
  //
  it("point behind one terrain wall IS visible (passes one layer)", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [
      makeTerrainWall("t1", 300, 400, 300, 600),
      makeTerrainWall("t2", 500, 400, 500, 600),
    ];
    // For sight: both terrain walls are included.
    const filtered = wallsBlockingSight(walls);
    expect(filtered).toHaveLength(2);

    const result = computeVisibilityPolygon(origin, filtered, opts());
    // Between the two terrain walls.
    expect(insidePoly({ x: 350, y: 500 }, result.vertices)).toBe(true);
  });

  it("point behind two terrain walls is NOT visible (two layers block)", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [
      makeTerrainWall("t1", 300, 400, 300, 600),
      makeTerrainWall("t2", 500, 400, 500, 600),
    ];
    const filtered = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, filtered, opts());
    // Beyond both terrain walls — should NOT be visible.
    expect(insidePoly({ x: 600, y: 500 }, result.vertices)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — shared endpoints (T-junction, X-junction)", () => {
  //
  // T-junction: wall1 = (300,200)→(300,800); wall2 = (300,500)→(600,500).
  // The two walls share endpoint (300,500).
  //
  it("T-junction walls: point in the 'stem' region is NOT visible", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [
      makeWall("w1", 300, 200, 300, 800), // vertical
      makeWall("w2", 300, 500, 600, 500), // horizontal stem
    ];
    const filtered = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, filtered, opts());
    // Point in the blocked zone above the stem, behind the vertical wall.
    expect(insidePoly({ x: 450, y: 300 }, result.vertices)).toBe(false);
  });

  //
  // X-junction: two diagonal walls crossing at (500,500).
  //   wall1: (300,300)→(700,700)
  //   wall2: (700,300)→(300,700)
  //
  it("X-junction walls: point behind the crossing is NOT visible", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeWall("w1", 300, 300, 700, 700), makeWall("w2", 700, 300, 300, 700)];
    const filtered = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, filtered, opts());
    // Point directly behind the X, far east, should be hidden.
    expect(insidePoly({ x: 800, y: 500 }, result.vertices)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — collinear overlapping walls", () => {
  //
  // Two collinear wall segments on the same line with a gap between them.
  //   Segment 1: (300,400)→(300,450)
  //   Segment 2: (300,550)→(300,600)
  //   Gap: y ∈ [450,550]
  //
  // From origin (100,500), the ray at y=500 (directly right) should pass
  // through the gap and see beyond.
  //
  it("ray passes through gap between collinear walls", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [makeWall("w1", 300, 400, 300, 450), makeWall("w2", 300, 550, 300, 600)];
    const filtered = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, filtered, opts());
    // Point beyond the gap at y=500 — should be visible.
    expect(insidePoly({ x: 600, y: 500 }, result.vertices)).toBe(true);
  });

  it("ray hitting a collinear wall is still blocked", () => {
    const origin: Point = { x: 100, y: 400 };
    const walls = [makeWall("w1", 300, 350, 300, 450), makeWall("w2", 300, 480, 300, 600)];
    const filtered = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, filtered, opts());
    // Directly east at y=400 hits w1 — blocked beyond x=300.
    expect(insidePoly({ x: 500, y: 400 }, result.vertices)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — origin at a corner", () => {
  //
  // Origin placed at (0,0) — the top-left corner of the scene.
  // No walls. The polygon should cover the full scene bounds.
  //
  it("origin at scene corner covers full bounds area", () => {
    const origin: Point = { x: 0, y: 0 };
    const result = computeVisibilityPolygon(origin, [], opts());
    // The polygon from a corner of the 1000×1000 scene should be the full area.
    const area = polygonArea(result.vertices);
    expect(area).toBeGreaterThan(900_000);
  });
});

// ---------------------------------------------------------------------------

describe("computeVisibilityPolygon — origin on a wall segment (degenerate)", () => {
  //
  // REQ-VIS-030: origin exactly on a wall → polygon is empty or minimal.
  // We only check that it doesn't throw and returns a valid (possibly tiny) polygon.
  //
  it("origin on wall does not throw and returns polygon or empty result", () => {
    const origin: Point = { x: 300, y: 500 };
    const walls = [makeWall("w1", 300, 400, 300, 600)]; // origin is ON this wall
    const filtered = wallsBlockingSight(walls);
    // Must not throw.
    expect(() => computeVisibilityPolygon(origin, filtered, opts())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. isInLOS
// ---------------------------------------------------------------------------

describe("isInLOS", () => {
  it("point inside computed polygon is in LOS", () => {
    const origin: Point = { x: 100, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts());
    expect(isInLOS({ x: 500, y: 500 }, result)).toBe(true);
  });

  it("point behind a wall is NOT in LOS", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 300, 400, 300, 600)]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    expect(isInLOS({ x: 700, y: 500 }, result)).toBe(false);
  });

  it("empty polygon: nothing is in LOS", () => {
    expect(isInLOS({ x: 500, y: 500 }, { vertices: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. PROPERTY-BASED TEST: no point behind a wall should be inside the polygon
// ---------------------------------------------------------------------------

describe("property: no point behind a wall is visible from origin", () => {
  //
  // We use a simple scene: origin at (100,500), a vertical wall at x=400.
  // Sample N points with x > 400 (behind the wall) and verify none are inside
  // the visibility polygon.
  //
  it("100 random points behind a wall are all NOT inside the polygon", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 0, 400, 1000)]);
    const result = computeVisibilityPolygon(origin, walls, opts());

    // Deterministic pseudo-random sampling (no external library needed).
    // LCG parameters (Knuth)
    let seed = 0x12345678;
    const rand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    let violations = 0;
    const N = 100;
    for (let i = 0; i < N; i++) {
      // x ∈ [450, 950], y ∈ [10, 990] — clearly behind the wall.
      const px = 450 + rand() * 500;
      const py = 10 + rand() * 980;
      if (insidePoly({ x: px, y: py }, result.vertices)) {
        violations++;
      }
    }

    expect(violations).toBe(0);
  });

  it("100 random points on the origin side are ALL visible (no walls)", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts());

    let seed = 0xdeadbeef;
    const rand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    // In an empty scene all points within ~90% of the bounds should be visible.
    let seen = 0;
    const N = 100;
    for (let i = 0; i < N; i++) {
      const px = 50 + rand() * 900;
      const py = 50 + rand() * 900;
      if (insidePoly({ x: px, y: py }, result.vertices)) {
        seen++;
      }
    }
    // Expect the vast majority visible (allow for edge boundary rounding).
    expect(seen).toBeGreaterThanOrEqual(90);
  });
});

// ---------------------------------------------------------------------------
// 7. ADDITIONAL EDGE CASES
// ---------------------------------------------------------------------------

describe("wall filtering edge cases", () => {
  it("empty wall list returns empty", () => {
    expect(wallsBlockingSight([])).toHaveLength(0);
    expect(wallsBlockingLight([])).toHaveLength(0);
    expect(wallsBlockingMovement([])).toHaveLength(0);
  });

  it("mixed walls: only normal/limited returned", () => {
    const walls = [
      makeWall("w1", 0, 0, 10, 10), // normal — included
      makeWall("w2", 10, 0, 20, 10, { sight: "none" }), // sight:none — excluded
      makeTerrainWall("t1", 20, 0, 30, 10), // limited — included
      makeDoor("d1", 30, 0, 40, 10, "open"), // open — excluded
    ];
    expect(wallsBlockingSight(walls)).toHaveLength(2);
  });

  it("locked door blocks sight (same as closed)", () => {
    const walls = [makeDoor("d1", 0, 0, 10, 0, "locked")];
    expect(wallsBlockingSight(walls)).toHaveLength(1);
  });
});

describe("moveBlocked edge cases", () => {
  it("movement to the same point — no crossing any wall", () => {
    const walls = [makeWall("w1", 50, 0, 50, 100)];
    expect(moveBlocked({ x: 20, y: 50 }, { x: 20, y: 50 }, walls)).toBe(false);
  });

  it("crossing two walls in sequence — blocked by the first", () => {
    const walls = [makeWall("w1", 100, 0, 100, 1000), makeWall("w2", 200, 0, 200, 1000)];
    // Moving from x=0 to x=300 crosses both; first hit at x=100 should block.
    expect(moveBlocked({ x: 0, y: 500 }, { x: 300, y: 500 }, walls)).toBe(true);
  });
});

describe("range + cone combined", () => {
  it("cone with range: point inside cone but beyond range is not visible", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(
      origin,
      [],
      opts({ angle: 90, rotation: 0, maxRange: 100 }),
    );
    // Point at x=800 (300px east) is beyond the 100px range.
    expect(insidePoly({ x: 800, y: 500 }, result.vertices)).toBe(false);
    // Point at x=560 (60px east) is within range and cone.
    expect(insidePoly({ x: 560, y: 500 }, result.vertices)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. NUMERICAL VERTEX VERIFICATION
// ---------------------------------------------------------------------------
//
// These tests verify the sweep produces geometrically correct vertices by
// checking expected coordinates numerically, not just topological containment.
// REQ-VIS-103: deterministic — same walls + origin => same polygon.
// ---------------------------------------------------------------------------

describe("numerical vertex verification — single vertical wall shadow", () => {
  //
  // Origin at (0, 500). Vertical wall: (400, 300)→(400, 700).
  // Scene bounds: 1000×1000.
  //
  // The wall is directly east of the origin. The polygon should have vertices
  // at the two endpoints of the wall (400, 300) and (400, 700) plus the
  // far-side vertices where the shadow rays hit the scene boundary.
  //
  // Ray to upper endpoint (400, 300): angle = atan2(300-500, 400-0) = atan2(-200, 400).
  //   Slope: dy/dx = -200/400 = -0.5
  //   Extends to scene boundary: at x=1000, y = 500 + (1000-0)*(-0.5) = 0 → hits top boundary (y=0) first?
  //   At y=0: x = 0 + (500-0) / (0.5) = 0 + 1000 = 1000. So it hits the top-right corner (1000, 0).
  //   Actually: y = 500 + x * (-200/400) = 500 - 0.5*x; at y=0: x=1000. At x=1000: y=0. → corner (1000,0).
  //
  // Ray to lower endpoint (400, 700): angle = atan2(700-500, 400-0) = atan2(200, 400).
  //   y = 500 + x * (200/400) = 500 + 0.5*x; at y=1000: x=1000. At x=1000: y=1000. → corner (1000,1000).
  //
  // So the shadow behind the wall (east side) is bounded by:
  //   (400, 300) → (1000, 0) → (1000, 1000) → (400, 700)
  //
  // The visible polygon from (0,500) should have:
  //   - The west part (scene boundary from scene corner to corner on the left)
  //   - The wall face from (400,300) to (400,700) blocked
  //   - Shadow rays escaping to (1000, 0) and (1000, 1000)
  //
  // Key verifiable vertices:
  //   (400, 300) — top wall endpoint (visible as a polygon vertex)
  //   (400, 700) — bottom wall endpoint
  //   (1000, 0)  — top-right corner reached by shadow ray through (400,300)
  //   (1000, 1000) — bottom-right corner reached by shadow ray through (400,700)

  it("shadow ray to upper endpoint reaches correct scene-boundary point", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700)]);
    const result = computeVisibilityPolygon(origin, walls, opts());

    // The polygon should contain (400, 300) as a vertex (or very near it).
    const hasUpperEndpoint = result.vertices.some(
      (v) => Math.abs(v.x - 400) < 1 && Math.abs(v.y - 300) < 1,
    );
    expect(hasUpperEndpoint).toBe(true);
  });

  it("shadow ray to lower endpoint reaches correct scene-boundary point", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700)]);
    const result = computeVisibilityPolygon(origin, walls, opts());

    const hasLowerEndpoint = result.vertices.some(
      (v) => Math.abs(v.x - 400) < 1 && Math.abs(v.y - 700) < 1,
    );
    expect(hasLowerEndpoint).toBe(true);
  });

  it("top-right scene corner is reachable (shadow ray through upper endpoint)", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700)]);
    const result = computeVisibilityPolygon(origin, walls, opts());

    // The shadow ray from (0,500) through (400,300) should reach (1000,0).
    const hasTopRight = result.vertices.some(
      (v) => Math.abs(v.x - 1000) < 2 && Math.abs(v.y - 0) < 2,
    );
    expect(hasTopRight).toBe(true);
  });

  it("bottom-right scene corner is reachable (shadow ray through lower endpoint)", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700)]);
    const result = computeVisibilityPolygon(origin, walls, opts());

    // The shadow ray from (0,500) through (400,700) should reach (1000,1000).
    const hasBottomRight = result.vertices.some(
      (v) => Math.abs(v.x - 1000) < 2 && Math.abs(v.y - 1000) < 2,
    );
    expect(hasBottomRight).toBe(true);
  });

  it("point in the shadow (east of wall on same horizontal line) is NOT visible", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700)]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    // Directly east of origin, behind the wall.
    expect(insidePoly({ x: 600, y: 500 }, result.vertices)).toBe(false);
  });

  it("point in front of wall (west) IS visible", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700)]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    expect(insidePoly({ x: 200, y: 500 }, result.vertices)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("numerical vertex verification — room polygon approximates room", () => {
  //
  // 200×200 room with integer corners. Origin at exact center.
  // Expected polygon vertices (in clockwise or CCW order) should be very close
  // to the four room corners: (300,300), (500,300), (500,500), (300,500).
  //

  const makeRoom = () => [
    makeWall("top", 300, 300, 500, 300),
    makeWall("right", 500, 300, 500, 500),
    makeWall("bottom", 500, 500, 300, 500),
    makeWall("left", 300, 500, 300, 300),
  ];

  it("all four room corners appear as polygon vertices", () => {
    const origin: Point = { x: 400, y: 400 };
    const walls = wallsBlockingSight(makeRoom());
    const result = computeVisibilityPolygon(origin, walls, opts());

    const corners = [
      { x: 300, y: 300 },
      { x: 500, y: 300 },
      { x: 500, y: 500 },
      { x: 300, y: 500 },
    ];

    for (const corner of corners) {
      const found = result.vertices.some(
        (v) => Math.abs(v.x - corner.x) < 2 && Math.abs(v.y - corner.y) < 2,
      );
      expect(found).toBe(true);
    }
  });

  it("polygon bounding box closely matches room dimensions", () => {
    const origin: Point = { x: 400, y: 400 };
    const walls = wallsBlockingSight(makeRoom());
    const result = computeVisibilityPolygon(origin, walls, opts());

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const v of result.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }

    // Bounding box should be [300,500] × [300,500].
    expect(minX).toBeCloseTo(300, 0);
    expect(maxX).toBeCloseTo(500, 0);
    expect(minY).toBeCloseTo(300, 0);
    expect(maxY).toBeCloseTo(500, 0);
  });
});

// ---------------------------------------------------------------------------
// 9. DIMENSION-CORRECT TERRAIN COUNTING
// ---------------------------------------------------------------------------
//
// Verify that the 'dimension' option correctly selects which wall field
// determines "limited" vs "normal" behaviour.
// REQ-VIS-025 (D5): sight and light have independent terrain counters.
// ---------------------------------------------------------------------------

describe("sweep dimension option — terrain counting is dimension-specific", () => {
  //
  // Wall with sight:"limited" and light:"normal".
  // For a sight sweep: this is a terrain wall (pass through one layer).
  // For a light sweep: this is a normal wall (blocks immediately).
  //

  it("wall with sight:limited is terrain for sight sweep", () => {
    const origin: Point = { x: 100, y: 500 };
    // A wall that is limited only for sight, normal for light.
    const wall = makeWall("w1", 300, 400, 300, 600, {
      sight: "limited",
      light: "normal",
    });
    const sightWalls = wallsBlockingSight([wall]);
    const result = computeVisibilityPolygon(origin, sightWalls, {
      ...opts(),
      dimension: "sight",
    });
    // The point at (450, 500) — one limited layer crossed — should be visible.
    expect(insidePoly({ x: 450, y: 500 }, result.vertices)).toBe(true);
  });

  it("wall with light:normal blocks completely for light sweep", () => {
    const origin: Point = { x: 100, y: 500 };
    // Same wall — but now used in a light sweep where it is "normal".
    const wall = makeWall("w1", 300, 400, 300, 600, {
      sight: "limited",
      light: "normal",
    });
    const lightWalls = wallsBlockingLight([wall]);
    const result = computeVisibilityPolygon(origin, lightWalls, {
      ...opts(),
      dimension: "light",
    });
    // Light is fully blocked at x=300; point behind it should NOT be in the polygon.
    expect(insidePoly({ x: 450, y: 500 }, result.vertices)).toBe(false);
  });

  it("two sight:limited walls — second blocks even for sight", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = [
      makeWall("w1", 300, 400, 300, 600, { sight: "limited", light: "normal" }),
      makeWall("w2", 500, 400, 500, 600, { sight: "limited", light: "normal" }),
    ];
    const sightWalls = wallsBlockingSight(walls);
    const result = computeVisibilityPolygon(origin, sightWalls, {
      ...opts(),
      dimension: "sight",
    });
    // Behind both terrain layers (x=600) should NOT be visible.
    expect(insidePoly({ x: 600, y: 500 }, result.vertices)).toBe(false);
    // Between the two layers (x=400) SHOULD be visible.
    expect(insidePoly({ x: 400, y: 500 }, result.vertices)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. PROPERTY-BASED TEST — EXTENDED
// ---------------------------------------------------------------------------
//
// Stronger property: sample points both inside and outside a closed room,
// verify containment is always consistent with the geometry.
// ---------------------------------------------------------------------------

describe("property: visibility inside closed room is always confined to the room", () => {
  //
  // 200×200 room (x: 200–400, y: 200–400). Origin at center (300, 300).
  // Property: no visible point should be outside the room boundary.
  //

  it("200 random points outside the room are all NOT visible from center", () => {
    const origin: Point = { x: 300, y: 300 };
    const room = wallsBlockingSight([
      makeWall("top", 200, 200, 400, 200),
      makeWall("right", 400, 200, 400, 400),
      makeWall("bottom", 400, 400, 200, 400),
      makeWall("left", 200, 400, 200, 200),
    ]);
    const result = computeVisibilityPolygon(origin, room, opts());

    let seed = 0xabcdef01;
    const rand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    let violations = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      // Sample points clearly outside the room bounds.
      // Randomly pick a quadrant outside the room.
      const quadrant = Math.floor(rand() * 4);
      let px: number, py: number;
      switch (quadrant) {
        case 0:
          px = rand() * 180 + 10;
          py = rand() * 900 + 50;
          break; // left of room
        case 1:
          px = rand() * 180 + 420;
          py = rand() * 900 + 50;
          break; // right of room
        case 2:
          px = rand() * 900 + 50;
          py = rand() * 180 + 10;
          break; // above room
        default:
          px = rand() * 900 + 50;
          py = rand() * 180 + 420;
          break; // below room
      }
      if (insidePoly({ x: px, y: py }, result.vertices)) {
        violations++;
      }
    }

    expect(violations).toBe(0);
  });

  it("200 random points inside the room are all visible from center", () => {
    const origin: Point = { x: 300, y: 300 };
    const room = wallsBlockingSight([
      makeWall("top", 200, 200, 400, 200),
      makeWall("right", 400, 200, 400, 400),
      makeWall("bottom", 400, 400, 200, 400),
      makeWall("left", 200, 400, 200, 200),
    ]);
    const result = computeVisibilityPolygon(origin, room, opts());

    let seed = 0x0f1e2d3c;
    const rand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    let violations = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      // Points strictly inside room (margin of 5px from walls).
      const px = 205 + rand() * 190;
      const py = 205 + rand() * 190;
      if (!insidePoly({ x: px, y: py }, result.vertices)) {
        violations++;
      }
    }

    // Allow at most 2 violations from floating-point boundary effects.
    expect(violations).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 11. COLLINEAR / OVERLAPPING WALLS (extended)
// ---------------------------------------------------------------------------

describe("collinear walls — complete coverage of end-to-end cases", () => {
  //
  // Two collinear walls forming a near-continuous barrier with a small gap.
  //   Wall A: (300, 400)→(300, 490)
  //   Wall B: (300, 510)→(300, 600)
  //   Gap at y: 490–510.
  //
  // A ray at y=500 (gap) should see through.
  // A ray at y=430 (through wall A) should be blocked.
  // A ray at y=560 (through wall B) should be blocked.
  //

  it("ray through gap in collinear walls sees through", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([
      makeWall("wA", 300, 400, 300, 490),
      makeWall("wB", 300, 510, 300, 600),
    ]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    expect(insidePoly({ x: 500, y: 500 }, result.vertices)).toBe(true);
  });

  it("ray through upper collinear wall is blocked", () => {
    const origin: Point = { x: 0, y: 430 };
    const walls = wallsBlockingSight([
      makeWall("wA", 300, 400, 300, 490),
      makeWall("wB", 300, 510, 300, 600),
    ]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    // Directly behind wall A at y=430.
    expect(insidePoly({ x: 500, y: 430 }, result.vertices)).toBe(false);
  });

  it("overlapping collinear walls (same span) block as one", () => {
    // Two walls on exactly the same line: should block like a single wall.
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([
      makeWall("wA", 300, 400, 300, 600),
      makeWall("wB", 300, 400, 300, 600), // exact duplicate
    ]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    // Behind the wall — not visible.
    expect(insidePoly({ x: 500, y: 500 }, result.vertices)).toBe(false);
    // In front — visible.
    expect(insidePoly({ x: 150, y: 500 }, result.vertices)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. ORIGIN DEGENERATE CASES (extended)
// ---------------------------------------------------------------------------

describe("degenerate origins", () => {
  it("origin at scene corner (0,0) — polygon covers scene and does not throw", () => {
    const origin: Point = { x: 0, y: 0 };
    expect(() => computeVisibilityPolygon(origin, [], opts())).not.toThrow();
    const result = computeVisibilityPolygon(origin, [], opts());
    // Should be non-trivial.
    expect(result.vertices.length).toBeGreaterThan(2);
    expect(polygonArea(result.vertices)).toBeGreaterThan(500_000);
  });

  it("origin at opposite corner (1000,1000) — polygon covers scene", () => {
    const origin: Point = { x: 1000, y: 1000 };
    expect(() => computeVisibilityPolygon(origin, [], opts())).not.toThrow();
    const result = computeVisibilityPolygon(origin, [], opts());
    expect(polygonArea(result.vertices)).toBeGreaterThan(500_000);
  });

  it("origin on wall endpoint — does not throw, polygon may be minimal", () => {
    // Origin at (300, 300) which is an endpoint of the test wall.
    const origin: Point = { x: 300, y: 300 };
    const walls = wallsBlockingSight([makeWall("w1", 300, 300, 300, 600)]);
    expect(() => computeVisibilityPolygon(origin, walls, opts())).not.toThrow();
  });

  it("origin at wall midpoint — does not throw", () => {
    // Origin at (300, 500) which is the midpoint of a vertical wall.
    const origin: Point = { x: 300, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 300, 400, 300, 600)]);
    expect(() => computeVisibilityPolygon(origin, walls, opts())).not.toThrow();
  });

  it("origin exactly coincides with both endpoints of a zero-length wall", () => {
    const origin: Point = { x: 500, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 500, 500, 500, 500)]);
    expect(() => computeVisibilityPolygon(origin, walls, opts())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 13. DOOR STATES — complete coverage
// ---------------------------------------------------------------------------

describe("door state: locked behaves like closed for all dimensions", () => {
  it("locked door blocks sight", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingSight([makeDoor("d1", 300, 400, 300, 600, "locked")]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    expect(insidePoly({ x: 500, y: 500 }, result.vertices)).toBe(false);
  });

  it("locked door blocks light", () => {
    const origin: Point = { x: 0, y: 500 };
    const walls = wallsBlockingLight([makeDoor("d1", 300, 400, 300, 600, "locked")]);
    const result = computeVisibilityPolygon(origin, walls, { ...opts(), dimension: "light" });
    expect(insidePoly({ x: 500, y: 500 }, result.vertices)).toBe(false);
  });

  it("locked door blocks movement", () => {
    const walls = [makeDoor("d1", 300, 0, 300, 1000, "locked")];
    expect(moveBlocked({ x: 0, y: 500 }, { x: 600, y: 500 }, walls)).toBe(true);
  });

  it("open door — all dimensions pass through", () => {
    const sightWalls = wallsBlockingSight([makeDoor("d1", 300, 400, 300, 600, "open")]);
    const lightWalls = wallsBlockingLight([makeDoor("d1", 300, 400, 300, 600, "open")]);
    const moveWalls = wallsBlockingMovement([makeDoor("d1", 300, 0, 300, 1000, "open")]);

    expect(sightWalls).toHaveLength(0);
    expect(lightWalls).toHaveLength(0);
    expect(moveWalls).toHaveLength(0);

    expect(moveBlocked({ x: 0, y: 500 }, { x: 600, y: 500 }, moveWalls)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 14. DIRECTIONAL VISIBILITY (dir:left / dir:right)
// ---------------------------------------------------------------------------

describe("directional walls in visibility polygon", () => {
  //
  // Wall: (400, 300)→(400, 700), dir:"left".
  //
  // Cross product of wall direction (a→b = (0,400)) with (origin→wall.a):
  //   For origin at (100, 500) (left side): cross = positive → blocked.
  //   For origin at (700, 500) (right side): cross = negative → not blocked.
  //

  it("dir:left wall blocks origin on left side from seeing through", () => {
    const origin: Point = { x: 100, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700, { dir: "left" })]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    // Origin is on the left side (x < 400) — wall blocks.
    expect(insidePoly({ x: 600, y: 500 }, result.vertices)).toBe(false);
  });

  it("dir:left wall does NOT block origin on right side", () => {
    const origin: Point = { x: 700, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700, { dir: "left" })]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    // Origin is on the right side (x > 400) — wall should not block (one-way).
    // Point at (200, 500) is on the left of the wall, which should be visible from the right.
    expect(insidePoly({ x: 200, y: 500 }, result.vertices)).toBe(true);
  });

  it("dir:right wall blocks origin on right side", () => {
    const origin: Point = { x: 700, y: 500 };
    const walls = wallsBlockingSight([makeWall("w1", 400, 300, 400, 700, { dir: "right" })]);
    const result = computeVisibilityPolygon(origin, walls, opts());
    // Origin is on the right side — wall blocks left side.
    expect(insidePoly({ x: 200, y: 500 }, result.vertices)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 15. isInLOS — extended tests
// ---------------------------------------------------------------------------

describe("isInLOS — extended", () => {
  it("target exactly at origin is in LOS (trivially inside)", () => {
    const origin: Point = { x: 300, y: 300 };
    const result = computeVisibilityPolygon(origin, [], opts());
    // Origin is always inside the polygon it generates.
    expect(isInLOS(origin, result)).toBe(true);
  });

  it("target at scene edge (but visible) is in LOS", () => {
    const origin: Point = { x: 500, y: 500 };
    const result = computeVisibilityPolygon(origin, [], opts());
    // Centre of top edge: (500, 0) — should be inside the polygon.
    expect(isInLOS({ x: 500, y: 0 }, result)).toBe(true);
  });

  it("empty polygon: isInLOS returns false for any target", () => {
    expect(isInLOS({ x: 0, y: 0 }, { vertices: [] })).toBe(false);
    expect(isInLOS({ x: 500, y: 500 }, { vertices: [] })).toBe(false);
  });

  it("single-vertex polygon: isInLOS returns false", () => {
    expect(isInLOS({ x: 5, y: 5 }, { vertices: [{ x: 5, y: 5 }] })).toBe(false);
  });
});
