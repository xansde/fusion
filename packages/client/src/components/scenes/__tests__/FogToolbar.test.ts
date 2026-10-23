/**
 * FogToolbar.test.ts — the fog bar is an icon strip: no help text, tooltips on every
 * control, and it only shows when the shared corner panel state says "fog".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";
import type { ManualFog } from "@fusion/shared";

import FogToolbar from "../FogToolbar.svelte";
import { cornerPanel } from "../../../lib/ui/cornerPanel.svelte.js";
import { fogToolState } from "../../../lib/canvas/fog/fogToolState.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

const fog = { enabled: true, ops: [] } as unknown as ManualFog;

function html(): string {
  return render(FogToolbar, { props: { fog, onChange: () => undefined } }).body;
}

describe("FogToolbar", () => {
  beforeEach(() => {
    cornerPanel.open = null;
    fogToolState.tool = "none";
  });

  it("closed: only the icon toggle, no text label", () => {
    const body = html();
    expect(body).toContain("fog-dock__toggle");
    expect(body).not.toContain("fog-strip");
    expect(body).not.toContain(">Névoa<");
  });

  it("open: icon strip with tooltips and no help paragraphs", () => {
    cornerPanel.open = "fog";
    const body = html();
    expect(body).toContain("fog-strip");
    expect(body).not.toMatch(/<p[ >]/);
    expect(body).not.toContain(t("FUSION.Fog.AltHint"));
    for (const key of [
      "Enabled",
      "ToolRect",
      "ToolBrush",
      "Undo",
      "RevealAll",
      "CoverAll",
      "Snap",
    ]) {
      expect(body).toContain(`title="${t(`FUSION.Fog.${key}`)}`);
    }
    // radius slider only with the brush armed
    expect(body).not.toContain('type="range"');
  });

  it("brush armed: radius slider appears", () => {
    cornerPanel.open = "fog";
    fogToolState.tool = "brush";
    expect(html()).toContain('type="range"');
  });
});

describe("FogToolbar — one icon set, one target size (ui-acabamento)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../FogToolbar.svelte", import.meta.url)),
    "utf8",
  );

  it("draws no glyph of its own: every icon comes from the shared set", () => {
    expect(source).not.toMatch(/<path\b/);
    cornerPanel.open = "fog";
    const body = html();
    const svgs = body.match(/<svg\b[^>]*>/g) ?? [];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg).toContain("fusion-icon");
  });

  it("the toggle is a 40px target like the rest of the row", () => {
    const toggle = /\.fog-dock__toggle \{[^}]*\}/.exec(source)?.[0] ?? "";
    expect(toggle).toContain("var(--fusion-target)");
    expect(toggle).not.toContain("2.25rem");
  });
});
