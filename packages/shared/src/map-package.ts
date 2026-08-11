/**
 * Portable map package — a region map that can travel between worlds.
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
 * Three rules make it safe to hand around:
 *
 *  1. **`ownership` never travels** (DEC-MREG-07). It is a map of userIds, and
 *     the "tobias" of the origin server is not the "tobias" of the destination
 *     — importing it would either grant sight to the wrong person or point at
 *     nobody. What the party discovered is also that table's history; a new
 *     table starts discovering again.
 *  2. **Comments never travel.** They are that table's conversation, stamped
 *     with that table's players. Carrying them into another campaign would
 *     paste strangers' voices onto a fresh map.
 *  3. **The image travels by FILENAME.** `/assets/maps/godford.webp` is a path
 *     in the world that exported it. The importer picks the image on the way
 *     in and the package only says which file it expects.
 */

import { z } from "zod";
import { createDocumentId } from "./id.js";
import { FlagsSchema } from "./document.js";
import {
  RegionMapDocumentSchema,
  defaultRegionMapDocument,
  createGmPin,
  type MapPin,
  type RegionMapDocument,
} from "./region-map.js";

/**
 * Format version of the package. Bumped when the shape changes in a way an
 * older importer could not read correctly — the importer REFUSES what it does
 * not know rather than guessing at missing fields (REQ-MREG-023).
 *
 * v2: the region map became a document of its own (DEC-MREG-08). Pin
 * coordinates are normalised (0..1) instead of scene pixels, and the package
 * no longer carries grid configuration, which a map without a scene has no use
 * for.
 */
export const FUSION_MAP_FORMAT = 2;

/** One pin inside a package: what it IS, never who has seen it. */
export const FusionMapPinSchema = z.object({
  /** Normalised position on the image: 0 = left/top, 1 = right/bottom. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /** Label. */
  text: z.string().default(""),
  /** Longer description shown when the pin is opened. */
  description: z.string().default(""),
  /** Emoji/glyph drawn inside the marker. */
  icon: z.string().default(""),
  /**
   * Stable identity of this place across imports (REQ-MREG-024). Lifted out of
   * `flags.fusion.sourceId` so it reads at the top level of the file a human
   * is editing.
   */
  sourceId: z.string().nullable().default(null),
  /** Remaining namespaced flags. */
  flags: FlagsSchema.default(() => ({})),
});

export type FusionMapPin = z.infer<typeof FusionMapPinSchema>;

/** A whole region map, as it travels. */
export const FusionMapPackageSchema = z.object({
  format: z.number().int().positive(),
  name: z.string().min(1),
  /** Terrain image FILENAME (not a path) — see DEC-MREG-07. */
  image: z.string().nullable().default(null),
  imageWidth: z.number().int().positive().default(1000),
  imageHeight: z.number().int().positive().default(1000),
  /** Real-world width of the whole image, for the scale bar. 0 = no scale. */
  scaleValue: z.number().min(0).default(0),
  scaleUnits: z.string().default("km"),
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
 * Export a region map as a portable package.
 *
 * `ownership` and `comments` are not read at any point in this function — not
 * filtered out afterwards, never gathered in the first place. That is the
 * shape the rule deserves: a field that is never collected cannot leak through
 * a later refactor that forgets to strip it.
 */
export function regionMapToPackage(map: RegionMapDocument): FusionMapPackage {
  const pins: FusionMapPin[] = map.pins.map((pin) => {
    const flags = pin.flags as Record<string, unknown>;
    const sourceId = fusionFlag(flags, "sourceId");
    return FusionMapPinSchema.parse({
      x: pin.x,
      y: pin.y,
      text: pin.text,
      description: pin.description,
      icon: pin.icon,
      sourceId: typeof sourceId === "string" ? sourceId : null,
      flags: flagsWithoutSourceId(flags),
    });
  });

  return FusionMapPackageSchema.parse({
    format: FUSION_MAP_FORMAT,
    name: map.name,
    image: basename(map.image),
    imageWidth: map.imageWidth,
    imageHeight: map.imageHeight,
    scaleValue: map.scaleValue,
    scaleUnits: map.scaleUnits,
    pins,
  });
}

/** Where the importer found the terrain image in THIS world. */
export interface MapImportOptions {
  /** Asset path/URL of the terrain image chosen on the way in. */
  image: string | null;
  /** Document id to use; a fresh one is generated when absent. */
  mapId?: string;
}

/**
 * Turn a package into a region map with one hidden pin per entry.
 *
 * Every pin arrives as a GM pin at `{ default: NONE }` — the same state a pin
 * gets when the GM drops it by hand. Revealing is always an act taken at THIS
 * table, and a player pin from another campaign has no author here.
 */
export function mapPackageToRegionMap(pkg: unknown, opts: MapImportOptions): RegionMapDocument {
  const parsed = FusionMapPackageSchema.parse(pkg);

  if (parsed.format !== FUSION_MAP_FORMAT) {
    throw new Error(
      `Formato de pacote de mapa desconhecido: ${String(parsed.format)} ` +
        `(esta versão lê ${String(FUSION_MAP_FORMAT)}).`,
    );
  }

  const pins: MapPin[] = parsed.pins.map((pin) => {
    const flags = { ...(pin.flags as Record<string, unknown>) };
    if (pin.sourceId) {
      const fusion = { ...((flags["fusion"] as Record<string, unknown> | undefined) ?? {}) };
      fusion["sourceId"] = pin.sourceId;
      flags["fusion"] = fusion;
    }
    return createGmPin(createDocumentId(), {
      x: pin.x,
      y: pin.y,
      text: pin.text,
      description: pin.description,
      icon: pin.icon,
      flags: flags as Record<string, Record<string, unknown>>,
    });
  });

  const mapId = opts.mapId ?? createDocumentId();

  return RegionMapDocumentSchema.parse({
    ...defaultRegionMapDocument(mapId, parsed.name),
    image: opts.image,
    imageWidth: parsed.imageWidth,
    imageHeight: parsed.imageHeight,
    scaleValue: parsed.scaleValue,
    scaleUnits: parsed.scaleUnits,
    pins,
  });
}
