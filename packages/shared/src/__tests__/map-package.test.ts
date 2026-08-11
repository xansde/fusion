/**
 * Portable map packages — REQ-MREG-018/019/022/023/024, DEC-MREG-07.
 *
 * A region prepared in one world has to be able to travel: another campaign,
 * another server, another GM's table. It travels as a JSON file next to the
 * terrain image, and the rules that make it safe are asserted here:
 *
 *  1. the package never carries `ownership` — who saw what is that table's
 *     history, and a userId from another server points at nobody here;
 *  2. it never carries comments — that table's conversation stays there;
 *  3. every imported pin is born hidden, exactly like a freshly placed one.
 */

import { describe, it, expect } from "vitest";
import {
  FUSION_MAP_FORMAT,
  FusionMapPackageSchema,
  regionMapToPackage,
  mapPackageToRegionMap,
  defaultRegionMapDocument,
  createGmPin,
  createPlayerPin,
  RegionMapDocumentSchema,
  OwnershipLevel,
} from "../index.js";

const MAP_ID = "aaaaaaaaaaaaaaaa";
const PIN_A = "bbbbbbbbbbbbbbbb";
const PIN_B = "cccccccccccccccc";
const PIN_C = "eeeeeeeeeeeeeeee";
const COMMENT_ID = "ffffffffffffffff";

/** A region as a GM would have prepared it: pins placed, some already revealed. */
function preparedRegion() {
  return RegionMapDocumentSchema.parse({
    ...defaultRegionMapDocument(MAP_ID, "Vale de Godford"),
    image: "/assets/maps/godford.webp",
    imageWidth: 4000,
    imageHeight: 3000,
    scaleValue: 120,
    scaleUnits: "km",
    pins: [
      createGmPin(PIN_A, {
        x: 0.3,
        y: 0.28,
        text: "Ruínas de Godford",
        description: "Uma torre partida ao meio.",
        icon: "🏚",
        // Revealed at the table of origin — must NOT travel.
        ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER },
        flags: { fusion: { sourceId: "godford-ruins" } },
      }),
      createGmPin(PIN_B, {
        x: 0.6,
        y: 0.36,
        text: "Passagem do Norte",
        ownership: { default: OwnershipLevel.NONE, comedor: OwnershipLevel.LIMITED },
        flags: { fusion: { portal: { mapId: "dddddddddddddddd" } } },
      }),
      // A player's annotation, with the table's conversation on it.
      createPlayerPin(PIN_C, "tobias", "Tobias", {
        x: 0.5,
        y: 0.5,
        text: "Acampamos aqui",
        comments: [
          {
            _id: COMMENT_ID,
            authorId: "tobias",
            authorName: "Tobias",
            text: "Tem lenha seca do lado leste.",
            createdAt: 1,
          },
        ],
      }),
    ],
  });
}

describe("regionMapToPackage", () => {
  it("carries what the map IS: image size, scale, terrain filename and pins", () => {
    const pkg = regionMapToPackage(preparedRegion());

    expect(pkg.format).toBe(FUSION_MAP_FORMAT);
    expect(pkg.name).toBe("Vale de Godford");
    expect(pkg.imageWidth).toBe(4000);
    expect(pkg.imageHeight).toBe(3000);
    expect(pkg.scaleValue).toBe(120);
    expect(pkg.scaleUnits).toBe("km");
    // The image travels as a FILENAME — the origin world's asset path is
    // meaningless on the machine that imports it.
    expect(pkg.image).toBe("godford.webp");
    expect(pkg.pins).toHaveLength(3);
  });

  it("never exports ownership — the reveal stays at the table it happened (REQ-MREG-019)", () => {
    const serialised = JSON.stringify(regionMapToPackage(preparedRegion()));

    expect(serialised).not.toContain("ownership");
    expect(serialised).not.toContain("tobias");
    expect(serialised).not.toContain("comedor");
  });

  it("never exports comments — that table's conversation stays at that table", () => {
    const serialised = JSON.stringify(regionMapToPackage(preparedRegion()));

    expect(serialised).not.toContain("comments");
    expect(serialised).not.toContain("lenha seca");
  });

  it("keeps the portal flag and the source identity of each pin", () => {
    const pkg = regionMapToPackage(preparedRegion());
    const [ruins, pass] = pkg.pins;

    expect(ruins!.sourceId).toBe("godford-ruins");
    expect(ruins!.description).toBe("Uma torre partida ao meio.");
    expect(pass!.flags).toEqual({ fusion: { portal: { mapId: "dddddddddddddddd" } } });
  });

  it("survives a JSON round trip through the schema", () => {
    const pkg = regionMapToPackage(preparedRegion());
    const reparsed = FusionMapPackageSchema.parse(JSON.parse(JSON.stringify(pkg)));

    expect(reparsed).toEqual(pkg);
  });
});

describe("mapPackageToRegionMap", () => {
  const pkg = regionMapToPackage(preparedRegion());

  it("takes the image chosen on the way in, and the map's own geometry", () => {
    const map = mapPackageToRegionMap(pkg, { image: "/assets/maps/godford.webp" });

    expect(map.image).toBe("/assets/maps/godford.webp");
    expect(map.imageWidth).toBe(4000);
    expect(map.imageHeight).toBe(3000);
    expect(map.scaleValue).toBe(120);
  });

  it("every imported pin is born hidden, as a GM pin (REQ-MREG-022, REQ-DOC-056)", () => {
    const map = mapPackageToRegionMap(pkg, { image: "/x.webp" });

    expect(map.pins).toHaveLength(3);
    for (const pin of map.pins) {
      expect(pin.ownership).toEqual({ default: OwnershipLevel.NONE });
      expect(pin.kind).toBe("gm");
      expect(pin.comments).toEqual([]);
    }
  });

  it("gives each pin a fresh id but keeps its source identity (REQ-MREG-024)", () => {
    const map = mapPackageToRegionMap(pkg, { image: "/x.webp" });
    const ids = map.pins.map((p) => p._id);

    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(PIN_A);
    const flags = map.pins[0]!.flags as { fusion?: { sourceId?: string } };
    expect(flags.fusion?.sourceId).toBe("godford-ruins");
  });

  it("produces a document the schema accepts as-is", () => {
    const map = mapPackageToRegionMap(pkg, { image: "/x.webp" });

    expect(() => RegionMapDocumentSchema.parse(map)).not.toThrow();
  });

  it("refuses a format version it does not know (REQ-MREG-023)", () => {
    const fromTheFuture = { ...pkg, format: FUSION_MAP_FORMAT + 1 };

    expect(() => mapPackageToRegionMap(fromTheFuture, { image: "/x.webp" })).toThrow(/formato/i);
  });

  it("round-trips: export → import → export keeps the map identical", () => {
    const map = mapPackageToRegionMap(pkg, { image: "/assets/maps/godford.webp" });
    const again = regionMapToPackage(RegionMapDocumentSchema.parse(map));

    expect(again.pins.map((p) => ({ x: p.x, y: p.y, text: p.text }))).toEqual(
      pkg.pins.map((p) => ({ x: p.x, y: p.y, text: p.text })),
    );
  });
});
