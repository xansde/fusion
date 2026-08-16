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
 * Covers REQ-CPD-012 and REQ-CPD-014.
 */

import { describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";

import { COMPENDIUM_SEARCH_ALL_QUERY, searchAllPacks } from "../compendiumApi.js";
import { buildSearchAllPayload, normalizeAggregatedSearchResult } from "../compendiumBrowser.js";
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
