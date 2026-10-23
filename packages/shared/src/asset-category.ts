/**
 * Asset browser categories (the tabs of the FilePicker).
 *
 * "all" is a virtual tab (everything the viewer can see), so it is NOT a category an asset can
 * carry. The stored/derived category of an asset is always one of {@link ASSET_CATEGORIES}.
 */

export const ASSET_CATEGORIES = [
  "maps",
  "tokens",
  "items",
  "icons",
  "audio",
  "handouts",
  "other",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** The tab id of the virtual "everything" tab. */
export const ASSET_TAB_ALL = "all" as const;

export type AssetTab = AssetCategory | typeof ASSET_TAB_ALL;

export function isAssetCategory(value: unknown): value is AssetCategory {
  return typeof value === "string" && (ASSET_CATEGORIES as readonly string[]).includes(value);
}
