/**
 * chat-save-degree.test.ts — authoritative degree-of-success grading for save
 * rolls carrying a `checkContext` (r17.1, REQ-PF2-113).
 *
 * Two layers:
 *   1. Unit tests of the pure grading helpers (`computeSaveDegree`,
 *      `readNaturalD20`) with hand-crafted RollResultData — this is where the
 *      exact border cases live (total == CD, CD+10, CD-10; nat20 upgrades a
 *      failure to a success; nat1 downgrades a success to a failure).
 *   2. An integration test through the real `buildChatSendHandler` with a temp
 *      SQLite DB and a fake namespace, proving the wire path fills
 *      `degreeOfSuccess` when a save checkContext is attached — and leaves it
 *      undefined when no checkContext is present (current behavior intact).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { SeqStore } from "../net/seq-store.js";
import { buildChatSendHandler, computeSaveDegree, readNaturalD20 } from "../chat/chat-handler.js";
import type { HandlerContext } from "../net/handler-registry.js";
import type {
  Ack,
  ChatMessage,
  RollResultData,
  RollTermResult,
  SaveCheckContext,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Unit — readNaturalD20
// ---------------------------------------------------------------------------

/** Build a `1d20 + mod` term list with a fixed natural face. */
function d20Terms(natural: number, mod: number): RollTermResult[] {
  return [
    {
      type: "dice",
      expression: "1d20",
      total: natural,
      number: 1,
      faces: 20,
      modifiers: [],
      results: [{ result: natural, active: true }],
    },
    { type: "operator", expression: "+", total: 0 },
    { type: "numeric", expression: String(mod), total: mod },
  ];
}

/** Build a full RollResultData for a save roll (total = natural + mod). */
function saveRoll(natural: number, mod: number): RollResultData {
  return {
    rollId: "roll-1",
    formula: "1d20",
    expandedFormula: `1d20 + ${String(mod)}`,
    total: natural + mod,
    terms: d20Terms(natural, mod),
    rollMode: "public",
    timestamp: Date.now(),
    warnings: [],
  };
}

describe("readNaturalD20", () => {
  it("reads the natural face of a 1d20 term", () => {
    expect(readNaturalD20(d20Terms(14, 5))).toBe(14);
    expect(readNaturalD20(d20Terms(20, 0))).toBe(20);
    expect(readNaturalD20(d20Terms(1, 9))).toBe(1);
  });

  it("prefers the active die when multiple are present (fortune/misfortune)", () => {
    const terms: RollTermResult[] = [
      {
        type: "dice",
        expression: "2d20kh1",
        total: 18,
        number: 2,
        faces: 20,
        modifiers: ["kh1"],
        results: [
          { result: 18, active: true },
          { result: 6, active: false, discarded: true },
        ],
      },
    ];
    expect(readNaturalD20(terms)).toBe(18);
  });

  it("returns null when there is no d20 term", () => {
    const terms: RollTermResult[] = [
      {
        type: "dice",
        expression: "3d6",
        total: 10,
        number: 3,
        faces: 6,
        modifiers: [],
        results: [
          { result: 4, active: true },
          { result: 3, active: true },
          { result: 3, active: true },
        ],
      },
    ];
    expect(readNaturalD20(terms)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit — computeSaveDegree (border cases)
// ---------------------------------------------------------------------------

const REFLEX: SaveCheckContext = { kind: "save", dcValue: 20, saveType: "reflex" };

describe("computeSaveDegree — margin thresholds", () => {
  // DC = 20 throughout. natural chosen to avoid nat20/nat1 shifts (use 10).
  it("total exactly the DC → success (margin 0)", () => {
    // natural 10, mod 10 → total 20 == DC
    expect(computeSaveDegree(saveRoll(10, 10), REFLEX)).toBe("success");
  });

  it("total exactly DC-1 → failure (margin -1)", () => {
    // natural 9, mod 10 → total 19 == DC-1
    expect(computeSaveDegree(saveRoll(9, 10), REFLEX)).toBe("failure");
  });

  it("total exactly DC+10 → critical success (margin +10)", () => {
    // natural 10, mod 20 → total 30 == DC+10
    expect(computeSaveDegree(saveRoll(10, 20), REFLEX)).toBe("criticalSuccess");
  });

  it("total exactly DC+9 → success (margin +9, below crit threshold)", () => {
    // natural 10, mod 19 → total 29 == DC+9
    expect(computeSaveDegree(saveRoll(10, 19), REFLEX)).toBe("success");
  });

  it("total exactly DC-10 → critical failure (margin -10)", () => {
    // natural 10, mod 0 → total 10 == DC-10
    expect(computeSaveDegree(saveRoll(10, 0), REFLEX)).toBe("criticalFailure");
  });

  it("total exactly DC-9 → failure (margin -9, above crit-fail threshold)", () => {
    // natural 10, mod 1 → total 11 == DC-9
    expect(computeSaveDegree(saveRoll(10, 1), REFLEX)).toBe("failure");
  });
});

describe("computeSaveDegree — natural d20 shifts (PF2e §2.2)", () => {
  it("nat 20 upgrades a failure to a success", () => {
    // natural 20, mod -5 → total 15 (DC 20 → margin -5 = failure) → nat20 → success
    expect(computeSaveDegree(saveRoll(20, -5), REFLEX)).toBe("success");
  });

  it("nat 20 upgrades a success to a critical success", () => {
    // natural 20, mod 0 → total 20 (== DC → success) → nat20 → criticalSuccess
    expect(computeSaveDegree(saveRoll(20, 0), REFLEX)).toBe("criticalSuccess");
  });

  it("nat 1 downgrades a success to a failure", () => {
    // natural 1, mod 25 → total 26 (DC 20 → margin +6 = success) → nat1 → failure
    expect(computeSaveDegree(saveRoll(1, 25), REFLEX)).toBe("failure");
  });

  it("nat 1 downgrades a critical success to a success", () => {
    // natural 1, mod 30 → total 31 (DC 20 → margin +11 = critSuccess) → nat1 → success
    expect(computeSaveDegree(saveRoll(1, 30), REFLEX)).toBe("success");
  });

  it("nat 1 cannot go below critical failure", () => {
    // natural 1, mod -20 → total -19 (margin -39 = critFail) → nat1 stays critFail
    expect(computeSaveDegree(saveRoll(1, -20), REFLEX)).toBe("criticalFailure");
  });

  it("nat 20 cannot go above critical success", () => {
    // natural 20, mod 40 → total 60 (margin +40 = critSuccess) → nat20 stays critSuccess
    expect(computeSaveDegree(saveRoll(20, 40), REFLEX)).toBe("criticalSuccess");
  });

  it("returns null when the roll has no d20 to grade", () => {
    const noD20: RollResultData = {
      rollId: "r",
      formula: "3d6",
      expandedFormula: "3d6",
      total: 10,
      terms: [
        {
          type: "dice",
          expression: "3d6",
          total: 10,
          number: 3,
          faces: 6,
          modifiers: [],
          results: [
            { result: 4, active: true },
            { result: 3, active: true },
            { result: 3, active: true },
          ],
        },
      ],
      rollMode: "public",
      timestamp: Date.now(),
      warnings: [],
    };
    expect(computeSaveDegree(noD20, REFLEX)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration — the chat:send wire fills degreeOfSuccess (r17.1)
// ---------------------------------------------------------------------------

const WORLD_ID = "save-degree-world";
const USER_ID = "user000000000001";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-savedeg-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function seedUser(db: Db): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, data, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(USER_ID, JSON.stringify({ _id: USER_ID, name: "GM", role: 4 }), "GM", 4, now, now);
}

function fakeNs(): Namespace {
  return { sockets: new Map() } as unknown as Namespace;
}

interface Harness {
  fusionDb: FusionDatabase;
  handler: ReturnType<typeof buildChatSendHandler>;
}

/**
 * Build a handler whose RollService uses a deterministic engine that always
 * returns 0 → the library maps this to the LOWEST face, so `1d20` yields a
 * natural 1 every time. This lets the integration test assert a deterministic
 * degree without reverse-engineering the RNG-to-face mapping for other faces
 * (the full margin/shift matrix is covered by the pure unit tests above).
 */
function makeHarness(): Harness {
  const dir = makeTempDir();
  const dbPath = join(dir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seedUser(fusionDb.raw);

  const seqStore = new SeqStore(fusionDb.raw);
  const handler = buildChatSendHandler({
    db: fusionDb.raw,
    ns: fakeNs(),
    seqStore,
    worldId: WORLD_ID,
    rollServiceOptions: { rng: { next: () => 0 } },
  });
  return { fusionDb, handler };
}

const CTX: HandlerContext = { userId: USER_ID, role: 4, worldId: WORLD_ID };

function firstRoll(msg: ChatMessage | null): RollResultData | undefined {
  return msg?.rolls?.[0];
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  tempDirs = [];
});

describe("chat:send save degree-of-success wire (r17.1)", () => {
  it("fills degreeOfSuccess when a save checkContext is attached", () => {
    const { handler } = makeHarness();
    // rng→0 makes 1d20 roll a natural 1. total = 1 + 5 = 6 vs DC 10:
    // margin -4 = failure, then nat1 downgrade → criticalFailure.
    const ack = handler(
      {
        content: "/r 1d20+5 # Salvaguarda de Reflexos (CD 10)",
        worldId: WORLD_ID,
        rollMode: "public",
        flags: { checkContext: { kind: "save", dcValue: 10, saveType: "reflex", basicSave: true } },
      },
      CTX,
    ) as Ack<{ message: ChatMessage }>;
    expect(ack.ok).toBe(true);
    const roll = firstRoll(ack.result?.message ?? null);
    expect(roll).toBeDefined();
    // Sanity: the deterministic engine really produced a natural 1.
    expect(readNaturalD20(roll!.terms)).toBe(1);
    expect(roll!.degreeOfSuccess).toBe("criticalFailure");
    // The graded save context is persisted on the message flags so the render
    // can show the per-degree basic-save damage hint (r17.1).
    const flagCtx = (ack.result?.message?.flags as Record<string, Record<string, unknown>>)[
      "pf2e"
    ]?.["checkContext"] as Record<string, unknown> | undefined;
    expect(flagCtx).toEqual({ kind: "save", dcValue: 10, saveType: "reflex", basicSave: true });
  });

  it("leaves degreeOfSuccess undefined when NO checkContext is present (behavior intact)", () => {
    const { handler } = makeHarness();
    const ack = handler(
      { content: "/r 1d20+5", worldId: WORLD_ID, rollMode: "public" },
      CTX,
    ) as Ack<{ message: ChatMessage }>;
    expect(ack.ok).toBe(true);
    const roll = firstRoll(ack.result?.message ?? null);
    expect(roll).toBeDefined();
    expect(roll!.degreeOfSuccess).toBeUndefined();
    // No checkContext flag persisted either.
    const pf2e = (ack.result?.message?.flags as Record<string, Record<string, unknown>>)["pf2e"];
    expect(pf2e?.["checkContext"]).toBeUndefined();
  });

  it("rejects the whole chat:send when checkContext is malformed (Zod)", () => {
    const { handler } = makeHarness();
    const ack = handler(
      {
        content: "/r 1d20+5",
        worldId: WORLD_ID,
        rollMode: "public",
        // dcValue missing → schema rejects
        flags: { checkContext: { kind: "save", saveType: "reflex" } },
      },
      CTX,
    ) as Ack<unknown>;
    expect(ack.ok).toBe(false);
  });
});
