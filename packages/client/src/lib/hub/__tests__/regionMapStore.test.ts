/**
 * How the Mapa panel reads a pin — DEC-MREG-08, REQ-DOC-056/057.
 *
 * These are the two readings the panel draws and the one affordance the GM
 * gets, and all three are easy to get backwards in a way that only shows up at
 * the table: a rumour drawn as a place spoils the reveal, and a published pin
 * drawn as a draft makes the GM re-reveal something the party already knows.
 *
 * The store's ops are not exercised here — they are one `sendOp` line each,
 * and what they do is proved end to end in the server's `region-map.test.ts`
 * against a real socket. What is worth testing on this side is the reading.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel, createGmPin, createPlayerPin } from "@fusion/shared";
import { readPin, isHiddenFromTable, levelFor } from "../regionMapStore.svelte.js";

const PIN_ID = "aaaaaaaaaaaaaaaa";
const GM_ROLE = 4;
const PLAYER_ROLE = 1;

describe("readPin", () => {
  it("draws a player's revealed pin as a place", () => {
    const pin = createGmPin(PIN_ID, {
      text: "Ruínas",
      ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER },
    });

    expect(readPin(pin, "tobias", PLAYER_ROLE)).toBe("known");
  });

  it("draws a pin at `limited` as a rumour", () => {
    const pin = createGmPin(PIN_ID, {
      ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.LIMITED },
    });

    expect(readPin(pin, "tobias", PLAYER_ROLE)).toBe("rumour");
  });

  it("hands the GM every pin as authored — they have no rumours to read", () => {
    const pin = createGmPin(PIN_ID, {
      text: "Ruínas",
      ownership: { default: OwnershipLevel.NONE },
    });

    expect(readPin(pin, "gm", GM_ROLE)).toBe("known");
  });

  it("a player pin reads as a place for the whole table", () => {
    const pin = createPlayerPin(PIN_ID, "tobias", "Tobias", { text: "Acampamos aqui" });

    expect(readPin(pin, "comedor", PLAYER_ROLE)).toBe("known");
  });
});

describe("isHiddenFromTable", () => {
  it("a fresh GM pin is still a draft", () => {
    expect(isHiddenFromTable(createGmPin(PIN_ID))).toBe(true);
  });

  it("one player at rumour is enough to stop it being a draft", () => {
    const pin = createGmPin(PIN_ID, {
      ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.LIMITED },
    });

    expect(isHiddenFromTable(pin)).toBe(false);
  });

  it("a pin published to the table is not a draft", () => {
    const pin = createGmPin(PIN_ID, { ownership: { default: OwnershipLevel.OBSERVER } });

    expect(isHiddenFromTable(pin)).toBe(false);
  });

  it("a player pin is never a draft — it is table talk", () => {
    expect(isHiddenFromTable(createPlayerPin(PIN_ID, "tobias", "Tobias"))).toBe(false);
  });
});

describe("levelFor", () => {
  it("reports the level the reveal controls should show as active", () => {
    const pin = createGmPin(PIN_ID, {
      ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.LIMITED },
    });

    expect(levelFor(pin, "tobias")).toBe(OwnershipLevel.LIMITED);
    expect(levelFor(pin, "comedor")).toBe(OwnershipLevel.NONE);
  });
});
