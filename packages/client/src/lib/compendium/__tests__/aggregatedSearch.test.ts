/**
 * aggregatedSearch.test.ts — the client half of the whole-collection search
 * (spec 43, G091).
 *
 * The aggregated body of REQ-CPD-012 is fed by ONE server query
 * (`compendium:searchAll`, DEC-CPD-02) — not by N pack searches stitched
 * together on the client, which would mean downloading ~12 thousand documents
 * to be able to look at them. These tests pin the query the panel sends and the
 * reading of the answer: grouped by document type, each line naming its source,
 * each group saying how many it left out.
 *
 * Covers REQ-CPD-012, REQ-CPD-014 and the client half of REQ-CPD-032.
 */

import { describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";

import { COMPENDIUM_SEARCH_ALL_QUERY, searchAllPacks } from "../compendiumApi.js";
import { buildSearchAllPayload, normalizeAggregatedSearchResult } from "../compendiumBrowser.js";
import { buildResultLine } from "../resultLine.js";
import {
  initialBrowserScope,
  buildScopedSearchQuery,
  setFacet,
  setSearch,
} from "../browserScope.js";

interface SentQuery {
  type: string;
  payload: unknown;
}

/** Socket that records the one query it is given and acks with `result`. */
function recordingSocket(sent: SentQuery[], result: unknown): Socket {
  return {
    connected: true,
    emit: (
      event: string,
      envelope: { type: string; payload: unknown },
      ack: (a: { ok: boolean; result?: unknown }) => void,
    ) => {
      sent.push({ type: `${event}/${envelope.type}`, payload: envelope.payload });
      ack({ ok: true, result });
    },
  } as unknown as Socket;
}

function line(uuid: string, name: string, extra: Record<string, unknown> = {}): unknown {
  return {
    entry: { _id: uuid.split(".").at(-1), uuid, name, img: null, type: null, index: {} },
    ...extra,
  };
}

describe("aggregated search — one question to the server, not one per pack", () => {
  it("REQ-CPD-014: the whole-collection search is a single query, with no pack named", async () => {
    const sent: SentQuery[] = [];
    const state = setFacet(setSearch(initialBrowserScope(), "fogo"), "maxLevel", 3);
    const payload = buildSearchAllPayload(buildScopedSearchQuery(state));

    await searchAllPacks(recordingSocket(sent, { groups: [] }), payload);

    // ONE query for the whole collection — not one per pack (DEC-CPD-02).
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe(`query/${COMPENDIUM_SEARCH_ALL_QUERY}`);
    expect(sent[0]?.payload).toEqual({
      text: "fogo",
      filters: { "system.level.value": { lte: 3 } },
    });
    // Nothing in the payload names a pack: the scope is the whole collection.
    expect(JSON.stringify(sent[0]?.payload)).not.toContain("packId");
  });

  it("REQ-CPD-012: the server's own answer shape reads straight into the body", () => {
    // Exactly what `compendium:searchAll` acks (CompendiumSearchAllResult):
    // flat entries carrying `packId`/`packLabel`, plus the truncation counts.
    const result = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Item",
          total: 37,
          truncated: true,
          omitted: 36,
          packs: [{ packId: "pf2e.spells-core", label: "Magias", matched: 37 }],
          entries: [
            {
              _id: "s1",
              uuid: "Compendium.pf2e.spells-core.Item.s1",
              name: "Fireball",
              namePt: "Bola de Fogo",
              img: null,
              type: "spell",
              index: {},
              packId: "pf2e.spells-core",
              packLabel: "Magias",
            },
          ],
        },
      ],
      totalMatched: 37,
      limitPerGroup: 20,
      packsSearched: 12,
    });

    const group = result.groups[0];
    expect(group?.documentType).toBe("Item");
    expect(group?.total).toBe(37);
    expect(group?.omitted).toBe(36);
    expect(group?.lines[0]?.packLabel).toBe("Magias");
    expect(group?.lines[0]?.entry.namePt).toBe("Bola de Fogo");
  });

  it("REQ-CPD-012: the answer arrives grouped by type, each line naming its pack", () => {
    const result = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Actor",
          total: 42,
          lines: [
            line("Compendium.pf2e.bestiary-core.Actor.g1", "Goblin Warrior", {
              packId: "pf2e.bestiary-core",
              packLabel: "Bestiário",
            }),
          ],
        },
        {
          documentType: "Item",
          total: 2,
          lines: [
            line("Compendium.pf2e.spells-core.Item.s1", "Fireball", {
              packId: "pf2e.spells-core",
              packLabel: "Magias",
            }),
            line("Compendium.pf2e.equipment-core.Item.e1", "Torch", {
              packId: "pf2e.equipment-core",
              packLabel: "Equipamento",
            }),
          ],
        },
      ],
    });

    expect(result.groups.map((g) => g.documentType)).toEqual(["Actor", "Item"]);
    expect(result.groups[1]?.lines.map((l) => l.packLabel)).toEqual(["Magias", "Equipamento"]);
    expect(result.groups[0]?.lines[0]?.entry.name).toBe("Goblin Warrior");
  });

  it("REQ-CPD-012: a truncated group says how many it left out; a whole one says none", () => {
    const result = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Actor",
          total: 42,
          lines: [line("Compendium.p.Actor.a", "One", { packId: "p", packLabel: "P" })],
        },
        {
          documentType: "Item",
          total: 1,
          lines: [line("Compendium.p.Item.b", "Two", { packId: "p", packLabel: "P" })],
        },
      ],
    });

    expect(result.groups[0]?.omitted).toBe(41);
    expect(result.groups[1]?.omitted).toBe(0);
  });

  it("REQ-CPD-012: a flat answer is grouped here, with the source read off the uuid", () => {
    const result = normalizeAggregatedSearchResult({
      entries: [
        line("Compendium.pf2e.spells-core.Item.s1", "Fireball"),
        line("Compendium.pf2e.bestiary-core.Actor.g1", "Goblin"),
        line("Compendium.pf2e.spells-core.Item.s2", "Ignition"),
      ],
    });

    expect(result.groups.map((g) => g.documentType)).toEqual(["Item", "Actor"]);
    expect(result.groups[0]?.lines[0]?.packId).toBe("pf2e.spells-core");
    expect(result.groups[0]?.total).toBe(2);
  });

  it("REQ-CPD-012: a broken answer shows nothing instead of taking the panel down", () => {
    expect(normalizeAggregatedSearchResult(null).groups).toEqual([]);
    expect(normalizeAggregatedSearchResult({ groups: "nope" }).groups).toEqual([]);
    // A line with no uuid is dropped, the rest of the group survives.
    const partial = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Item",
          total: 2,
          lines: [{ entry: { name: "no uuid" } }, line("Compendium.p.Item.b", "Two")],
        },
      ],
    });
    expect(partial.groups[0]?.lines).toHaveLength(1);
    expect(partial.groups[0]?.omitted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// REQ-CPD-032 — the truncated group must offer a way INTO the pack
// ---------------------------------------------------------------------------
//
// The server half (the tally in the payload) is pinned by
// `packages/server/src/__tests__/compendium-search-all.test.ts`. This is the
// client half: the count of what was hidden is useless on its own, so the
// per-pack tally has to survive the reading of the answer — it is what names
// the pack the reader is sent to.

describe("aggregated search — a truncated group offers the pack it hid", () => {
  it("REQ-CPD-032: the per-pack tally survives into the group the body draws", () => {
    const result = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Actor",
          total: 60,
          truncated: true,
          omitted: 59,
          packs: [
            { packId: "pf2e.bestiary-core", label: "Bestiário", matched: 48 },
            { packId: "world.meus-npcs", label: "Meus NPCs", matched: 12 },
          ],
          entries: [
            {
              _id: "g1",
              uuid: "Compendium.pf2e.bestiary-core.Actor.g1",
              name: "Goblin Warrior",
              img: null,
              type: "npc",
              index: {},
              packId: "pf2e.bestiary-core",
              packLabel: "Bestiário",
            },
          ],
        },
      ],
    });

    const group = result.groups[0];
    expect(group?.omitted).toBe(59);
    // Each contributing pack is nameable and openable, biggest first.
    expect(group?.packs.map((p) => p.packId)).toEqual(["pf2e.bestiary-core", "world.meus-npcs"]);
    expect(group?.packs[0]?.label).toBe("Bestiário");
    expect(group?.packs[0]?.matched).toBe(48);
  });

  it("REQ-CPD-032: the tallies come biggest contributor first, whatever order they arrive in", () => {
    const result = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Item",
          total: 30,
          packs: [
            { packId: "a", label: "A", matched: 3 },
            { packId: "b", label: "B", matched: 27 },
          ],
          entries: [],
        },
      ],
    });

    expect(result.groups[0]?.packs.map((p) => p.packId)).toEqual(["b", "a"]);
  });

  it("REQ-CPD-032: an answer with no tally still names the packs its lines came from", () => {
    // Older/flat shapes carry no `packs`. A truncated group with no way in at
    // all would be the defect; the lines that DID arrive name their source.
    const result = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Item",
          total: 40,
          lines: [
            line("Compendium.pf2e.spells-core.Item.s1", "Fireball", {
              packId: "pf2e.spells-core",
              packLabel: "Magias",
            }),
            line("Compendium.pf2e.spells-core.Item.s2", "Ignition", {
              packId: "pf2e.spells-core",
              packLabel: "Magias",
            }),
          ],
        },
      ],
    });

    expect(result.groups[0]?.omitted).toBe(38);
    expect(result.groups[0]?.packs).toEqual([
      { packId: "pf2e.spells-core", label: "Magias", matched: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The tolerance the normalizer promises has to reach the DRAWING side
// ---------------------------------------------------------------------------

describe("aggregated search — a half-formed line degrades instead of throwing", () => {
  it("REQ-CPD-012: a line with no index bag still builds, instead of taking the panel down", () => {
    const result = normalizeAggregatedSearchResult({
      groups: [
        {
          documentType: "Item",
          total: 1,
          entries: [{ uuid: "Compendium.pf2e.spells-core.Item.s1", name: "Fireball" }],
        },
      ],
    });

    const readLine = result.groups[0]?.lines[0];
    expect(readLine).toBeDefined();
    // The missing halves are filled in, so every consumer can dereference them.
    expect(readLine?.entry.index).toEqual({});
    expect(readLine?.entry.img).toBeNull();
    expect(readLine?.entry.type).toBeNull();

    // REQ-CPD-041/043: building the drawn line reads `entry.index` for the
    // declared fields and for the world seal. Before the fix this threw a
    // TypeError inside the markup, which takes the whole panel down.
    expect(() =>
      buildResultLine(readLine!.entry, {
        documentType: "Item",
        packId: "pf2e.spells-core",
        packLabel: "Magias",
        locale: "pt-BR",
        indexFields: ["system.level.value"],
        viewerIsPrivileged: false,
      }),
    ).not.toThrow();

    const built = buildResultLine(readLine!.entry, {
      documentType: "Item",
      packId: "pf2e.spells-core",
      packLabel: "Magias",
      locale: "pt-BR",
      indexFields: ["system.level.value"],
      viewerIsPrivileged: false,
    });
    expect(built.name.map((s) => s.text).join("")).toBe("Fireball");
    expect(built.fields).toEqual([]);
    expect(built.inWorld).toBe(false);
  });
});
