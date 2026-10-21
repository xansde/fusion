import { describe, it, expect } from "vitest";
import {
  tabCounts,
  visibleAssets,
  initialTab,
  tabsForKinds,
  uploadOptionsFor,
  canMoveAsset,
  type PickerAsset,
} from "../assetTabs.js";

const a = (name: string, mime_type: string, category: PickerAsset["category"]): PickerAsset => ({
  name,
  size: 1,
  mime_type,
  category,
});

const ASSETS = [
  a("mapa.png", "image/png", "maps"),
  a("orc.png", "image/png", "tokens"),
  a("elfa.png", "image/png", "tokens"),
  a("tema.mp3", "audio/mpeg", "audio"),
  a("actionbar-icons/espada.png", "image/png", "icons"),
];

describe("assetTabs", () => {
  it("counts per tab and the total, only for the kinds asked", () => {
    const c = tabCounts(ASSETS, ["image", "audio"]);
    expect(c).toMatchObject({ all: 5, maps: 1, tokens: 2, audio: 1, icons: 1, items: 0, other: 0 });
    const imagesOnly = tabCounts(ASSETS, ["image"]);
    expect(imagesOnly.all).toBe(4);
    expect(imagesOnly.audio).toBe(0);
  });

  it("an audio picker never shows an image, in any tab (the grid used to mix them)", () => {
    for (const tab of ["all", "audio", "maps", "tokens"] as const) {
      const shown = visibleAssets(ASSETS, tab, "", ["audio"]);
      expect(shown.every((x) => x.mime_type.startsWith("audio/"))).toBe(true);
    }
    expect(visibleAssets(ASSETS, "all", "", ["audio"]).map((x) => x.name)).toEqual(["tema.mp3"]);
  });

  it("an image picker never shows audio, music does not hide among the portraits", () => {
    expect(visibleAssets(ASSETS, "all", "", ["image"]).some((x) => x.name === "tema.mp3")).toBe(
      false,
    );
  });

  it("filters by tab and by name inside the tab", () => {
    expect(visibleAssets(ASSETS, "tokens", "", ["image"]).map((x) => x.name)).toEqual([
      "orc.png",
      "elfa.png",
    ]);
    expect(visibleAssets(ASSETS, "tokens", "ELF", ["image"]).map((x) => x.name)).toEqual([
      "elfa.png",
    ]);
    expect(visibleAssets(ASSETS, "maps", "orc", ["image"])).toEqual([]);
  });

  it("opens on the requested tab when offered, audio-only opens on audio, else all", () => {
    expect(initialTab("maps", ["image"])).toBe("maps");
    expect(initialTab("audio", ["image"])).toBe("all"); // audio tab not offered to an image picker
    expect(initialTab(undefined, ["audio"])).toBe("audio");
    expect(initialTab("handouts", ["image"])).toBe("handouts");
    expect(initialTab(undefined, ["image"])).toBe("all");
  });

  it("offers audio-only pickers just Todos, Música & Som and Outros", () => {
    expect(tabsForKinds(["audio"])).toEqual(["all", "audio", "other"]);
    expect(tabsForKinds(["image"])).not.toContain("audio");
  });

  it("an upload inherits the active tab: icons -> icon purpose, all -> nothing, others -> category", () => {
    expect(uploadOptionsFor("assets", "all")).toEqual({});
    expect(uploadOptionsFor("assets", "maps")).toEqual({ category: "maps" });
    expect(uploadOptionsFor("assets", "icons")).toEqual({ purpose: "icon" });
    expect(uploadOptionsFor("actionbar-icons", "all")).toEqual({ purpose: "icon" });
  });

  it("only the GM moves, and never an icon", () => {
    expect(canMoveAsset(4, ASSETS[0]!)).toBe(true);
    expect(canMoveAsset(3, ASSETS[0]!)).toBe(false);
    expect(canMoveAsset(4, ASSETS[4]!)).toBe(false);
  });
});
