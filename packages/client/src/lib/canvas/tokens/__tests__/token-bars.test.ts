/**
 * token-bars.test.ts — the token resource bar, as pure logic.
 *
 * REQ-CNV-089 (spec 06): `displayBars` carries exactly the five canonical
 * levels and defaults to `observer`.
 * REQ-CNV-090 (spec 06): the bar reflects the REAL value of the attribute the
 * token points at, the fraction is clamped to [0,1], and the bar is ABSENT —
 * never full as a placeholder — when the path does not resolve, when the token
 * has no actor, or when `max <= 0`.
 * DEC-CNV-15 (spec 06): the `observer` cut is OBSERVER(2)+ over the token's
 * Actor; a privileged role satisfies it always; only `never` hides from the GM.
 *
 * No PIXI, no DOM.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel } from "@fusion/shared";
import type { TokenDisplayMode } from "@fusion/shared";
import {
  resolveTokenBarValue,
  shouldShowTokenBars,
  tokenDisplayBars,
  TOKEN_DISPLAY_MODES,
} from "../token-bars.js";
import type { TokenDocument } from "@fusion/shared";

const system = {
  attributes: {
    hp: { value: 12, max: 40, temp: 0 },
    zero: { value: 3, max: 0 },
    text: { value: "cheio", max: 10 },
  },
  derived: {
    hp: { value: 12, max: 55, temp: 0 },
  },
  resources: {
    focus: { value: 2, max: 3 },
  },
};

// ---------------------------------------------------------------------------
// resolveTokenBarValue — REQ-CNV-090
// ---------------------------------------------------------------------------

describe("resolveTokenBarValue — the real value, or nothing", () => {
  it("reads the attribute the bar points at and derives the fraction", () => {
    const bar = resolveTokenBarValue(system, "resources.focus");
    expect(bar).not.toBeNull();
    expect(bar?.value).toBe(2);
    expect(bar?.max).toBe(3);
    expect(bar?.fraction).toBeCloseTo(2 / 3, 5);
  });

  it("prefers the derived block over the raw one for the same attribute", () => {
    // The derivation pipeline writes system.derived.hp; system.attributes.hp is
    // its input. A bar showing 12/40 when the character really has 12/55 is a
    // wrong bar, not a stale one.
    const bar = resolveTokenBarValue(system, "attributes.hp");
    expect(bar?.max).toBe(55);
  });

  it("still reads the raw block when there is no derived counterpart", () => {
    const raw = { attributes: { hp: { value: 7, max: 9 } } };
    expect(resolveTokenBarValue(raw, "attributes.hp")?.max).toBe(9);
  });

  it("clamps the fraction to [0,1] on overheal and on negative HP", () => {
    const over = { attributes: { hp: { value: 99, max: 10 } } };
    const under = { attributes: { hp: { value: -6, max: 10 } } };
    expect(resolveTokenBarValue(over, "attributes.hp")?.fraction).toBe(1);
    expect(resolveTokenBarValue(under, "attributes.hp")?.fraction).toBe(0);
  });

  it("is ABSENT (null) when max <= 0 — never a full placeholder bar", () => {
    expect(resolveTokenBarValue(system, "attributes.zero")).toBeNull();
  });

  it("is absent when the path does not resolve", () => {
    expect(resolveTokenBarValue(system, "attributes.sanity")).toBeNull();
  });

  it("is absent when the value at the path is not a number", () => {
    expect(resolveTokenBarValue(system, "attributes.text")).toBeNull();
  });

  it("is absent when the bar is not configured", () => {
    expect(resolveTokenBarValue(system, null)).toBeNull();
    expect(resolveTokenBarValue(system, "")).toBeNull();
    expect(resolveTokenBarValue(system, "   ")).toBeNull();
  });

  it("is absent when there is no actor system at all (token without actor)", () => {
    expect(resolveTokenBarValue(null, "attributes.hp")).toBeNull();
    expect(resolveTokenBarValue(undefined, "attributes.hp")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// shouldShowTokenBars — REQ-CNV-089 / DEC-CNV-15
// ---------------------------------------------------------------------------

const LEVELS: ReadonlyArray<[string, number]> = [
  ["OWNER", OwnershipLevel.OWNER],
  ["OBSERVER", OwnershipLevel.OBSERVER],
  ["LIMITED", OwnershipLevel.LIMITED],
  ["NONE", OwnershipLevel.NONE],
];

function show(
  mode: TokenDisplayMode,
  level: number,
  privileged: boolean,
  hovered: boolean,
): boolean {
  return shouldShowTokenBars({ mode, level, privileged, hovered });
}

describe("shouldShowTokenBars — never", () => {
  it("hides from everyone, the GM included", () => {
    for (const [, level] of LEVELS) {
      for (const privileged of [true, false]) {
        for (const hovered of [true, false]) {
          expect(show("never", level, privileged, hovered)).toBe(false);
        }
      }
    }
  });
});

describe("shouldShowTokenBars — observer", () => {
  it("shows at OBSERVER and above, hover or not", () => {
    for (const hovered of [true, false]) {
      expect(show("observer", OwnershipLevel.OWNER, false, hovered)).toBe(true);
      expect(show("observer", OwnershipLevel.OBSERVER, false, hovered)).toBe(true);
    }
  });

  it("hides below OBSERVER — LIMITED is not enough", () => {
    for (const hovered of [true, false]) {
      expect(show("observer", OwnershipLevel.LIMITED, false, hovered)).toBe(false);
      expect(show("observer", OwnershipLevel.NONE, false, hovered)).toBe(false);
    }
  });

  it("a privileged role satisfies the cut regardless of the ownership map", () => {
    expect(show("observer", OwnershipLevel.NONE, true, false)).toBe(true);
  });
});

describe("shouldShowTokenBars — hoverObserver", () => {
  it("applies the observer cut, but only while hovering", () => {
    expect(show("hoverObserver", OwnershipLevel.OBSERVER, false, true)).toBe(true);
    expect(show("hoverObserver", OwnershipLevel.OBSERVER, false, false)).toBe(false);
  });

  it("hovering does not buy visibility below OBSERVER", () => {
    expect(show("hoverObserver", OwnershipLevel.LIMITED, false, true)).toBe(false);
    expect(show("hoverObserver", OwnershipLevel.NONE, false, true)).toBe(false);
  });

  it("a privileged role still needs the hover", () => {
    expect(show("hoverObserver", OwnershipLevel.NONE, true, true)).toBe(true);
    expect(show("hoverObserver", OwnershipLevel.NONE, true, false)).toBe(false);
  });
});

describe("shouldShowTokenBars — hoverAll", () => {
  it("shows to anyone while hovering, ownership irrelevant", () => {
    for (const [, level] of LEVELS) {
      expect(show("hoverAll", level, false, true)).toBe(true);
      expect(show("hoverAll", level, false, false)).toBe(false);
    }
  });
});

describe("shouldShowTokenBars — always", () => {
  it("shows to anyone at all times", () => {
    for (const [, level] of LEVELS) {
      for (const hovered of [true, false]) {
        expect(show("always", level, false, hovered)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// tokenDisplayBars — REQ-CNV-089 default
// ---------------------------------------------------------------------------

describe("tokenDisplayBars", () => {
  it("returns the token's declared level", () => {
    expect(tokenDisplayBars({ displayBars: "hoverAll" } as TokenDocument)).toBe("hoverAll");
  });

  it("falls back to observer for a token persisted before the field existed", () => {
    // Scenes stored before REQ-CNV-089 have tokens without the key at all; the
    // TS type says otherwise, which is exactly how `grid` disappeared once.
    expect(tokenDisplayBars({} as TokenDocument)).toBe("observer");
  });

  it("falls back to observer for a value outside the five canonical levels", () => {
    expect(tokenDisplayBars({ displayBars: "sometimes" } as unknown as TokenDocument)).toBe(
      "observer",
    );
  });

  it("TOKEN_DISPLAY_MODES lists exactly the five canonical levels, in ladder order", () => {
    expect(TOKEN_DISPLAY_MODES).toEqual([
      "never",
      "observer",
      "hoverObserver",
      "hoverAll",
      "always",
    ]);
  });
});
