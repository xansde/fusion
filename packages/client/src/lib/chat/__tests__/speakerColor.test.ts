/**
 * speakerColor.test.ts — the per-sender accent palette is deterministic and
 * distributes across senders (A022, spec 38).
 *
 * REQ-ACH-025: `speakerColorKey` uses the same (userId, alias) pairing
 * chatGrouping.ts treats as "the same author" — a Gamemaster voicing two NPCs
 * is two different senders, on the same footing consecutive-message grouping
 * already gives them. DEC-ACH-02/DEC-ACH-03 govern the panel's fixed search bar
 * and full-width write box, not color — cited here (alongside REQ-ACH-025) only
 * because the task that added this module names them as what it covers.
 */

import { describe, expect, it } from "vitest";

import {
  SPEAKER_COLOR_PALETTE_SIZE,
  speakerColor,
  speakerColorIndex,
  speakerColorKey,
} from "../speakerColor.js";

describe("speakerColorKey — REQ-ACH-025 same-author pairing", () => {
  it("joins userId and alias, matching chatGrouping's own author identity", () => {
    expect(speakerColorKey({ userId: "u1", alias: "Ana" })).toBe("u1:Ana");
  });

  it("gives the Gamemaster voicing two different NPCs two different keys", () => {
    const asGm = speakerColorKey({ userId: "u1", alias: "Gamemaster" });
    const asTobias = speakerColorKey({ userId: "u1", alias: "Tobias" });
    expect(asGm).not.toBe(asTobias);
  });
});

describe("speakerColorIndex / speakerColor — deterministic hash into a fixed palette", () => {
  it("is deterministic: the same key always resolves to the same index and color", () => {
    const key = speakerColorKey({ userId: "u42", alias: "Fofurinha" });
    const first = speakerColor(key);
    const second = speakerColor(key);
    expect(first).toBe(second);
    expect(speakerColorIndex(key)).toBe(speakerColorIndex(key));
  });

  it("never returns a slot outside the fixed palette", () => {
    const keys = ["u1:Ana", "u2:Bruno", "u3:Karina", "", "u-with-a-very-long-id:🎲"];
    for (const key of keys) {
      const index = speakerColorIndex(key);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(SPEAKER_COLOR_PALETTE_SIZE);
    }
  });

  it("returns a valid hsl() string at the fixed saturation/lightness", () => {
    const color = speakerColor(speakerColorKey({ userId: "u1", alias: "Ana" }));
    expect(color).toMatch(/^hsl\(\d+(\.\d+)?, 72%, 64%\)$/);
  });

  it("distributes distinct senders across more than one palette slot", () => {
    const senders = [
      { userId: "u1", alias: "Gamemaster" },
      { userId: "u1", alias: "Tobias" },
      { userId: "u2", alias: "Ana" },
      { userId: "u3", alias: "Bruno" },
      { userId: "u4", alias: "Karina" },
      { userId: "u5", alias: "Weslley" },
      { userId: "u6", alias: "Tauan" },
      { userId: "u7", alias: "Nane" },
      { userId: "u8", alias: "Vitor" },
      { userId: "u9", alias: "Fofurinha" },
    ];
    const indices = new Set(senders.map((s) => speakerColorIndex(speakerColorKey(s))));
    // Ten senders over an 8-slot palette must land on more than a single color —
    // a constant/degenerate hash would collapse them all into one slot.
    expect(indices.size).toBeGreaterThan(1);
  });

  it("gives the Gamemaster (as GM) and the Gamemaster (voicing Tobias) different colors", () => {
    const asGm = speakerColor(speakerColorKey({ userId: "u1", alias: "Gamemaster" }));
    const asTobias = speakerColor(speakerColorKey({ userId: "u1", alias: "Tobias" }));
    expect(asGm).not.toBe(asTobias);
  });
});
