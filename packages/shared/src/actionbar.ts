/**
 * `flags.fusion.actionBar` — what the action bar keeps on the ACTOR (spec 53 §7.2, tasks.md §2.5).
 *
 * Three sibling fields, flat:
 *   favorites  the 12 favourite slots, in key order "1".."9","0","−","=" (BAR-F3-01, D-BA06/07);
 *   seeded     true once the first-opening seed ran — from then on nothing enters by itself (D-BA08);
 *   icons      entry id → custom image (BAR-F3-05, D-BA02/03).
 *
 * The server validates the RESULTING object (stored value + the expanded diff) with
 * {@link ActionBarFlagsSchema} on every `doc:update` and `doc:create` of an Actor
 * (`server/documents/action-bar-flags.ts`). Who may write is still decided by the actor's
 * ownership (REQ-BAR-072/073); the schema only closes the SHAPE and the CAP.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ICON PATH IS NARROWER THAN "ANY /assets/ PATH"
 * ---------------------------------------------------------------------------
 *
 * `server/assets/asset-fields.ts` signs a read grant for every value of `icons` (REQ-BAR-070), to
 * whoever can see the actor. A map of free `/assets/…` values would let the actor's owner put any
 * filename he knows — a GM map, a handout — into a field the server then signs for every viewer.
 * So a value here is ONE file directly inside the reserved icon area ({@link ACTION_BAR_ICON_AREA}),
 * the only place the icon upload writes and the same set the shared gallery already shows to every
 * player (REQ-BAR-079/080). Its name is the safe ASCII the server's slug produces: no percent
 * escape, no separator, no dot segment, so there is no second spelling for the mint and the serve
 * route to disagree about. Everything §2.5 required still holds (whole `/assets/…` path, no
 * external URL, no `..`, at most 512 characters); this only takes away what no legitimate write
 * produces.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Favourite slots: keys 1–9, 0, − and = (REQ-BAR-062). */
export const ACTION_BAR_SLOT_COUNT = 12;

/**
 * Most custom icons one actor may carry (Q-BAR-03, REQ-BAR-069). Enough for every entry a player
 * really customises (12 favourites plus the tabs he browses), and the bound on how many names one
 * mint of the actor can sign (REQ-BAR-071): the projection in `asset-fields.ts` enforces it again.
 */
export const ACTION_BAR_ICON_CAP = 64;

/**
 * The reserved area, a subdirectory of the world's `assets/`, where every icon upload lands
 * (REQ-BAR-076, REQ-SEC-043 as amended). Only the server writes there, only through the icon
 * upload; the client never names a folder.
 */
export const ACTION_BAR_ICON_AREA = "actionbar-icons";

/** Where the bar's state lives on the actor. */
export const ACTION_BAR_FLAG_PATH = "flags.fusion.actionBar";

/** The icon map, as a `doc:update` dot-path key. */
export const ACTION_BAR_ICONS_FLAG_PATH = "flags.fusion.actionBar.icons";

// ---------------------------------------------------------------------------
// Entry ids
// ---------------------------------------------------------------------------

/** `<kind>:<origin>` — the same rule `assertValidEntries` applies to every provider (§2.2). */
export const ActionBarEntryIdSchema = z
  .string()
  .regex(/^(strike|spell|action|item|reaction|toggle|check):[A-Za-z0-9._:-]{1,120}$/);

// ---------------------------------------------------------------------------
// Icon paths
// ---------------------------------------------------------------------------

/** Safe ASCII, an image extension; the `..` check is separate (see below). */
const ICON_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,250}\.(?:png|jpe?g|webp|svg)$/i;

/**
 * `/assets/actionbar-icons/<one file name>`. Written out rather than built from
 * {@link ACTION_BAR_ICON_AREA} so the client bundle never carries a `"/assets/…"` string literal
 * (the SPA test forbids one); the shared test pins the two against each other.
 */
const ICON_PATH_PATTERN = /^\/assets\/actionbar-icons\/([^/]*)$/;

/**
 * True for a file name that may live directly inside the icon area: what the server's slug
 * produces (`<slug>-<8 hex>.<ext>`), or anything else made of the same safe characters.
 */
export function isActionBarIconFileName(name: string): boolean {
  return ICON_FILE_NAME_PATTERN.test(name) && !name.includes("..");
}

/** True for a whole `/assets/actionbar-icons/<file>` path — the only value an icon may hold. */
export function isActionBarIconPath(value: string): boolean {
  const match = ICON_PATH_PATTERN.exec(value);
  return match !== null && isActionBarIconFileName(match[1] ?? "");
}

/** ONE `/assets/…` path per value, matched whole; external URL refused (CSP and read grant). */
export const ActionBarAssetPathSchema = z
  .string()
  .max(512)
  .regex(/^\/assets\/[^\s?#]+$/)
  .refine((p) => !p.includes(".."), "caminho com '..'")
  .refine(isActionBarIconPath, "o ícone precisa ser um arquivo da área de ícones da barra");

// ---------------------------------------------------------------------------
// The object
// ---------------------------------------------------------------------------

export const ActionBarFlagsSchema = z
  .object({
    /** Exactly 12 positions; null = empty. Slot i fires on key "1".."9","0","−","=". */
    favorites: z.array(ActionBarEntryIdSchema.nullable()).length(ACTION_BAR_SLOT_COUNT).optional(),
    /** true after the seed: from then on NOTHING enters by itself (D-BA08). */
    seeded: z.boolean().optional(),
    /** entryId → image of the world's icon area (D-BA02). Cap: ACTION_BAR_ICON_CAP entries. */
    icons: z
      .record(ActionBarEntryIdSchema, ActionBarAssetPathSchema)
      .refine((m) => Object.keys(m).length <= ACTION_BAR_ICON_CAP, "mapa de ícones acima do teto")
      .optional(),
  })
  .strict();
export type ActionBarFlags = z.infer<typeof ActionBarFlagsSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `flags.fusion.actionBar` of a raw document, unvalidated; `undefined` when any hop is missing. */
export function readActionBarFlags(doc: unknown): unknown {
  if (!isPlainObject(doc)) return undefined;
  const flags = doc["flags"];
  if (!isPlainObject(flags)) return undefined;
  const fusion = flags["fusion"];
  if (!isPlainObject(fusion)) return undefined;
  return fusion["actionBar"];
}

/**
 * The `doc:update` diff that sets ONE entry's icon, or restores the generic icon with `null`.
 *
 * The map is sent as a nested object under the dot-path key: the server expands only the top-level
 * key, so an entry id with dots in it stays one key, and the deep merge keeps every sibling entry.
 * `null` inside `flags` is the delete-key of the merge (REQ-DOC-037).
 */
export function actionBarIconPatch(
  entryId: string,
  path: string | null,
): Record<string, Record<string, string | null>> {
  return { [ACTION_BAR_ICONS_FLAG_PATH]: { [entryId]: path } };
}
