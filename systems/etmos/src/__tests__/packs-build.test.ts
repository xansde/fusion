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
