/**
 * The region map document — DEC-MREG-08, REQ-MREG-025..029.
 *
 * What is asserted here is the pair of defaults the whole feature rests on: a
 * GM pin is prep and starts hidden, a player pin is table talk and starts
 * visible. Get either backwards and the map either spoils the campaign or
 * silently swallows what a player wrote.
 */

import { describe, it, expect } from "vitest";
import {
  MapPinSchema,
  PinCommentSchema,
  RegionMapDocumentSchema,
  clampNormalised,
  createGmPin,
  createPlayerPin,
  defaultRegionMapDocument,
  OwnershipLevel,
} from "../index.js";

const PIN_ID = "aaaaaaaaaaaaaaaa";
const MAP_ID = "bbbbbbbbbbbbbbbb";
const COMMENT_ID = "cccccccccccccccc";

describe("createGmPin", () => {
  it("is born hidden from everyone (REQ-DOC-056)", () => {
    const pin = createGmPin(PIN_ID, { text: "Ruínas" });

    expect(pin.ownership).toEqual({ default: OwnershipLevel.NONE });
    expect(pin.kind).toBe("gm");
    expect(pin.authorId).toBeNull();
  });

  it("stays a GM pin even if the caller asks for another kind", () => {
    const pin = createGmPin(PIN_ID, { kind: "player" });

    expect(pin.kind).toBe("gm");
  });
});

describe("createPlayerPin", () => {
  it("is born visible to the table — a player marking a place is talking to it", () => {
    const pin = createPlayerPin(PIN_ID, "tobias", "Tobias", { text: "Acampamos aqui" });

    expect(pin.ownership["default"]).toBe(OwnershipLevel.OBSERVER);
    expect(pin.kind).toBe("player");
  });

  it("records the author, and gives them ownership of what they wrote", () => {
    const pin = createPlayerPin(PIN_ID, "tobias", "Tobias");

    expect(pin.authorId).toBe("tobias");
    expect(pin.authorName).toBe("Tobias");
    expect(pin.ownership["tobias"]).toBe(OwnershipLevel.OWNER);
  });
});

describe("MapPinSchema", () => {
  it("keeps positions inside the image (normalised coordinates)", () => {
    expect(() => MapPinSchema.parse({ _id: PIN_ID, x: 1.4, y: 0.5 })).toThrow();
    expect(() => MapPinSchema.parse({ _id: PIN_ID, x: -0.1, y: 0.5 })).toThrow();
    expect(() => MapPinSchema.parse({ _id: PIN_ID, x: 0, y: 1 })).not.toThrow();
  });

  it("starts with no comments", () => {
    expect(MapPinSchema.parse({ _id: PIN_ID, x: 0.5, y: 0.5 }).comments).toEqual([]);
  });
});

describe("PinCommentSchema", () => {
  it("refuses an empty comment", () => {
    expect(() =>
      PinCommentSchema.parse({ _id: COMMENT_ID, authorId: "tobias", text: "" }),
    ).toThrow();
  });

  it("carries its author, so the table knows who said it", () => {
    const comment = PinCommentSchema.parse({
      _id: COMMENT_ID,
      authorId: "tobias",
      authorName: "Tobias",
      text: "Tem lenha seca do lado leste.",
      createdAt: 42,
    });

    expect(comment.authorId).toBe("tobias");
    expect(comment.authorName).toBe("Tobias");
  });
});

describe("RegionMapDocumentSchema", () => {
  it("a new map is visible to the table, with no image and no pins", () => {
    const map = defaultRegionMapDocument(MAP_ID, "Vale de Godford");

    expect(map.name).toBe("Vale de Godford");
    expect(map.image).toBeNull();
    expect(map.pins).toEqual([]);
    expect(map.ownership["default"]).toBe(OwnershipLevel.OBSERVER);
  });

  it("survives a JSON round trip with pins and comments", () => {
    const map = RegionMapDocumentSchema.parse({
      ...defaultRegionMapDocument(MAP_ID),
      pins: [
        createPlayerPin(PIN_ID, "tobias", "Tobias", {
          comments: [
            {
              _id: COMMENT_ID,
              authorId: "tobias",
              authorName: "Tobias",
              text: "olha o urso",
              createdAt: 1,
            },
          ],
        }),
      ],
    });

    const again = RegionMapDocumentSchema.parse(JSON.parse(JSON.stringify(map)));
    expect(again).toEqual(map);
    expect(again.pins[0]!.comments[0]!.text).toBe("olha o urso");
  });
});

describe("clampNormalised", () => {
  it("puts a click on the border where the user aimed instead of failing", () => {
    expect(clampNormalised(1.0001)).toBe(1);
    expect(clampNormalised(-0.0001)).toBe(0);
    expect(clampNormalised(0.42)).toBe(0.42);
    expect(clampNormalised(Number.NaN)).toBe(0);
  });
});
