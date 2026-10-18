/**
 * assetTabs.ts — the decisions behind the FilePicker's tabs (categories), as pure functions.
 * `FilePicker.svelte` only calls them.
 */

import {
  ASSET_CATEGORIES,
  ASSET_TAB_ALL,
  type AssetCategory,
  type AssetTab,
} from "@fusion/shared";
import type { AssetKind } from "./clientValidation.js";
import type { UploadOptions } from "./assetApi.js";

/** One browsable file, from either the library listing or the icon gallery. */
export interface PickerAsset {
  name: string;
  size: number;
  mime_type: string;
  category: AssetCategory;
}

/** Tab order shown to the user: Todos · Mapas · Tokens · Itens · Ícones · Música · Handouts · Outros. */
export const TAB_ORDER: readonly AssetTab[] = [ASSET_TAB_ALL, ...ASSET_CATEGORIES];

/** i18n key of a tab's label. */
export function tabLabelKey(tab: AssetTab): string {
  return `FUSION.AssetTabs.${tab}`;
}

/** The mime types a picker asking for these kinds can show (the grid used to ignore `kinds`). */
export function matchesKinds(mime: string, kinds: readonly AssetKind[]): boolean {
  return kinds.some((k) => mime.startsWith(`${k}/`));
}

/** Tabs worth showing for the kinds: audio-only pickers hide the image tabs and vice versa. */
export function tabsForKinds(kinds: readonly AssetKind[]): AssetTab[] {
  const wantsImage = kinds.includes("image");
  const wantsAudio = kinds.includes("audio");
  if (wantsImage && wantsAudio) return [...TAB_ORDER];
  if (wantsAudio) return [ASSET_TAB_ALL, "audio", "other"];
  return TAB_ORDER.filter((t) => t !== "audio");
}

/**
 * The tab a picker opens on: the one its context asked for (when it is offered), else the only
 * natural one for the kinds (audio-only -> audio), else "all".
 */
export function initialTab(
  requested: AssetCategory | undefined,
  kinds: readonly AssetKind[],
): AssetTab {
  const offered = tabsForKinds(kinds);
  if (requested !== undefined && offered.includes(requested)) return requested;
  if (kinds.length === 1 && kinds[0] === "audio") return "audio";
  return ASSET_TAB_ALL;
}

/** Items per tab (and the total under "all"), counting only what the kinds allow. */
export function tabCounts(
  assets: readonly PickerAsset[],
  kinds: readonly AssetKind[],
): Record<AssetTab, number> {
  const counts = Object.fromEntries(TAB_ORDER.map((t) => [t, 0])) as Record<AssetTab, number>;
  for (const a of assets) {
    if (!matchesKinds(a.mime_type, kinds)) continue;
    counts[ASSET_TAB_ALL]++;
    counts[a.category]++;
  }
  return counts;
}

/** What the grid shows: the active tab, narrowed by the name search (case-insensitive). */
export function visibleAssets(
  assets: readonly PickerAsset[],
  tab: AssetTab,
  query: string,
  kinds: readonly AssetKind[],
): PickerAsset[] {
  const q = query.trim().toLowerCase();
  return assets.filter(
    (a) =>
      matchesKinds(a.mime_type, kinds) &&
      (tab === ASSET_TAB_ALL || a.category === tab) &&
      (q === "" || a.name.toLowerCase().includes(q)),
  );
}

/**
 * How an upload is sent, from the picker's mode and active tab. The action bar's icon gallery and
 * the "Ícones" tab both send the "icon" purpose (the server picks the area); any other tab but
 * "all" declares itself as the file's category; "all" declares nothing (the server derives it).
 */
export function uploadOptionsFor(
  mode: "assets" | "actionbar-icons",
  tab: AssetTab,
): UploadOptions {
  if (mode === "actionbar-icons" || tab === "icons") return { purpose: "icon" };
  if (tab === ASSET_TAB_ALL) return {};
  return { category: tab };
}

/** Icons live in the reserved area and are never moved between tabs. */
export function canMoveAsset(role: number | undefined, asset: PickerAsset): boolean {
  return role === 4 && asset.category !== "icons" && !asset.name.includes("/");
}
