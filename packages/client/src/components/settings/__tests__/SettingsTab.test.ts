/**
 * SettingsTab.test.ts — the placeholder panel of the footer tab (G016).
 *
 * Spec 37 has not been built yet; what spec 36 §7 already demands of any child tab
 * is a title of its own and an honest empty state instead of a hole, plus the
 * absence of a second collapse control (REQ-GAV-011). REQ-CFG-001 owns the tab's
 * identity — that half is asserted in `lib/sidebar/__tests__/registerCoreTabs.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import SettingsTab from "../SettingsTab.svelte";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

function renderTab(): string {
  const { body } = render(SettingsTab, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: "user-1",
      isGm: false,
      activeSceneId: null,
    },
  });
  return body;
}

describe("SettingsTab — the footer tab before spec 37", () => {
  it("spec 36 §7.4: shows its own title and an empty state, not a blank panel", () => {
    const html = renderTab();

    expect(html).toContain(t("FUSION.Sidebar.Settings.Title"));
    expect(html).toContain(t("FUSION.Sidebar.Settings.Empty"));
    // The label really resolved from the bundle, so the assertions above are real.
    expect(t("FUSION.Sidebar.Settings.Empty")).not.toBe("FUSION.Sidebar.Settings.Empty");
  });

  it("REQ-GAV-011: the panel has no collapse control and no button at all yet", () => {
    const html = renderTab();

    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/[✕✖×❯☰]/);
  });
});
