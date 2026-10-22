import { describe, it, expect } from "vitest";
import { DEFAULT_AREA_STYLE } from "@fusion/shared";
import {
  rulerTool,
  setAreaStyle,
  openTemplateMenu,
  closeTemplateMenu,
  templateMenu,
} from "../rulerToolStore.svelte.js";

describe("area style in the tool", () => {
  it("starts with the readable defaults", () => {
    expect(rulerTool.style).toEqual(DEFAULT_AREA_STYLE);
  });
  it("patches colour, border and fill, clamping the fill", () => {
    setAreaStyle({ color: "#34c759" });
    setAreaStyle({ border: "thick", fill: 0.99 });
    expect(rulerTool.style).toEqual({ color: "#34c759", border: "thick", fill: 0.7 });
  });
  it("opens and closes the pinned template menu", () => {
    openTemplateMenu("tpl-1", 10, 20);
    expect(templateMenu.open).toEqual({ id: "tpl-1", x: 10, y: 20 });
    closeTemplateMenu();
    expect(templateMenu.open).toBeNull();
  });
});
