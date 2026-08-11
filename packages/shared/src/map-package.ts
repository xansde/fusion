/**
 * Portable map package — a region that can travel between worlds.
 *
 * Spec 34 §5.5 (REQ-MREG-018/019/022/023/024) and DEC-MREG-07.
 *
 * A GM prepares a region in one world and wants it in another: the next
 * campaign, another server, a friend's table. The map travels as a JSON file
 * next to the terrain image — small enough to read in a text editor, edit by
 * hand and send in a message. It is deliberately NOT a compendium pack (spec
 * 16): a pack is `pack.db` + manifest + licence, built for published,
 * versioned content, and that cost buys nothing for a GM copying their own map.
 *
 * Two rules make it safe to hand around, both from DEC-MREG-07:
 *
 *  1. **`ownership` never travels.** It is a map of userIds, and the "tobias"
 *     of the origin server is not the "tobias" of the destination — importing
 *     it would either grant sight to the wrong person or point at nobody. What
 *     the party discovered is also that table's history; a new table starts
 *     discovering again.
 *  2. **The image travels by FILENAME.** `/assets/maps/godford.webp` is a path
 *     in the world that exported it. The importer picks the image on the way
 *     in and the package only says which file it expects.
 */

import { z } from "zod";
import { createDocumentId } from "./id.js";
import { FlagsSchema } from "./document.js";
import {
  NoteDocumentSchema,
  SceneDocumentSchema,
  defaultNoteDocument,
  defaultSceneDocument,
  type NoteDocument,
  type SceneDocument,
} from "./scene.js";

/**
 * Format version of the package. Bumped when the shape changes in a way an
 * older importer could not read correctly — the importer REFUSES what it does
 * not know rather than guessing at missing fields (REQ-MREG-023).
 */
export const FUSION_MAP_FORMAT = 1;

/** One pin inside a package: what it IS, never who has seen it. */
export const FusionMapPinSchema = z.object({
  /** Position in scene pixel coordinates. */
  x: z.number(),
  y: z.number(),
  /** Label / tooltip. */
  text: z.string().nullable().default(null),
  /** Icon path, or null for the engine's neutral pin. */
  icon: z.string().nullable().default(null),
  iconSize: z.number().positive().default(40),
  elevation: z.number().default(0),
  /**
   * Stable identity of this place across imports (REQ-MREG-024). Lifted out of
   * `flags.fusion.sourceId` so it reads at the top level of the file a human
   * is editing.
   */
  sourceId: z.string().nullable().default(null),
  /**
   * Remaining namespaced flags — `flags.fusion.portal` above all, which is how
   * a region links to the scene it leads into (DEC-MREG-05).
   */
  flags: FlagsSchema.default(() => ({})),
});

export type FusionMapPin = z.infer<typeof FusionMapPinSchema>;

/** A whole region, as it travels. */
export const FusionMapPackageSchema = z.object({
  format: z.number().int().positive(),
  name: z.string().min(1),
  /** Terrain image FILENAME (not a path) — see DEC-MREG-07. */
  image: z.string().nullable().default(null),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** How much ground one grid unit covers, and in what unit (km for regions). */
  gridDistance: z.number().positive().default(4),
  gridUnits: z.string().default("km"),
  /** `flags.fusion.mapScale` of the scene: "region", "continent", "world". */
  mapScale: z.string().default("region"),
  pins: z.array(FusionMapPinSchema).default(() => []),
});

export type FusionMapPackage = z.infer<typeof FusionMapPackageSchema>;

/** Read `flags.fusion.<key>` without asserting the whole flag tree's shape. */
function fusionFlag(flags: unknown, key: string): unknown {
  if (!flags || typeof flags !== "object") return undefined;
  const fusion = (flags as Record<string, unknown>)["fusion"];
  if (!fusion || typeof fusion !== "object") return undefined;
  return (fusion as Record<string, unknown>)[key];
}

/** Everything in `flags` except `flags.fusion.sourceId`, which is lifted out. */
function flagsWithoutSourceId(flags: Record<string, unknown>): Record<string, unknown> {
  const fusion = flags["fusion"];
  if (!fusion || typeof fusion !== "object") return flags;
  const rest = { ...(fusion as Record<string, unknown>) };
  delete rest["sourceId"];
  if (Object.keys(rest).length === 0) {
    const out = { ...flags };
    delete out["fusion"];
    return out;
  }
  return { ...flags, fusion: rest };
}

/** The filename part of an asset path, which is all that travels. */
function basename(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? null;
}

/**
 * Export a region scene as a portable package.
 *
 * `ownership` is not read at any point in this function — not filtered out
 * afterwards, never gathered in the first place. That is the shape the rule
 * deserves: a field that is never collected cannot leak through a later
 * refactor that forgets to strip it.
 */
export function sceneToMapPackage(scene: SceneDocument): FusionMapPackage {
  const pins: FusionMapPin[] = scene.notes.map((note) => {
    const flags = note.flags as Record<string, unknown>;
    const sourceId = fusionFlag(flags, "sourceId");
    return FusionMapPinSchema.parse({
      x: note.x,
      y: note.y,
      text: note.text,
      icon: note.icon,
      iconSize: note.iconSize,
      elevation: note.elevation,
      sourceId: typeof sourceId === "string" ? sourceId : null,
      flags: flagsWithoutSourceId(flags),
    });
  });

  return FusionMapPackageSchema.parse({
    format: FUSION_MAP_FORMAT,
    name: scene.name,
    image: basename(scene.background),
    width: scene.width,
    height: scene.height,
    gridDistance: scene.grid.distance,
    gridUnits: scene.grid.units,
    mapScale: (fusionFlag(scene.flags, "mapScale") as string | undefined) ?? "region",
    pins,
  });
}

/** Where the importer found the terrain image in THIS world. */
export interface MapImportOptions {
  /** Asset path/URL of the terrain image chosen on the way in. */
  background: string | null;
  /** Scene id to use; a fresh one is generated when absent. */
  sceneId?: string;
}

/**
 * Turn a package into a scene with the region preset applied (REQ-MREG-001)
 * and one hidden pin per entry.
 *
 * Every pin is born `{ default: NONE }` — the same state a pin gets when the
 * GM drops it by hand. Revealing is always an act taken at THIS table.
 */
export function mapPackageToScene(pkg: unknown, opts: MapImportOptions): SceneDocument {
  const parsed = FusionMapPackageSchema.parse(pkg);

  if (parsed.format !== FUSION_MAP_FORMAT) {
    throw new Error(
      `Formato de pacote de mapa desconhecido: ${String(parsed.format)} ` +
        `(esta versão lê ${String(FUSION_MAP_FORMAT)}).`,
    );
  }

  const notes: NoteDocument[] = parsed.pins.map((pin) => {
    const flags = { ...(pin.flags as Record<string, unknown>) };
    if (pin.sourceId) {
      const fusion = { ...((flags["fusion"] as Record<string, unknown> | undefined) ?? {}) };
      fusion["sourceId"] = pin.sourceId;
      flags["fusion"] = fusion;
    }
    return NoteDocumentSchema.parse({
      ...defaultNoteDocument(createDocumentId()),
      x: pin.x,
      y: pin.y,
      text: pin.text,
      icon: pin.icon,
      iconSize: pin.iconSize,
      elevation: pin.elevation,
      flags,
    });
  });

  const sceneId = opts.sceneId ?? createDocumentId();

  return SceneDocumentSchema.parse({
    ...defaultSceneDocument(sceneId, parsed.name),
    width: parsed.width,
    height: parsed.height,
    background: opts.background,
    // The region preset of DEC-MREG-01, applied in one place so an imported
    // map and a hand-made one are configured identically.
    grid: {
      type: "gridless",
      size: 100,
      distance: parsed.gridDistance,
      units: parsed.gridUnits,
    },
    tokenVision: false,
    flags: { fusion: { mapScale: parsed.mapScale } },
    notes,
  });
}
