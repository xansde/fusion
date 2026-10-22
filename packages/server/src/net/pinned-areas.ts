/**
 * Pinned area templates (burst / cone / line / emanation) — persistence.
 *
 * A pinned area lives in the Scene's own `templates` array (declared by the Scene
 * schema since M2, unused until now), the same way map pins live in `Scene.notes`:
 * it survives a server restart and dies with its scene. The live broadcast stays
 * on the ephemeral channel (ephemeral-handlers.ts); this module is only the
 * storage.
 *
 * Visibility is the scene's: a non-privileged user reaches the areas of the scene
 * on air only, and a scene that is off air answers exactly like a scene that does
 * not exist (`sceneIsInvisibleToRole`, net/redaction.ts). There is no per-area
 * "GM only" flag: an area is shown to whoever can see the scene.
 */

import { z } from "zod";
import type { DocumentStore } from "../documents/store.js";
import { DocumentNotFoundError } from "../documents/store.js";
import { sceneIsInvisibleToRole, sceneIsOnAir } from "./redaction.js";

export const AreaStyleSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  border: z.enum(["thin", "medium", "thick"]),
  fill: z.number().finite().min(0.1).max(0.7),
});

export const AreaTemplateSchema = z.object({
  kind: z.enum(["burst", "cone", "line", "emanation"]),
  sizeFt: z.number().finite().min(5).max(500),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }),
  direction: z.number().finite(),
  footprint: z
    .object({
      i: z.number().int(),
      j: z.number().int(),
      width: z.number().int().min(1).max(20),
      height: z.number().int().min(1).max(20),
    })
    .optional(),
  /** Emanation anchored to a token: clients recompute the area from the token. */
  tokenId: z.string().min(1).max(64).optional(),
  style: AreaStyleSchema.optional(),
});

export const PinnedAreaSchema = z.object({
  id: z.string().min(1).max(64),
  userId: z.string(),
  userName: z.string().optional(),
  template: AreaTemplateSchema,
});
export type PinnedArea = z.infer<typeof PinnedAreaSchema>;

/** Most pinned areas kept per scene (guards the size of the Scene row). */
export const MAX_PINNED_PER_SCENE = 50;

export interface LoadedAreas {
  /** True when the scene is on air (its areas may go to every player). */
  onAir: boolean;
  areas: PinnedArea[];
}

/**
 * The pinned areas of a scene as seen by `role`. `null` when the scene does not
 * exist or is invisible to that role (the two are indistinguishable on purpose).
 * Junk entries in the stored array are skipped.
 */
export function loadPinnedAreas(
  store: DocumentStore,
  sceneId: string,
  role: number,
): LoadedAreas | null {
  let scene: Record<string, unknown>;
  try {
    scene = store.get("scenes", sceneId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
  if (sceneIsInvisibleToRole(role, scene)) return null;
  const raw = scene["templates"];
  const areas: PinnedArea[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw as unknown[]) {
      const parsed = PinnedAreaSchema.safeParse(item);
      if (parsed.success) areas.push(parsed.data);
    }
  }
  return { onAir: sceneIsOnAir(scene), areas };
}

/** Rewrite the pinned areas of a scene (no broadcast: the ephemeral channel carries the change). */
export function savePinnedAreas(
  store: DocumentStore,
  sceneId: string,
  userId: string,
  areas: PinnedArea[],
): void {
  store.update("scenes", sceneId, { templates: areas }, { userId });
}
