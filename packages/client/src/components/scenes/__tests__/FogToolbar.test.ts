/**
 * FogToolbar.test.ts — the fog bar is an icon strip: no help text, tooltips on every
 * control, and it only shows when the shared corner panel state says "fog".
 */
import { beforeEach, describe, expect, it } from "vitest";
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
