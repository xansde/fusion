/**
 * portrait.test.ts — unit tests for the actor-portrait fallback helpers
 * (r19-W4). Pure functions: no DOM, no Svelte, no network.
 */

import { describe, it, expect } from "vitest";
import {
  PORTRAIT_PALETTE,
  portraitInitials,
  portraitColor,
  isPortraitPlaceholder,
} from "../portrait.js";

describe("portraitInitials", () => {
  it("returns the first two letters for a single-word name", () => {
    expect(portraitInitials("Finn")).toBe("FI");
    expect(portraitInitials("Bigodes")).toBe("BI");
  });

  it("returns first-of-first + first-of-last for a two-word name", () => {
    expect(portraitInitials("Tobias Grimwald")).toBe("TG");
  });

  it("uses only the first and last word for 3+ word names", () => {
    expect(portraitInitials("Ana Maria Braz")).toBe("AB");
    expect(portraitInitials("Sir Reginald von Hammerlock")).toBe("SH");
  });

  it("falls back to '?' for empty / whitespace / nullish names", () => {
    expect(portraitInitials("")).toBe("?");
    expect(portraitInitials("   ")).toBe("?");
    expect(portraitInitials(null)).toBe("?");
    expect(portraitInitials(undefined)).toBe("?");
  });

  it("uppercases and tolerates a one-letter word", () => {
    expect(portraitInitials("x")).toBe("X");
    expect(portraitInitials("já foi")).toBe("JF");
  });

  it("collapses extra internal whitespace", () => {
    expect(portraitInitials("  Tobias   Grimwald  ")).toBe("TG");
  });
});

describe("portraitColor", () => {
  it("is deterministic for the same name", () => {
    expect(portraitColor("Finn")).toBe(portraitColor("Finn"));
  });

  it("always returns a color from the palette", () => {
    for (const name of ["Finn", "Tobias", "Bigodes", "Sylas", "Valeros", "Ezren"]) {
      expect(PORTRAIT_PALETTE).toContain(portraitColor(name));
    }
  });

  it("maps empty / nullish names to the first (accent) palette color", () => {
    expect(portraitColor("")).toBe(PORTRAIT_PALETTE[0]);
    expect(portraitColor("   ")).toBe(PORTRAIT_PALETTE[0]);
    expect(portraitColor(null)).toBe(PORTRAIT_PALETTE[0]);
    expect(portraitColor(undefined)).toBe(PORTRAIT_PALETTE[0]);
  });

  it("spreads different names across more than one color", () => {
    const names = ["Finn", "Tobias", "Bigodes", "Sylas", "Valeros", "Ezren", "Merisiel", "Kyra"];
    const colors = new Set(names.map(portraitColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("isPortraitPlaceholder", () => {
  it("treats empty / whitespace / nullish as a placeholder", () => {
    expect(isPortraitPlaceholder(null)).toBe(true);
    expect(isPortraitPlaceholder(undefined)).toBe(true);
    expect(isPortraitPlaceholder("")).toBe(true);
    expect(isPortraitPlaceholder("   ")).toBe(true);
  });

  it("treats compendium / system art stubs as placeholders (the Finn bug)", () => {
    expect(isPortraitPlaceholder("icons/placeholder/npc.svg")).toBe(true);
    expect(isPortraitPlaceholder("icons/svg/mystery-man.svg")).toBe(true);
    expect(isPortraitPlaceholder("systems/pf2e/icons/default.webp")).toBe(true);
    expect(isPortraitPlaceholder("modules/foo/bar.png")).toBe(true);
    expect(isPortraitPlaceholder("some/Placeholder/thing.png")).toBe(true);
  });

  it("accepts real portraits (uploaded assets, external URLs, data URIs)", () => {
    expect(isPortraitPlaceholder("/assets/finn-a3b4c5d6.webp")).toBe(false);
    expect(isPortraitPlaceholder("https://example.com/portrait.png")).toBe(false);
    expect(isPortraitPlaceholder("data:image/png;base64,AAAA")).toBe(false);
  });
});
