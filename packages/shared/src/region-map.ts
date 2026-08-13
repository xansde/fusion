/**
 * region-map.ts — the region map as a document of its own.
 *
 * Spec: `34-mapa-de-regiao.md` (DEC-MREG-08 supersedes DEC-MREG-01),
 * `28-hub-do-jogador.md` (the Mapa panel of the System Window).
 *
 * ## Why this is not a Scene
 *
 * The first pass modelled a region as a `Scene` with a gridless preset, on the
 * grounds that all the plumbing already existed. In use that is wrong, and the
 * reason is the ACTIVE scene: a Scene is the place the table is standing in,
 * and there is exactly one of it. Opening the region map would mean pulling
 * every player off the battle map mid-fight; going back would mean re-activating
 * the encounter and restoring everyone's camera. A map you consult is not a
 * place you go — it is a reference sheet the table keeps at hand, which is why
 * it lives in the Hub's Mapa panel and never touches scene activation.
 *
 * Everything a Scene brings — tokens, vision, fog, grid, walls, initiative —
 * is dead weight for a picture with pins on it, and each of those subsystems
 * would need a "region scene" special case to stay out of the way.
 *
 * ## Who may drop a pin, and what it means
 *
 * Two authors, two defaults, and the difference is not cosmetic:
 *
 *  - **GM pin — born hidden** (`ownership.default = NONE`). The GM populates a
 *    region while preparing and reveals places one at a time; a pin that
 *    defaulted to visible would hand the map away as it was typed
 *    (REQ-DOC-056).
 *  - **Player pin — born visible to the table** (`ownership.default =
 *    OBSERVER`). A player marking "we camped here" is talking to the group. A
 *    hidden player pin would be a note to self the GM would then have to
 *    publish, which nobody would ever ask for.
 *
 * `authorId` records who dropped it, so a player pin never quietly becomes GM
 * canon, and the GM can tell prep from table annotation at a glance.
 *
 * ## Comments
 *
 * A pin carries an ordered list of comments, each stamped with its author.
 * They are the table's conversation about a place — the reason a player wants
 * a pin at all — and they follow the pin's own reveal: a viewer who cannot
 * read the pin's name does not receive its comments either (redaction is
 * server-side, this module only defines the shape).
 */

import { z } from "zod";
import {
  BaseDocumentSchema,
  FlagsSchema,
  OwnershipSchema,
  OwnershipLevel,
  defaultStats,
} from "./document.js";

/** 16-char document id, the same shape every document uses. */
const DocumentIdField = z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]");

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

/**
 * One comment on a pin.
 *
 * `authorName` is denormalised on purpose: a comment has to keep reading as
 * itself long after the user list changed, and resolving a name at render time
 * would make the whole comment list depend on a User document a player may not
 * even receive.
 */
export const PinCommentSchema = z.object({
  _id: DocumentIdField,
  /** Who wrote it. Never null — an unattributed comment is not a comment. */
  authorId: z.string(),
  /** Display name at the time of writing. */
  authorName: z.string().default("?"),
  text: z.string().min(1),
  /** Epoch milliseconds, server-stamped. */
  createdAt: z.number().int().default(0),
});

export type PinComment = z.infer<typeof PinCommentSchema>;

// ---------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------

/** Who dropped a pin — decides its default reveal and how it reads. */
export const PIN_KINDS = ["gm", "player"] as const;
export type PinKind = (typeof PIN_KINDS)[number];

/**
 * A pin on the region map.
 *
 * Positions are stored in **normalised image coordinates** (0..1 on each
 * axis), not pixels. The image behind a map gets replaced — a better render, a
 * bigger scan, a different crop of the same coastline — and pixel coordinates
 * would scatter every pin the moment it did. Normalised coordinates survive
 * any re-upload at the same aspect ratio, which is the case that actually
 * happens.
 */
export const MapPinSchema = z.object({
  _id: DocumentIdField,

  /** Normalised position on the image: 0 = left/top, 1 = right/bottom. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),

  /** The pin's name — what the label shows. */
  text: z.string().default(""),

  /** Longer description, shown when the pin is opened. */
  description: z.string().default(""),

  /** Emoji or short glyph drawn inside the pin. Free text, one or two chars. */
  icon: z.string().default(""),

  /** Who dropped it (REQ-MREG-026). */
  kind: z.enum(PIN_KINDS).default("gm"),
  authorId: z.string().nullable().default(null),
  authorName: z.string().default(""),

  /** The table's conversation about this place, oldest first. */
  comments: z.array(PinCommentSchema).default(() => []),

  /**
   * Per-user reveal state (REQ-DOC-056). `NONE` = the pin never reaches that
   * client, `LIMITED` = a rumour marker with no content, `OBSERVER`+ = the
   * whole pin. Defaults to hidden; `createPlayerPin` is what opens it up.
   */
  ownership: OwnershipSchema.default(() => ({ default: OwnershipLevel.NONE })),

  flags: FlagsSchema.default(() => ({})),
});

export type MapPin = z.infer<typeof MapPinSchema>;

/** A GM pin: born hidden, revealed deliberately. */
export function createGmPin(id: string, fields: Partial<MapPin> = {}): MapPin {
  return MapPinSchema.parse({
    _id: id,
    x: 0.5,
    y: 0.5,
    ...fields,
    kind: "gm",
    ownership: fields.ownership ?? { default: OwnershipLevel.NONE },
  });
}

/**
 * A player pin: born visible to the whole table.
 *
 * The author is also written as an explicit OWNER so that "may I edit this?"
 * stays true even if the GM later changes the default level.
 */
export function createPlayerPin(
  id: string,
  authorId: string,
  authorName: string,
  fields: Partial<MapPin> = {},
): MapPin {
  return MapPinSchema.parse({
    _id: id,
    x: 0.5,
    y: 0.5,
    ...fields,
    kind: "player",
    authorId,
    authorName,
    ownership: {
      default: OwnershipLevel.OBSERVER,
      [authorId]: OwnershipLevel.OWNER,
    },
  });
}

// ---------------------------------------------------------------------------
// Region map document
// ---------------------------------------------------------------------------

/**
 * A region map: one image, many pins.
 *
 * `image` is a path served by the asset routes (`/assets/...`), uploaded by
 * the GM through the ordinary upload endpoint — no separate ingestion path.
 * `imageWidth`/`imageHeight` are the natural pixel size of that file, kept so
 * the client can lay out the panel before the image finishes loading and so
 * an exported package can tell whether a replacement image has the same shape.
 */
export const RegionMapDocumentSchema = BaseDocumentSchema.omit({
  type: true,
  system: true,
}).extend({
  name: z.string().default("Novo mapa"),

  /** Asset path of the terrain image; null while the GM has not uploaded one. */
  image: z.string().nullable().default(null),
  imageWidth: z.number().int().positive().default(1000),
  imageHeight: z.number().int().positive().default(1000),

  /**
   * Real-world width of the whole image, for the scale bar. Zero means "no
   * scale" — a city plan or a dungeon sketch has no kilometres to show.
   */
  scaleValue: z.number().min(0).default(0),
  scaleUnits: z.string().default("km"),

  /** The pins on it. Order is authoring order; the UI sorts for display. */
  pins: z.array(MapPinSchema).default(() => []),

  /**
   * Whether the table can open this map at all. A map at `default: NONE` is
   * the GM's draft; the panel shows players the next one they can see.
   */
  ownership: OwnershipSchema.default(() => ({ default: OwnershipLevel.OBSERVER })),

  folder: z.string().nullable().optional(),

  flags: FlagsSchema.default(() => ({})),
});

export type RegionMapDocument = z.infer<typeof RegionMapDocumentSchema>;

export function defaultRegionMapDocument(id: string, name = "Novo mapa"): RegionMapDocument {
  return RegionMapDocumentSchema.parse({
    _id: id,
    _stats: defaultStats(),
    name,
  });
}

// ---------------------------------------------------------------------------
// Reading a pin
// ---------------------------------------------------------------------------

/**
 * Clamp a normalised coordinate into range.
 *
 * Placing a pin is a click on an image, and a click on the border of the
 * element can land a hair outside it. Rejecting the write for a rounding error
 * would make the tool feel broken; clamping puts the pin where the user aimed.
 */
export function clampNormalised(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
