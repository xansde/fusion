/**
 * displayName unit tests (REQ-CMP-055, A041 — ajustes r1, Fase 4).
 *
 * Coverage:
 *   - resolves the pt-BR snapshot from flags.fusion.i18n when present
 *   - falls back to the EN-pure doc.name when no snapshot exists
 *   - falls back when the requested locale has no entry (e.g. "en")
 *   - tolerates a malformed flags/fusion/i18n shape without throwing
 */

import { describe, it, expect } from "vitest";
import { displayName } from "../displayName.js";

describe("displayName", () => {
  it("REQ-CMP-055: resolves the pt-BR snapshot from flags.fusion.i18n when present", () => {
    const doc = {
      name: "Eagle",
      flags: {
        fusion: {
          packName: "bestiary",
          sourceId: "eagle-001",
          i18n: { "pt-BR": { name: "Águia" } },
        },
      },
    };
    expect(displayName(doc, "pt-BR")).toBe("Águia");
  });

  it("REQ-CMP-055: falls back to the EN-pure doc.name when no snapshot exists", () => {
    const doc = { name: "Owl", flags: { fusion: { packName: "bestiary", sourceId: "owl-001" } } };
    expect(displayName(doc, "pt-BR")).toBe("Owl");
  });

  it("REQ-CMP-055: falls back to doc.name when the document has no flags at all", () => {
    const doc = { name: "Owl" };
    expect(displayName(doc, "pt-BR")).toBe("Owl");
  });

  it("REQ-CMP-055: falls back to doc.name when resolving a locale with no entry (e.g. en)", () => {
    const doc = {
      name: "Eagle",
      flags: { fusion: { i18n: { "pt-BR": { name: "Águia" } } } },
    };
    expect(displayName(doc, "en")).toBe("Eagle");
  });

  it("REQ-CMP-055: tolerates a malformed flags/fusion/i18n shape without throwing", () => {
    expect(displayName({ name: "X", flags: { fusion: "not-an-object" } }, "pt-BR")).toBe("X");
    expect(displayName({ name: "X", flags: { fusion: { i18n: "nope" } } }, "pt-BR")).toBe("X");
    expect(
      displayName({ name: "X", flags: { fusion: { i18n: { "pt-BR": "nope" } } } }, "pt-BR"),
    ).toBe("X");
    expect(displayName({ flags: null }, "pt-BR")).toBe("");
  });

  it("REQ-CMP-055: defaults locale to the active i18n locale when not passed explicitly", () => {
    const doc = { name: "Eagle", flags: { fusion: { i18n: { "pt-BR": { name: "Águia" } } } } };
    // The app default locale is pt-BR (FusionI18n's initial _locale) — no
    // explicit locale argument still resolves the pt-BR snapshot.
    expect(displayName(doc)).toBe("Águia");
  });
});
