/**
 * popout.test.ts — the pure parts of the pop-out (window detached into its own
 * browser window): where/how big the new window opens and which head nodes are
 * mirrored into it so the detached sheet keeps the app's look.
 */

import { describe, it, expect } from "vitest";
import { popupFeatures, popupName, isMirroredHeadNode } from "../popout.js";

describe("popupFeatures", () => {
  it("opens a popup the size of the window, at its place on the screen", () => {
    const f = popupFeatures(
      { top: 100, left: 200, width: 760, height: 600 },
      { screenX: 50, screenY: 20 },
    );
    expect(f).toBe("popup=yes,width=760,height=600,left=250,top=120");
  });

  it("rounds fractional geometry and never asks for a size below the minimum", () => {
    const f = popupFeatures(
      { top: 10.6, left: -30.2, width: 120.4, height: 80 },
      { screenX: 0, screenY: 0 },
    );
    expect(f).toBe("popup=yes,width=320,height=240,left=0,top=11");
  });
});

describe("popupName", () => {
  it("is stable per window id and safe as a browser window name", () => {
    expect(popupName("win-3-abc")).toBe("fusion-popout-win-3-abc");
    expect(popupName("sheet:Actor:x y")).toBe("fusion-popout-sheet_Actor_x_y");
  });
});

describe("isMirroredHeadNode", () => {
  const el = (tagName: string, attrs: Record<string, string> = {}) => ({
    nodeType: 1,
    tagName,
    getAttribute: (k: string) => attrs[k] ?? null,
  });

  it("mirrors <style> and stylesheet <link> nodes", () => {
    expect(isMirroredHeadNode(el("STYLE"))).toBe(true);
    expect(isMirroredHeadNode(el("LINK", { rel: "stylesheet" }))).toBe(true);
    expect(isMirroredHeadNode(el("LINK", { rel: "preload stylesheet" }))).toBe(true);
  });

  it("skips scripts, module preloads, icons and text nodes", () => {
    expect(isMirroredHeadNode(el("SCRIPT"))).toBe(false);
    expect(isMirroredHeadNode(el("LINK", { rel: "modulepreload" }))).toBe(false);
    expect(isMirroredHeadNode(el("LINK", { rel: "icon" }))).toBe(false);
    expect(isMirroredHeadNode({ nodeType: 3 })).toBe(false);
  });
});
