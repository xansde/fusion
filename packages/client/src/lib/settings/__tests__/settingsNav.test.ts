/**
 * settingsNav.test.ts — the index↔section machine of the Configurações tab (G100).
 *
 * Pure logic, no DOM: instantiates `SettingsNav` directly, the same way
 * `turnHead.test.ts` exercises `TurnHeadState`. Rendering is `SettingsTab.test.ts`'s
 * job; this file only proves the machine.
 */

import { describe, expect, it } from "vitest";

import {
  getSettingsSection,
  SETTINGS_SECTIONS,
  SettingsNav,
  visibleSettingsSections,
  type SettingsSectionId,
} from "../settingsNav.svelte.js";

describe("SETTINGS_SECTIONS — DEC-CFG-05's five sections", () => {
  it("REQ-CFG-003: five sections, in DEC-CFG-05's own order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "preferences",
      "world",
      "permissions",
      "users",
      "mods",
    ]);
  });

  it("REQ-CFG-004: a section descriptor carries a title and a description, and nothing shaped like an icon", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(typeof section.titleKey).toBe("string");
      expect(section.titleKey.length).toBeGreaterThan(0);
      expect(typeof section.descriptionKey).toBe("string");
      expect(section.descriptionKey.length).toBeGreaterThan(0);
      expect(Object.keys(section)).not.toContain("icon");
    }
  });

  it("REQ-CFG-005: only Minhas preferências is unprivileged; the other four require the privileged seat", () => {
    const unprivileged = SETTINGS_SECTIONS.filter((s) => !s.privileged).map((s) => s.id);
    expect(unprivileged).toEqual(["preferences"]);
  });
});

describe("visibleSettingsSections — the corte por papel na entrada (REQ-CFG-005)", () => {
  it("REQ-CFG-005: a non-privileged seat sees exactly one entry — Minhas preferências", () => {
    const visible = visibleSettingsSections(false);
    expect(visible.map((s) => s.id)).toEqual(["preferences"]);
  });

  it("REQ-CFG-003: a privileged seat (the Mestre) sees all five, in order", () => {
    const visible = visibleSettingsSections(true);
    expect(visible.map((s) => s.id)).toEqual([
      "preferences",
      "world",
      "permissions",
      "users",
      "mods",
    ]);
  });
});

describe("getSettingsSection", () => {
  it("resolves every id declared in SETTINGS_SECTIONS", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(getSettingsSection(section.id)).toBe(section);
    }
  });

  it("throws for an id that was never declared, instead of silently returning undefined", () => {
    expect(() => getSettingsSection("not-a-real-section" as SettingsSectionId)).toThrow();
  });
});

describe("SettingsNav — the index↔section machine (REQ-CFG-010..013)", () => {
  it("REQ-CFG-003: a fresh machine starts at the index (activeSectionId is null)", () => {
    const nav = new SettingsNav();
    expect(nav.activeSectionId).toBeNull();
  });

  it("REQ-CFG-010: open(id) substitutes the index with that section's id", () => {
    const nav = new SettingsNav();
    nav.open("world");
    expect(nav.activeSectionId).toBe("world");
  });

  it("REQ-CFG-010: opening a different section replaces the previous one, never stacking", () => {
    const nav = new SettingsNav();
    nav.open("world");
    nav.open("users");
    expect(nav.activeSectionId).toBe("users");
  });

  it("REQ-CFG-011: back() from an open section returns to the index", () => {
    const nav = new SettingsNav();
    nav.open("permissions");
    nav.back();
    expect(nav.activeSectionId).toBeNull();
  });

  it("REQ-CFG-011: back() at the index is a no-op, not an error", () => {
    const nav = new SettingsNav();
    expect(() => nav.back()).not.toThrow();
    expect(nav.activeSectionId).toBeNull();
  });

  it("REQ-CFG-012: a new SettingsNav instance never inherits another instance's open section — collapsing and reopening the tab has nothing to carry over, because the drawer mounts a fresh panel (REQ-GAV-017)", () => {
    const first = new SettingsNav();
    first.open("mods");
    expect(first.activeSectionId).toBe("mods");

    const second = new SettingsNav();
    expect(second.activeSectionId).toBeNull();
  });

  it("REQ-CFG-013: the machine exposes only open()/back()/activeSectionId — nothing here can address a window", () => {
    const nav = new SettingsNav();
    const methods = Object.getOwnPropertyNames(SettingsNav.prototype).filter(
      (name) => name !== "constructor",
    );
    expect(methods.sort()).toEqual(["activeSectionId", "back", "open"].sort());
    void nav;
  });
});
