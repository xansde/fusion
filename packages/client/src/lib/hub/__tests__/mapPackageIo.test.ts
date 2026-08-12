/**
 * Carrying a map between worlds — REQ-MREG-018/019/022/023/024, DEC-MREG-07.
 *
 * The engine (`@fusion/shared`'s `map-package.ts`) already proves what a
 * package contains and what it refuses to carry. What is tested here is the
 * layer the GM actually touches: the filename the download gets, the error a
 * wrong file produces, and — the one that matters — that a map arriving from
 * somebody else's campaign lands with every pin hidden.
 */

import { describe, it, expect } from "vitest";
import {
  OwnershipLevel,
  FUSION_MAP_FORMAT,
  createGmPin,
  createPlayerPin,
  defaultRegionMapDocument,
  regionMapToPackage,
} from "@fusion/shared";
import { packageFilename, parseMapPackage, packageToCreateFields } from "../mapPackageIo.js";

const MAP_ID = "mmmmmmmmmmmmmmmm";
const PIN_A = "aaaaaaaaaaaaaaaa";
const PIN_B = "bbbbbbbbbbbbbbbb";

/** A map as a GM would have it mid-campaign: revealed pins, a conversation. */
function preparedMap() {
  const map = defaultRegionMapDocument(MAP_ID, "Vale de Godford");
  map.image = "/assets/godford.webp";
  map.imageWidth = 1600;
  map.imageHeight = 900;
  map.pins = [
    createGmPin(PIN_A, {
      x: 0.25,
      y: 0.4,
      text: "Ruínas de Godford",
      description: "O gado some por aqui.",
      ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER },
      comments: [
        {
          _id: "cccccccccccccccc",
          authorId: "tobias",
          authorName: "Tobias",
          text: "Achei pegada grande demais para lobo.",
          createdAt: 1,
        },
      ],
    }),
    createPlayerPin(PIN_B, "tobias", "Tobias", { x: 0.7, y: 0.8, text: "Acampamos aqui" }),
  ];
  return map;
}

describe("packageFilename", () => {
  it("names the file after the map", () => {
    expect(packageFilename("Vale de Godford")).toBe("vale-de-godford.fusion-map.json");
  });

  it("survives accents and punctuation the filesystem would refuse", () => {
    expect(packageFilename("Ruínas: o Sino que não Toca!")).toBe(
      "ruinas-o-sino-que-nao-toca.fusion-map.json",
    );
  });

  it("falls back to a name rather than producing a dotfile", () => {
    expect(packageFilename("   ")).toBe("mapa.fusion-map.json");
    expect(packageFilename("!!!")).toBe("mapa.fusion-map.json");
  });
});

describe("parseMapPackage", () => {
  it("reads back what the exporter wrote", () => {
    const text = JSON.stringify(regionMapToPackage(preparedMap()));
    const pkg = parseMapPackage(text);

    expect(pkg.name).toBe("Vale de Godford");
    expect(pkg.pins).toHaveLength(2);
    expect(pkg.image).toBe("godford.webp");
  });

  it("says the file is not a package rather than throwing a parser error", () => {
    expect(() => parseMapPackage("isto não é json")).toThrow(/não é um arquivo JSON/i);
  });

  it("refuses a format it cannot read instead of guessing", () => {
    const text = JSON.stringify({ format: 99, name: "Do futuro", pins: [] });

    expect(() => parseMapPackage(text)).toThrow(/formato/i);
  });

  it("refuses a JSON file that is simply not a map", () => {
    expect(() => parseMapPackage(JSON.stringify({ hello: "world" }))).toThrow(
      /não é um pacote de mapa/i,
    );
  });
});

describe("packageToCreateFields", () => {
  it("lands every pin hidden — revealing is an act taken at THIS table", () => {
    const pkg = regionMapToPackage(preparedMap());
    const fields = packageToCreateFields(pkg, "/assets/outro-godford.webp");

    expect(fields.pins).toHaveLength(2);
    for (const pin of fields.pins) {
      expect(pin.ownership["default"]).toBe(OwnershipLevel.NONE);
      expect(pin.kind).toBe("gm");
    }
  });

  it("carries neither the comments nor who had seen what", () => {
    const pkg = regionMapToPackage(preparedMap());
    const fields = packageToCreateFields(pkg, "/assets/outro-godford.webp");

    const serialised = JSON.stringify(fields);
    expect(serialised).not.toContain("tobias");
    expect(serialised).not.toContain("pegada");
    for (const pin of fields.pins) {
      expect(pin.comments).toEqual([]);
      expect(pin.authorId).toBeNull();
    }
  });

  it("points the new map at the image chosen HERE, not at the old path", () => {
    const pkg = regionMapToPackage(preparedMap());
    const fields = packageToCreateFields(pkg, "/assets/outro-godford.webp");

    expect(fields.image).toBe("/assets/outro-godford.webp");
    expect(fields.imageWidth).toBe(1600);
  });

  it("keeps the map itself open to the table — what is hidden is the pins", () => {
    const pkg = regionMapToPackage(preparedMap());
    const fields = packageToCreateFields(pkg, null);

    expect(fields.ownership["default"]).toBe(OwnershipLevel.OBSERVER);
  });

  it("keeps place identity across the trip (REQ-MREG-024)", () => {
    const map = preparedMap();
    map.pins[0]!.flags = { fusion: { sourceId: "godford-ruins" } };
    const pkg = regionMapToPackage(map);

    const fields = packageToCreateFields(pkg, null);

    expect(fields.pins[0]?.flags["fusion"]?.["sourceId"]).toBe("godford-ruins");
  });

  it("declares the format the round trip was written against", () => {
    expect(FUSION_MAP_FORMAT).toBe(2);
  });
});
