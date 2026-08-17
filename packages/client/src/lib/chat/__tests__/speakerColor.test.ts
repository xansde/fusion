/**
 * speakerColor.test.ts — the per-sender accent palette is deterministic and
 * distributes across senders (A022, spec 38); `resolveSpeakerColor` prefers
 * the sender's real world color (REQ-CHT-008, REQ-USR-002) over that palette.
 *
 * REQ-ACH-025: `speakerColorKey` uses the same (userId, alias) pairing
 * chatGrouping.ts treats as "the same author" — a Gamemaster voicing two NPCs
 * is two different senders, on the same footing consecutive-message grouping
 * already gives them. DEC-ACH-02/DEC-ACH-03 govern the panel's fixed search bar
 * and full-width write box, not color — cited here (alongside REQ-ACH-025) only
 * because the task that added this module names them as what it covers.
 *
 * REQ-CHT-008 (`09-chat-e-mensagens.md`): OOC text messages get "borda na cor
 * do jogador" — the user's own assigned color, REQ-USR-002
 * (`05-usuarios-e-permissoes.md`), the SAME field already painted on that
 * user's cursor/ruler/pings. `resolveSpeakerColor` is what makes chat consult
 * that real color instead of inventing a second one via hash.
 */

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@fusion/shared";

import { canGroupWithPrevious } from "../chatGrouping.js";
import {
  SPEAKER_COLOR_PALETTE_SIZE,
  resolveSpeakerColor,
  speakerColor,
  speakerColorIndex,
  speakerColorKey,
} from "../speakerColor.js";

/** Minimal-but-valid ChatMessage fixture — mirrors chatGrouping.test.ts's `msg()`. */
function msg(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    _id: id,
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
      version: 1,
      lastModifiedBy: "u1",
      createdBy: "u1",
      coreVersion: "0.1.0",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 1,
      systemSchemaVersion: null,
    },
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    type: "text",
    worldId: "w1",
    content: id,
    speaker: { userId: "u1", alias: "A" },
    timestamp: 1000,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

describe("speakerColorKey — REQ-ACH-025 same-author pairing, proven against chatGrouping's own definition", () => {
  it("gives two messages that canGroupWithPrevious treats as a continuation the SAME resolved color", () => {
    const previous = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const current = msg("m2", { speaker: { userId: "u1", alias: "Ana" } });
    expect(canGroupWithPrevious(current, previous)).toBe(true);
    expect(speakerColor(speakerColorKey(current.speaker))).toBe(
      speakerColor(speakerColorKey(previous.speaker)),
    );
  });

  it("gives the Gamemaster voicing two different NPCs DIFFERENT keys, exactly where chatGrouping also refuses to group them", () => {
    const previous = msg("m1", { speaker: { userId: "u1", alias: "Gamemaster" } });
    const current = msg("m2", { speaker: { userId: "u1", alias: "Tobias" } });
    expect(canGroupWithPrevious(current, previous)).toBe(false);
    expect(speakerColorKey(current.speaker)).not.toBe(speakerColorKey(previous.speaker));
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

describe("resolveSpeakerColor — REQ-CHT-008/REQ-USR-002, the sender's real color wins", () => {
  it("returns the world-assigned color when presence has a record for the speaker's userId", () => {
    const speaker = { userId: "u1", alias: "Fofurinha" };
    const users = [{ userId: "u1", color: "#3ddc84" }];
    expect(resolveSpeakerColor(speaker, users)).toBe("#3ddc84");
  });

  it("falls back to the deterministic hash when the userId resolves to nobody", () => {
    const speaker = { userId: "u-offline", alias: "Ghost" };
    const fallback = speakerColor(speakerColorKey(speaker));
    expect(resolveSpeakerColor(speaker, [])).toBe(fallback);
    expect(resolveSpeakerColor(speaker, [{ userId: "someone-else", color: "#ff5c5c" }])).toBe(
      fallback,
    );
  });

  it("gives the SAME user the SAME resolved color across two different aliases — one identity, one color", () => {
    const users = [{ userId: "u1", color: "#ff5c5c" }];
    const asGm = resolveSpeakerColor({ userId: "u1", alias: "Gamemaster" }, users);
    const asTobias = resolveSpeakerColor({ userId: "u1", alias: "Tobias" }, users);
    expect(asGm).toBe("#ff5c5c");
    expect(asTobias).toBe("#ff5c5c");
  });

  it("ignores a color for a different userId (no cross-user leak)", () => {
    const speaker = { userId: "u2", alias: "Ana" };
    const users = [
      { userId: "u1", color: "#ff5c5c" },
      { userId: "u3", color: "#3ddc84" },
    ];
    expect(resolveSpeakerColor(speaker, users)).toBe(speakerColor(speakerColorKey(speaker)));
  });
});
