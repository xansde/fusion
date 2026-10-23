/**
 * compendiumShelf.test.ts — the view model behind the shelf body (spec 43, G092).
 *
 * The shelf is the answer to "what is in the collection", and it answers it the
 * same way for every pack: type, label, count and LICENSE. The license is the
 * one field this project cannot afford to lose (DEC-CPD-07), so it is asserted
 * as data here and as an untruncatable box in `CompendiumShelf.test.ts`.
 *
 * Covers REQ-CPD-020 (grouping by document type, collapsible, count per group),
 * REQ-CPD-021 (label + document count + license per pack), REQ-CPD-022 (a `gm`
 * pack is marked as such on the privileged shelf), REQ-CPD-023 (the
 * collapsed/expanded state lives on the device, per world and user) and
 * REQ-CPD-025 (world packs share the groups of system packs and are told apart
 * by the license).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PackManifest } from "@fusion/shared";

import {
  buildShelfGroups,
  loadCollapsedGroups,
  saveCollapsedGroups,
  shelfCollapseStorageKey,
  toggleCollapsedGroup,
} from "../compendiumShelf.js";

// ---------------------------------------------------------------------------
// localStorage mock (same technique as window-manager.test.ts)
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePack(overrides: Partial<PackManifest> & { id: string }): PackManifest {
  return {
    label: overrides.id,
    documentType: "Item",
    systemId: "pf2e",
    indexFields: [],
    license: {
      license: "ORC",
      attribution: "Paizo Inc.",
      reservedNotice: "Reserved Material notice",
    },
    audience: "all",
    source: { repo: "github.com/foundryvtt/pf2e", version: "v8.2.0", importerVersion: "1.0.0" },
    documentCount: 0,
    generatedAt: "2026-08-16T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  } as PackManifest;
}

const NOTHING_COLLAPSED: ReadonlySet<string> = new Set<string>();

const GM_VIEW = { viewerIsPrivileged: true, collapsed: NOTHING_COLLAPSED };
const PLAYER_VIEW = { viewerIsPrivileged: false, collapsed: NOTHING_COLLAPSED };

// ---------------------------------------------------------------------------

describe("shelf groups", () => {
  it("REQ-CPD-020: packs are grouped by document type, each group counting its packs", () => {
    const groups = buildShelfGroups(
      [
        makePack({ id: "pf2e.equipment", documentType: "Item" }),
        makePack({ id: "pf2e.bestiary-core", documentType: "Actor" }),
        makePack({ id: "pf2e.spells", documentType: "Item" }),
      ],
      GM_VIEW,
    );

    const byType = new Map(groups.map((group) => [group.documentType, group]));
    expect([...byType.keys()].sort()).toEqual(["Actor", "Item"]);
    expect(byType.get("Item")?.packCount).toBe(2);
    expect(byType.get("Actor")?.packCount).toBe(1);
    // The count is the number of PACKS in the group, not of documents.
    expect(byType.get("Item")?.packs).toHaveLength(2);
  });

  it("REQ-CPD-020: a group carries its own collapsed flag, taken from the given state", () => {
    const groups = buildShelfGroups(
      [
        makePack({ id: "pf2e.equipment", documentType: "Item" }),
        makePack({ id: "pf2e.bestiary-core", documentType: "Actor" }),
      ],
      { viewerIsPrivileged: true, collapsed: new Set(["Item"]) },
    );

    expect(groups.find((group) => group.documentType === "Item")?.collapsed).toBe(true);
    expect(groups.find((group) => group.documentType === "Actor")?.collapsed).toBe(false);
    // Collapsing hides nothing from the model — the body decides what to draw.
    expect(groups.find((group) => group.documentType === "Item")?.packs).toHaveLength(1);
  });

  it("REQ-CPD-021: every row carries label, document count and license", () => {
    const [group] = buildShelfGroups(
      [
        makePack({
          id: "pf2e.equipment",
          label: "Equipamento",
          documentCount: 5241,
          license: {
            license: "OGL-1.0a",
            attribution: "Paizo Inc.",
            reservedNotice: "Reserved Material",
          },
        }),
      ],
      GM_VIEW,
    );

    const row = group?.packs[0];
    expect(row?.label).toBe("Equipamento");
    expect(row?.documentCount).toBe(5241);
    expect(row?.license).toBe("OGL-1.0a");
    // The attribution travels too, for the tooltip — but the identifier is what
    // the shelf must always be able to show (DEC-CPD-07).
    expect(row?.licenseDetail).toContain("Paizo Inc.");
    expect(row?.licenseDetail).toContain("Reserved Material");
  });

  it("REQ-CPD-021: license is never empty — a pack without attribution still shows one", () => {
    const [group] = buildShelfGroups(
      [
        makePack({
          id: "world.homebrew",
          license: { license: "custom", attribution: "", reservedNotice: "" },
        }),
      ],
      GM_VIEW,
    );

    expect(group?.packs[0]?.license).toBe("custom");
    expect(group?.packs[0]?.license.length).toBeGreaterThan(0);
  });

  it("REQ-CPD-022: a `gm` pack is marked as such on the privileged shelf", () => {
    const [group] = buildShelfGroups(
      [
        makePack({ id: "pf2e.bestiary-core", documentType: "Actor", audience: "gm" }),
        makePack({ id: "pf2e.hazards", documentType: "Actor", audience: "all" }),
      ],
      GM_VIEW,
    );

    const byId = new Map(group?.packs.map((row) => [row.id, row]));
    expect(byId.get("pf2e.bestiary-core")?.gmOnly).toBe(true);
    expect(byId.get("pf2e.hazards")?.gmOnly).toBe(false);
  });

  it("REQ-CPD-022: the mark is for the privileged shelf only — it never advertises to a player", () => {
    // The server already keeps `gm` packs out of a player's list; if one ever
    // leaked through, the shelf must not label it "the GM sees this and you do not".
    const [group] = buildShelfGroups(
      [makePack({ id: "pf2e.bestiary-core", documentType: "Actor", audience: "gm" })],
      PLAYER_VIEW,
    );

    expect(group?.packs[0]?.gmOnly).toBe(false);
  });

  it("REQ-CPD-025: a world pack shares the group of the system packs, told apart by its license", () => {
    const groups = buildShelfGroups(
      [
        makePack({
          id: "pf2e.equipment",
          label: "Equipamento",
          documentType: "Item",
          license: { license: "ORC", attribution: "Paizo Inc.", reservedNotice: "" },
        }),
        makePack({
          id: "world.itens-da-mesa",
          label: "Itens da mesa",
          documentType: "Item",
          systemId: "world",
          license: { license: "custom", attribution: "Mesa do Xande", reservedNotice: "" },
          source: { repo: null, version: null, importerVersion: "1.0.0" },
        }),
      ],
      GM_VIEW,
    );

    // One group, not a separate shelf section for what the world made.
    expect(groups).toHaveLength(1);
    const licenses = groups[0]?.packs.map((row) => row.license);
    expect(licenses).toContain("ORC");
    expect(licenses).toContain("custom");
    // ...and nothing else in the row distinguishes them: the license is the tell.
    expect(groups[0]?.packs.every((row) => !row.gmOnly)).toBe(true);
  });
});

describe("collapsed groups, on the device, per world and user", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("REQ-CPD-023: the storage key is scoped by world and by user", () => {
    const a = shelfCollapseStorageKey("world-1", "user-1");
    const b = shelfCollapseStorageKey("world-2", "user-1");
    const c = shelfCollapseStorageKey("world-1", "user-2");

    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toContain("world-1");
    expect(a).toContain("user-1");
  });

  it("REQ-CPD-023: what was collapsed comes back, and only for that world and user", () => {
    saveCollapsedGroups("world-1", "user-1", new Set(["Item", "Actor"]));

    expect([...loadCollapsedGroups("world-1", "user-1")].sort()).toEqual(["Actor", "Item"]);
    expect([...loadCollapsedGroups("world-2", "user-1")]).toEqual([]);
    expect([...loadCollapsedGroups("world-1", "user-2")]).toEqual([]);
  });

  it("REQ-CPD-023: nothing stored, or stored garbage, opens every group instead of failing", () => {
    expect([...loadCollapsedGroups("world-1", "user-1")]).toEqual([]);

    localStorage.setItem(shelfCollapseStorageKey("world-1", "user-1"), "{not json");
    expect([...loadCollapsedGroups("world-1", "user-1")]).toEqual([]);

    localStorage.setItem(shelfCollapseStorageKey("world-1", "user-1"), '{"Item":true}');
    expect([...loadCollapsedGroups("world-1", "user-1")]).toEqual([]);

    localStorage.setItem(shelfCollapseStorageKey("world-1", "user-1"), '["Item", 7, null]');
    expect([...loadCollapsedGroups("world-1", "user-1")]).toEqual(["Item"]);
  });

  it("REQ-CPD-023: toggling is a pure transition — the previous set is left alone", () => {
    const before: ReadonlySet<string> = new Set(["Item"]);

    const afterCollapse = toggleCollapsedGroup(before, "Actor");
    expect([...afterCollapse].sort()).toEqual(["Actor", "Item"]);
    expect([...before]).toEqual(["Item"]);

    const afterExpand = toggleCollapsedGroup(afterCollapse, "Item");
    expect([...afterExpand]).toEqual(["Actor"]);
  });

  it("REQ-CPD-023: a shelf built after a reload reads the collapsed groups back", () => {
    saveCollapsedGroups("world-1", "user-1", toggleCollapsedGroup(new Set<string>(), "Item"));

    const groups = buildShelfGroups(
      [
        makePack({ id: "pf2e.equipment", documentType: "Item" }),
        makePack({ id: "pf2e.bestiary-core", documentType: "Actor" }),
      ],
      { viewerIsPrivileged: true, collapsed: loadCollapsedGroups("world-1", "user-1") },
    );

    expect(groups.find((group) => group.documentType === "Item")?.collapsed).toBe(true);
    expect(groups.find((group) => group.documentType === "Actor")?.collapsed).toBe(false);
  });
});
