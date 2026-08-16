/**
 * Integration test — every document in the BUILT packs (systems/etmos/packs/)
 * validates against its Zod schema, and the particula catalog count matches
 * CA-13 exactly. Guards scripts/build-packs.mjs against silent drift from the
 * schemas (e.g. the mundo_associado normalization bug caught during B1).
 *
 * Requires `pnpm build:packs` (or `node scripts/build-packs.mjs`) to have run
 * at least once — skips gracefully if the packs directory doesn't exist yet
 * (fresh checkout before the first build).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ParticulaSystemSchema } from "../schemas/item-particula.js";
import { OrigemSystemSchema } from "../schemas/item-origem.js";
import { HabilidadeSystemSchema } from "../schemas/item-habilidade.js";
import { AntagonistaSystemSchema } from "../schemas/actor-antagonista.js";

const PACKS_DIR = join(__dirname, "..", "..", "packs");

function loadDocs(slug: string): Array<Record<string, unknown>> {
  const path = join(PACKS_DIR, slug, "documents.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

const particulas = loadDocs("particulas");
const origens = loadDocs("origens");
const habilidades = loadDocs("habilidades");
const antagonistas = loadDocs("antagonistas");

const packsBuilt = particulas.length > 0;

describe.skipIf(!packsBuilt)("built packs validate against Zod schemas", () => {
  it("etmos.particulas: every document validates + count is 80 (81 - Mat)", () => {
    expect(particulas).toHaveLength(80);
    for (const doc of particulas) {
      const result = ParticulaSystemSchema.safeParse(doc["system"]);
      expect(
        result.success,
        `doc ${String(doc["name"])} failed: ${JSON.stringify(result.success ? null : result.error.issues)}`,
      ).toBe(true);
    }
    expect(particulas.some((d) => (d["system"] as Record<string, unknown>)["slug"] === "mat")).toBe(
      false,
    );
  });

  it("etmos.origens: every document validates", () => {
    expect(origens.length).toBeGreaterThan(0);
    for (const doc of origens) {
      const result = OrigemSystemSchema.safeParse(doc["system"]);
      expect(result.success, `doc ${String(doc["name"])} failed`).toBe(true);
    }
  });

  it("etmos.habilidades: every document validates", () => {
    expect(habilidades.length).toBeGreaterThan(0);
    for (const doc of habilidades) {
      const result = HabilidadeSystemSchema.safeParse(doc["system"]);
      expect(result.success, `doc ${String(doc["name"])} failed`).toBe(true);
    }
  });

  it("etmos.antagonistas: every document validates", () => {
    expect(antagonistas.length).toBeGreaterThan(0);
    for (const doc of antagonistas) {
      const result = AntagonistaSystemSchema.safeParse(doc["system"]);
      expect(result.success, `doc ${String(doc["name"])} failed`).toBe(true);
    }
  });

  it("particula catalog category counts match CA-13 (17/19/34/10 after Mat exclusion)", () => {
    const counts: Record<string, number> = {};
    for (const doc of particulas) {
      const categoria = (doc["system"] as Record<string, unknown>)["categoria"] as string;
      counts[categoria] = (counts[categoria] ?? 0) + 1;
    }
    expect(counts["funcao"]).toBe(17);
    expect(counts["objeto"]).toBe(19);
    expect(counts["caracteristica"]).toBe(34);
    expect(counts["complemento"]).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Pack audience — REQ-CMP-004a, REQ-CMP-010a, REQ-CPD-071
//
// `antagonista` is the Etmos creature (REQ-ETM-002), and a shelf of creatures
// read by a player is the monster manual open on the table. The manifest only
// DECLARES the audience — an absent field parses as "all" (REQ-CMP-004a), so a
// silent manifest is a manifest published to the players; the server-side read
// API is what then keeps a `gm` pack out of listings, searches and document
// reads (REQ-CMP-010a, REQ-CPD-071).
//
// Requirement ownership: spec 43 names PF2e in REQ-CPD-072 and spec 19 never got
// the sibling amendment, so what binds Etmos today is the system-agnostic pair
// REQ-CMP-004a + REQ-CPD-071. Registered as an open question.
//
// Read from what each pack CONTAINS, never from a list of slugs — same rule the
// generator applies (systems/etmos/scripts/build-packs.mjs), so the next
// antagonist pack is born `gm` without anyone editing a list here.
// ---------------------------------------------------------------------------

const GM_ONLY_DOCUMENT_TYPES = new Set(["antagonista"]);

function loadPackJson(slug: string): Record<string, unknown> {
  const path = join(PACKS_DIR, slug, "pack.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const PACK_SLUGS = ["particulas", "origens", "habilidades", "antagonistas"];

describe.skipIf(!packsBuilt)("built packs declare a pack audience", () => {
  const gmOnlySlugs = PACK_SLUGS.filter((slug) =>
    loadDocs(slug).some((doc) => GM_ONLY_DOCUMENT_TYPES.has(String(doc["type"]))),
  );

  it("REQ-CMP-004a: every etmos pack.json declares an audience — silence would publish it to everyone", () => {
    const missing = PACK_SLUGS.filter((slug) => loadPackJson(slug)["audience"] === undefined);
    expect(missing, `packs without a declared audience: ${missing.join(", ")}`).toEqual([]);
  });

  it("REQ-CPD-071 / REQ-CMP-010a: every etmos pack carrying antagonists is published with audience 'gm'", () => {
    // Non-vacuity guard: the content detector must actually be finding the
    // antagonist pack, otherwise the loop below would pass for free.
    expect(gmOnlySlugs, "no antagonist pack found — the content detector is broken").toContain(
      "antagonistas",
    );

    const offenders: string[] = [];
    for (const slug of gmOnlySlugs) {
      const packJson = loadPackJson(slug);
      if (packJson["documentType"] !== "Actor") {
        offenders.push(
          `[${slug}] carries antagonists but documentType is "${String(packJson["documentType"])}"`,
        );
      }
      if (packJson["audience"] !== "gm") {
        offenders.push(`[${slug}] audience is "${String(packJson["audience"])}", expected "gm"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("REQ-CMP-004a: every etmos pack without antagonists is published with audience 'all'", () => {
    const offenders: string[] = [];
    for (const slug of PACK_SLUGS) {
      if (gmOnlySlugs.includes(slug)) continue;
      const packJson = loadPackJson(slug);
      if (packJson["audience"] !== "all") {
        offenders.push(`[${slug}] audience is "${String(packJson["audience"])}", expected "all"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
