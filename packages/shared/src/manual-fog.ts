/**
 * Manual fog of war ("névoa manual", Owlbear/Roll20 style).
 *
 * The table decided NOT to use vision or light: the GM paints what the players
 * can see. The scene stores an ordered list of reveal/cover shapes on top of a
 * base state; replaying it (last shape that contains a point wins) tells whether
 * any point of the map is covered.
 *
 * Representation choice (documented here, one place):
 *   - ops list, not a bitmap mask. A handful of shapes is a few hundred bytes,
 *     it is resolution-independent, trivially diffable and undoable, and the
 *     server can answer "is this point covered?" without rasterizing.
 *   - bounded: MANUAL_FOG_LIMITS caps shape count, points per shape and total
 *     coordinates, so a scene write stays small. "Cover all" / "Reveal all"
 *     reset the list (they replace `base` and empty `ops`), which is also the
 *     escape hatch when the budget runs out.
 *
 * The same functions run in the server (token redaction, schema) and in the
 * client (renderer, tools), so both sides agree on what "covered" means.
 */

import { z } from "zod";

export const MANUAL_FOG_LIMITS = {
  /** Max shapes kept in `ops`. */
  maxOps: 300,
  /** Max vertices of one polygon. */
  maxPolyPoints: 128,
  /** Max sample points of one brush stroke. */
  maxBrushPoints: 400,
  /** Max brush radius in scene pixels. */
  maxBrushRadius: 2000,
  /** Max numbers (x and y counted separately) across the whole list. */
  maxCoords: 20000,
} as const;

const finite = z.number().finite();

export const FogModeSchema = z.enum(["reveal", "cover"]);
export type FogMode = z.infer<typeof FogModeSchema>;

export const FogRectOpSchema = z.object({
  t: z.literal("rect"),
  m: FogModeSchema,
  x: finite,
  y: finite,
  w: finite.nonnegative(),
  h: finite.nonnegative(),
});

export const FogPolyOpSchema = z.object({
  t: z.literal("poly"),
  m: FogModeSchema,
  /** Flat [x0, y0, x1, y1, ...]; at least three vertices. */
  p: z
    .array(finite)
    .min(6)
    .max(MANUAL_FOG_LIMITS.maxPolyPoints * 2)
    .refine((p) => p.length % 2 === 0, "polygon needs an even number of coordinates"),
});

export const FogBrushOpSchema = z.object({
  t: z.literal("brush"),
  m: FogModeSchema,
  r: finite.min(1).max(MANUAL_FOG_LIMITS.maxBrushRadius),
  /** Flat [x0, y0, x1, y1, ...]; one point is a dab. */
  p: z
    .array(finite)
    .min(2)
    .max(MANUAL_FOG_LIMITS.maxBrushPoints * 2)
    .refine((p) => p.length % 2 === 0, "brush needs an even number of coordinates"),
});

export const FogOpSchema = z.discriminatedUnion("t", [
  FogRectOpSchema,
  FogPolyOpSchema,
  FogBrushOpSchema,
]);

export type FogOp = z.infer<typeof FogOpSchema>;

/** Number of coordinates an op contributes to the budget. */
function opCoordCount(op: FogOp): number {
  return op.t === "rect" ? 4 : op.p.length;
}

export const ManualFogSchema = z
  .object({
    /** Master switch per scene. Off = the players see the whole map. */
    enabled: z.boolean().default(false),
    /** State of the map before any op: "covered" (default) or "revealed". */
    base: z.enum(["covered", "revealed"]).default("covered"),
    ops: z
      .array(FogOpSchema)
      .max(MANUAL_FOG_LIMITS.maxOps)
      .default(() => []),
  })
  .superRefine((fog, ctx) => {
    let coords = 0;
    for (const op of fog.ops) coords += opCoordCount(op);
    if (coords > MANUAL_FOG_LIMITS.maxCoords) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `fog too complex: ${String(coords)} coordinates (max ${String(MANUAL_FOG_LIMITS.maxCoords)})`,
      });
    }
  });

export type ManualFog = z.infer<typeof ManualFogSchema>;

/** The fog a scene has before the GM ever touched it: off, everything covered. */
export function defaultManualFog(): ManualFog {
  return { enabled: false, base: "covered", ops: [] };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function pointInPolygon(p: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2] as number;
    const yi = p[i * 2 + 1] as number;
    const xj = p[j * 2] as number;
    const yj = p[j * 2 + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

function brushContains(p: readonly number[], r: number, x: number, y: number): boolean {
  const rSq = r * r;
  if (p.length === 2) {
    const ax = p[0] as number;
    const ay = p[1] as number;
    return distSqToSegment(x, y, ax, ay, ax, ay) <= rSq;
  }
  for (let i = 0; i + 3 < p.length; i += 2) {
    const d = distSqToSegment(
      x,
      y,
      p[i] as number,
      p[i + 1] as number,
      p[i + 2] as number,
      p[i + 3] as number,
    );
    if (d <= rSq) return true;
  }
  return false;
}

/** Does this op's shape contain the point? */
export function fogOpContains(op: FogOp, x: number, y: number): boolean {
  switch (op.t) {
    case "rect":
      return x >= op.x && x <= op.x + op.w && y >= op.y && y <= op.y + op.h;
    case "poly":
      return pointInPolygon(op.p, x, y);
    case "brush":
      return brushContains(op.p, op.r, x, y);
  }
}

/** Minimal shape the helpers need — a Scene's `manualFog` satisfies it. */
export interface ManualFogLike {
  readonly enabled?: boolean | undefined;
  readonly base?: "covered" | "revealed" | undefined;
  readonly ops?: readonly FogOp[] | undefined;
}

/** True when the scene has the fog on (absent field = off). */
export function manualFogIsActive(fog: ManualFogLike | null | undefined): boolean {
  return fog?.enabled === true;
}

/**
 * Is this scene point under the fog? Always false when the fog is off.
 * Replays the ops in order; the last one containing the point decides.
 */
export function isFogCovered(fog: ManualFogLike | null | undefined, x: number, y: number): boolean {
  if (!manualFogIsActive(fog)) return false;
  let covered = (fog?.base ?? "covered") === "covered";
  for (const op of fog?.ops ?? []) {
    if (fogOpContains(op, x, y)) covered = op.m === "cover";
  }
  return covered;
}

// ---------------------------------------------------------------------------
// Edits (pure; the client sends the result, the server revalidates it)
// ---------------------------------------------------------------------------

export type FogEditResult = { ok: true; fog: ManualFog } | { ok: false; reason: "too-complex" };

/** Append a shape. Fails (without changing anything) when the budget would be exceeded. */
export function appendFogOp(fog: ManualFog, op: FogOp): FogEditResult {
  const next: ManualFog = { ...fog, ops: [...fog.ops, op] };
  if (!ManualFogSchema.safeParse(next).success) return { ok: false, reason: "too-complex" };
  return { ok: true, fog: next };
}

/** Drop the most recent shape. */
export function undoFogOp(fog: ManualFog): ManualFog {
  return { ...fog, ops: fog.ops.slice(0, -1) };
}

/** "Cover all" / "Reveal all": a new base state and an empty list. */
export function resetFog(fog: ManualFog, base: "covered" | "revealed"): ManualFog {
  return { ...fog, base, ops: [] };
}
