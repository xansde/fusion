import { describe, expect, it } from "vitest";
import { ICON_NAMES, iconSvg, isIconName } from "../ui/icons.js";

describe("iconSvg — the one icon set of the app (Lucide subset, ISC)", () => {
  it("draws a 24×24 stroked glyph in currentColor, decorative by default", () => {
    const svg = iconSvg("swords");
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="1.75"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).toContain("<path ");
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("takes a size (width and height) and keeps the viewBox", () => {
    const svg = iconSvg("dices", { size: 32 });
    expect(svg).toContain('width="32"');
    expect(svg).toContain('height="32"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it("with a label it becomes an image with an accessible name, escaped", () => {
    const svg = iconSvg("heart", { label: 'Pontos de vida "PV" <atual>' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Pontos de vida &quot;PV&quot; &lt;atual&gt;"');
    expect(svg).not.toContain("aria-hidden");
  });

  it("knows its names and rejects anything else", () => {
    expect(isIconName("map")).toBe(true);
    expect(isIconName("not-an-icon")).toBe(false);
    expect(() => iconSvg("not-an-icon" as never)).toThrow(/unknown icon/);
  });

  it("every glyph of the set is drawn the same way: stroke shapes only, no fill, no colour, no text", () => {
    const allowed = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
    expect(ICON_NAMES.length).toBeGreaterThan(80);
    for (const name of ICON_NAMES) {
      const svg = iconSvg(name);
      const tags = [...svg.matchAll(/<([a-z]+)\s/g)].map((m) => m[1]);
      expect(tags[0]).toBe("svg");
      for (const tag of tags.slice(1))
        expect(allowed.has(tag ?? ""), `${name}: <${String(tag)}>`).toBe(true);
      expect(svg, name).not.toMatch(/fill="(?!none)/);
      expect(svg, name).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });
});
