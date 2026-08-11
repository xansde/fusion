/**
 * Portable map packages — REQ-MREG-018/019/022/023/024, DEC-MREG-07.
 *
 * A region prepared in one world has to be able to travel: another campaign,
 * another server, another GM's table. It travels as a JSON file next to the
 * terrain image, and the two rules that make it safe are asserted here:
 *
 *  1. the package never carries `ownership` — who saw what is that table's
 *     history, and a userId from another server points at nobody here;
 *  2. every imported pin is born hidden, exactly like a freshly placed one.
 */

import { describe, it, expect } from "vitest";
import {
  FUSION_MAP_FORMAT,
  FusionMapPackageSchema,
  sceneToMapPackage,
  mapPackageToScene,
  defaultSceneDocument,
  defaultNoteDocument,
  SceneDocumentSchema,
  OwnershipLevel,
} from "../index.js";

const SCENE_ID = "aaaaaaaaaaaaaaaa";
const PIN_A = "bbbbbbbbbbbbbbbb";
const PIN_B = "cccccccccccccccc";

/** A region as a GM would have prepared it: pins placed, some already revealed. */
function preparedRegion() {
  return SceneDocumentSchema.parse({
    ...defaultSceneDocument(SCENE_ID, "Vale de Godford"),
    width: 4000,
    height: 3000,
    background: "/assets/maps/godford.webp",
    grid: { type: "gridless", size: 100, distance: 4, units: "km" },
    tokenVision: false,
    flags: { fusion: { mapScale: "region" } },
    notes: [
      {
        ...defaultNoteDocument(PIN_A),
        x: 1200,
        y: 850,
        text: "Ruínas de Godford",
        icon: "/assets/icons/ruin.webp",
        // Revealed at the table of origin — must NOT travel.
        ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER },
        flags: { fusion: { sourceId: "godford-ruins" } },
      },
      {
        ...defaultNoteDocument(PIN_B),
        x: 2400,
        y: 1100,
        text: "Passagem do Norte",
        ownership: { default: OwnershipLevel.NONE, comedor: OwnershipLevel.LIMITED },
        flags: { fusion: { portal: { sceneId: "dddddddddddddddd" } } },
      },
    ],
  });
}

describe("sceneToMapPackage", () => {
  it("carries what the map IS: size, scale, terrain filename and pins", () => {
    const pkg = sceneToMapPackage(preparedRegion());

    expect(pkg.format).toBe(FUSION_MAP_FORMAT);
    expect(pkg.name).toBe("Vale de Godford");
    expect(pkg.width).toBe(4000);
    expect(pkg.height).toBe(3000);
    expect(pkg.gridDistance).toBe(4);
    expect(pkg.gridUnits).toBe("km");
    expect(pkg.mapScale).toBe("region");
    // The image travels as a FILENAME — the origin world's asset path is
    // meaningless on the machine that imports it.
    expect(pkg.image).toBe("godford.webp");
    expect(pkg.pins).toHaveLength(2);
  });

  it("never exports ownership — the reveal stays at the table it happened (REQ-MREG-019)", () => {
    const pkg = sceneToMapPackage(preparedRegion());

    const serialised = JSON.stringify(pkg);
    expect(serialised).not.toContain("ownership");
    expect(serialised).not.toContain("tobias");
    expect(serialised).not.toContain("comedor");
  });

  it("keeps the portal flag and the source identity of each pin", () => {
    const pkg = sceneToMapPackage(preparedRegion());
    const [ruins, pass] = pkg.pins;

    expect(ruins!.sourceId).toBe("godford-ruins");
    expect(pass!.flags).toEqual({ fusion: { portal: { sceneId: "dddddddddddddddd" } } });
  });

  it("survives a JSON round trip through the schema", () => {
    const pkg = sceneToMapPackage(preparedRegion());
    const reparsed = FusionMapPackageSchema.parse(JSON.parse(JSON.stringify(pkg)));

    expect(reparsed).toEqual(pkg);
  });
});

describe("mapPackageToScene", () => {
  const pkg = sceneToMapPackage(preparedRegion());

  it("applies the region preset: gridless, km, no vision (REQ-MREG-001/022)", () => {
    const scene = mapPackageToScene(pkg, { background: "/assets/maps/godford.webp" });

    expect(scene.grid.type).toBe("gridless");
    expect(scene.grid.distance).toBe(4);
    expect(scene.grid.units).toBe("km");
    expect(scene.tokenVision).toBe(false);
    expect((scene.flags as { fusion?: { mapScale?: string } }).fusion?.mapScale).toBe("region");
    expect(scene.background).toBe("/assets/maps/godford.webp");
  });

  it("every imported pin is born hidden (REQ-MREG-022, REQ-DOC-056)", () => {
    const scene = mapPackageToScene(pkg, { background: "/assets/maps/godford.webp" });

    expect(scene.notes).toHaveLength(2);
    for (const note of scene.notes) {
      expect(note.ownership).toEqual({ default: OwnershipLevel.NONE });
    }
  });

  it("gives each pin a fresh id but keeps its source identity (REQ-MREG-024)", () => {
    const scene = mapPackageToScene(pkg, { background: "/assets/maps/godford.webp" });
    const ids = scene.notes.map((n) => n._id);

    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(PIN_A);
    const flags = scene.notes[0]!.flags as { fusion?: { sourceId?: string } };
    expect(flags.fusion?.sourceId).toBe("godford-ruins");
  });

  it("produces a scene the schema accepts as-is", () => {
    const scene = mapPackageToScene(pkg, { background: "/assets/maps/godford.webp" });

    expect(() => SceneDocumentSchema.parse(scene)).not.toThrow();
  });

  it("refuses a format version it does not know (REQ-MREG-023)", () => {
    const fromTheFuture = { ...pkg, format: FUSION_MAP_FORMAT + 1 };

    expect(() => mapPackageToScene(fromTheFuture, { background: "/x.webp" })).toThrow(/formato/i);
  });

  it("round-trips: export → import → export keeps the map identical", () => {
    const scene = mapPackageToScene(pkg, { background: "/assets/maps/godford.webp" });
    const again = sceneToMapPackage(SceneDocumentSchema.parse(scene));

    expect(again.pins.map((p) => ({ x: p.x, y: p.y, text: p.text }))).toEqual(
      pkg.pins.map((p) => ({ x: p.x, y: p.y, text: p.text })),
    );
  });
});
