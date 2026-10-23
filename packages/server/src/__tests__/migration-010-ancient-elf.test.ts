/**
 * Migration 010 — DEC-MC-01: o Elfo Ancião deixa de conceder a dedicação de
 * multiclasse também nos mundos JÁ CRIADOS.
 *
 * O pack corrigido não alcança quem já tem a herança na ficha: ela é copiada
 * para dentro do ator no momento em que entra. Este teste exercita a migration
 * contra um banco montado em 009 e povoado com as três situações que importam:
 * o ator que TEM a herança com a concessão ativa, o ator que não tem nada com
 * isso, e o mesmo banco migrado duas vezes (a segunda não pode duplicar nada).
 *
 * A pergunta que ele responde não é "a migration roda", é **"desativar
 * preservou a regra?"** — desativar é mover, não apagar.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, applyMigrations, registerMigrations } from "../db/index.js";
import type { FusionMigration } from "../db/index.js";
import { migration001 } from "../db/migrations/001_initial_schema.js";
import { migration002 } from "../db/migrations/002_users_sessions.js";
import { migration003 } from "../db/migrations/003_fog_exploration.js";
import { migration004 } from "../db/migrations/004_region_maps.js";
import { migration005 } from "../db/migrations/005_roll_audit_log.js";
import { migration006 } from "../db/migrations/006_constraints.js";
import { migration007 } from "../db/migrations/007_indexes.js";
import { migration008 } from "../db/migrations/008_scene_active.js";
import { migration009 } from "../db/migrations/009_assets.js";
import { migration010 } from "../db/migrations/010_dec_mc_01_ancient_elf.js";

const UP_TO_9: FusionMigration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
];
const ALL: FusionMigration[] = [...UP_TO_9, migration010];

const ANCIENT_ELF_SOURCE_ID = "Nd9hdX8rdYyRozw8";
const GRANT_UUID = "{item|flags.system.rulesSelections.ancientElf}";

let tempDirs: string[] = [];

function newTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-mig010-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** A herança como o importer a entregava ANTES da DEC-MC-01. */
function ancientElfItem(): Record<string, unknown> {
  return {
    name: "Ancient Elf",
    type: "heritage",
    system: {
      rules: [
        {
          kind: "grant-item",
          uuid: GRANT_UUID,
          raw: { key: "GrantItem", uuid: GRANT_UUID },
        },
      ],
    },
    flags: {
      fusion: {
        sourceId: ANCIENT_ELF_SOURCE_ID,
        packName: "heritages",
        unconvertedRules: [{ key: "ChoiceSet", flag: "ancientElf" }],
      },
    },
  };
}

interface ItemLike {
  system?: { rules?: { uuid?: string }[] };
  flags?: { fusion?: { disabledRules?: { decision?: string; rule?: { uuid?: string } }[] } };
}

/** Monta um banco em 009 com dois atores e um item solto, e devolve seu path. */
function seedWorldAt009(): string {
  const path = join(newTempDir(), "world.db");
  registerMigrations(UP_TO_9);
  const db = openDatabase({ path, skipIntegrityCheck: true });
  try {
    applyMigrations(db.raw, path);
    const now = Date.now();
    const insertActor = db.raw.prepare(
      "INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    );
    insertActor.run(
      "actor-elf",
      JSON.stringify({ name: "Elfo", items: [ancientElfItem()] }),
      "Elfo",
      "character",
      now,
      now,
    );
    insertActor.run(
      "actor-orc",
      JSON.stringify({
        name: "Orc",
        items: [{ name: "Deep Orc", type: "heritage", system: { rules: [] }, flags: {} }],
      }),
      "Orc",
      "character",
      now,
      now,
    );
    db.raw
      .prepare(
        "INSERT INTO items (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
      )
      .run("item-elf", JSON.stringify(ancientElfItem()), "Ancient Elf", "heritage", now, now);
  } finally {
    db.close();
  }
  return path;
}

/** Roda TODA a cadeia (incl. 010) sobre um banco já existente e devolve suas linhas. */
function migrateAndRead(path: string): { actors: Map<string, ItemLike[]>; item: ItemLike } {
  registerMigrations(ALL);
  const db = openDatabase({ path, skipIntegrityCheck: true });
  try {
    applyMigrations(db.raw, path);
    const actors = new Map<string, ItemLike[]>();
    for (const row of db.raw.prepare("SELECT id, data FROM actors").all() as {
      id: string;
      data: string;
    }[]) {
      actors.set(row.id, (JSON.parse(row.data) as { items?: ItemLike[] }).items ?? []);
    }
    const itemRow = db.raw.prepare("SELECT data FROM items WHERE id = ?").get("item-elf") as {
      data: string;
    };
    return { actors, item: JSON.parse(itemRow.data) as ItemLike };
  } finally {
    db.close();
  }
}

beforeEach(() => {
  tempDirs = [];
  registerMigrations(ALL);
});

afterEach(() => {
  registerMigrations(ALL);
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe("migration 010 — DEC-MC-01 nos mundos já criados", () => {
  it("tira a concessão do ator que tem a herança e guarda a regra com a decisão", () => {
    const { actors } = migrateAndRead(seedWorldAt009());
    const heritage = actors.get("actor-elf")?.[0];

    expect(heritage?.system?.rules).toEqual([]);
    const disabled = heritage?.flags?.fusion?.disabledRules ?? [];
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.decision).toBe("DEC-MC-01");
    expect(disabled[0]?.rule?.uuid).toBe(GRANT_UUID);
  });

  it("aplica também a documento solto na tabela items", () => {
    const { item } = migrateAndRead(seedWorldAt009());
    expect(item.system?.rules).toEqual([]);
    expect(item.flags?.fusion?.disabledRules).toHaveLength(1);
  });

  it("não toca ator que não tem a herança", () => {
    const { actors } = migrateAndRead(seedWorldAt009());
    const other = actors.get("actor-orc")?.[0];
    expect(other?.system?.rules).toEqual([]);
    expect(other?.flags?.fusion?.disabledRules).toBeUndefined();
  });

  it("é idempotente: reaplicar a cadeia não duplica a entrada desativada", () => {
    const path = seedWorldAt009();
    migrateAndRead(path);
    // Segunda passagem: 010 já está em schema_migrations, mas mesmo forçada a
    // rodar de novo a função não teria o que mover — a regra não está mais lá.
    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      migration010.up(db.raw);
      const row = db.raw.prepare("SELECT data FROM actors WHERE id = ?").get("actor-elf") as {
        data: string;
      };
      const heritage = (JSON.parse(row.data) as { items?: ItemLike[] }).items?.[0];
      expect(heritage?.flags?.fusion?.disabledRules).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
