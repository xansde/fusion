/**
 * Pinned areas persist with the scene (Scene.templates), like map pins persist in
 * Scene.notes: pin, "restart the server" (a brand-new store over the same file,
 * no module memory involved), and the area is still there. Visibility is the
 * scene's: off air, a player gets nothing and cannot touch it.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Envelope } from "@fusion/shared";
import { defaultSceneDocument } from "@fusion/shared";

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { DocumentStore } from "../../documents/index.js";
import { handleEphemeralEnvelope, EphemeralRateLimiter } from "../ephemeral-handlers.js";

type Opts = Parameters<typeof handleEphemeralEnvelope>[3];
type Sock = Parameters<typeof handleEphemeralEnvelope>[0];

const GM = 4;
const PLAYER = 1;

const tempDirs: string[] = [];
const openDbs: FusionDatabase[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/** One "server boot": a fresh connection and store over the same world.db. */
function boot(dbPath: string): DocumentStore {
  const db = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(db.raw, dbPath);
  openDbs.push(db);
  return new DocumentStore({
    db: db.raw,
    defaultAuthor: { userId: "server" },
    coreVersion: "0.1.0",
  });
}

function freshDbPath(): string {
  const dir = join(
    tmpdir(),
    `fusion-pinned-areas-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return join(dir, "world.db");
}

interface Emit {
  to: string;
  event: string;
  payload: Envelope;
}

/** Fake io: `players` and `gms` are the sockets the namespace knows about. */
function harness(store: DocumentStore): {
  send: (role: number, userId: string, type: string, payload: unknown) => Emit[];
  syncAs: (role: number, sceneId: string) => Array<{ id: string }> | null;
} {
  const sent: Emit[] = [];
  const sockets = new Map<string, { id: string; data: { userId: string; role: number } }>([
    ["gm", { id: "gm", data: { userId: "u-gm", role: GM } }],
    ["pl", { id: "pl", data: { userId: "u-pl", role: PLAYER } }],
  ]);
  const withEmit = (id: string): object => ({
    id,
    data: sockets.get(id)?.data,
    emit: (event: string, payload: Envelope): void => {
      sent.push({ to: id, event, payload });
    },
  });
  for (const [id, s] of sockets) Object.assign(s, withEmit(id));
  const ns = {
    sockets,
    to: () => ({ emit: () => undefined }),
    emit: (event: string, payload: Envelope): void => {
      sent.push({ to: "all", event, payload });
    },
  } as unknown as Opts["ns"];
  const logger = { debug: () => undefined, warn: () => undefined } as unknown as Opts["logger"];
  const opts: Opts = {
    ns,
    logger,
    cursorRateLimiter: new EphemeralRateLimiter(50),
    pingRateLimiter: new EphemeralRateLimiter(500),
    previewRateLimiter: new EphemeralRateLimiter(50),
    sceneRooms: new Map(),
    store,
  };
  const send = (role: number, userId: string, type: string, payload: unknown): Emit[] => {
    const before = sent.length;
    handleEphemeralEnvelope(
      {
        id: `sock-${userId}`,
        emit: (event: string, p: Envelope) =>
          sent.push({ to: `self:${userId}`, event, payload: p }),
      } as unknown as Sock,
      { type, ts: Date.now(), payload } as Envelope,
      { userId, role, worldId: "w" },
      opts,
    );
    return sent.slice(before);
  };
  const syncAs = (role: number, sceneId: string): Array<{ id: string }> | null => {
    const out = send(role, "reader", "presence:template:sync", { sceneId });
    const reply = out.find((e) => e.payload.type === "presence:template:pinned");
    if (!reply) return null;
    return (reply.payload.payload as { templates: Array<{ id: string }> }).templates;
  };
  return { send, syncAs };
}

const template = { kind: "cone", sizeFt: 15, origin: { x: 500, y: 500 }, direction: 45 };

function seedScene(store: DocumentStore, id: string, active: boolean): void {
  store.create("scenes", { ...defaultSceneDocument(id), active });
}

describe("pinned areas persist with the scene", () => {
  it("an area pinned before a restart is there after it", () => {
    const dbPath = freshDbPath();
    const first = boot(dbPath);
    seedScene(first, "scene00000000001", true);
    const h1 = harness(first);
    h1.send(GM, "u-gm", "presence:template:pin", {
      id: "a1",
      sceneId: "scene00000000001",
      template,
    });
    h1.send(GM, "u-gm", "presence:template:pin", {
      id: "a2",
      sceneId: "scene00000000001",
      template: { ...template, kind: "burst" },
    });

    const second = boot(dbPath); // restart: nothing but the file survives
    const h2 = harness(second);
    expect(h2.syncAs(PLAYER, "scene00000000001")?.map((t) => t.id)).toEqual(["a1", "a2"]);
  });

  it("restyle and unpin are persisted too", () => {
    const dbPath = freshDbPath();
    const store = boot(dbPath);
    seedScene(store, "scene00000000001", true);
    const h = harness(store);
    h.send(GM, "u-gm", "presence:template:pin", {
      id: "a1",
      sceneId: "scene00000000001",
      template,
    });
    h.send(GM, "u-gm", "presence:template:pin", {
      id: "a2",
      sceneId: "scene00000000001",
      template,
    });
    h.send(GM, "u-gm", "presence:template:style", {
      id: "a1",
      sceneId: "scene00000000001",
      style: { color: "#112233", border: "thick", fill: 0.5 },
    });
    h.send(GM, "u-gm", "presence:template:unpin", { id: "a2", sceneId: "scene00000000001" });

    const restarted = harness(boot(dbPath));
    const list = restarted.syncAs(GM, "scene00000000001");
    expect(list?.map((t) => t.id)).toEqual(["a1"]);
    const stored = boot(dbPath).get("scenes", "scene00000000001")["templates"] as Array<{
      template: { style?: { color: string } };
    }>;
    expect(stored[0]?.template.style?.color).toBe("#112233");
  });

  it("an area on a scene that does not exist is refused", () => {
    const h = harness(boot(freshDbPath()));
    const out = h.send(GM, "u-gm", "presence:template:pin", {
      id: "a1",
      sceneId: "ghost",
      template,
    });
    expect(out).toHaveLength(0);
  });

  it("an off-air scene: a player sees nothing, cannot pin, and the pin reaches only the GM", () => {
    const store = boot(freshDbPath());
    seedScene(store, "scene0000000000f", false);
    const h = harness(store);

    const gmOut = h.send(GM, "u-gm", "presence:template:pin", {
      id: "a1",
      sceneId: "scene0000000000f",
      template,
    });
    // GM-prep on an off-air scene is not broadcast to the players.
    expect(gmOut.map((e) => e.to)).toEqual(["gm"]);

    expect(h.syncAs(PLAYER, "scene0000000000f")).toEqual([]);
    expect(h.syncAs(GM, "scene0000000000f")?.map((t) => t.id)).toEqual(["a1"]);

    const refused = h.send(PLAYER, "u-pl", "presence:template:pin", {
      id: "a2",
      sceneId: "scene0000000000f",
      template,
    });
    expect(refused).toHaveLength(0);
    expect(h.syncAs(GM, "scene0000000000f")?.map((t) => t.id)).toEqual(["a1"]);
  });

  it("an on-air scene: the pin goes to the whole namespace", () => {
    const store = boot(freshDbPath());
    seedScene(store, "scene0000000000n", true);
    const h = harness(store);
    const out = h.send(PLAYER, "u-pl", "presence:template:pin", {
      id: "a1",
      sceneId: "scene0000000000n",
      template,
    });
    expect(out.map((e) => e.to)).toEqual(["all"]);
  });
});

describe("shifting the pinned areas with the map image (recalibrating the grid)", () => {
  const S = "scene00000000001";

  function pinTwo(h: ReturnType<typeof harness>): void {
    h.send(GM, "u-gm", "presence:template:pin", { id: "free", sceneId: S, template });
    h.send(GM, "u-gm", "presence:template:pin", {
      id: "anchored",
      sceneId: S,
      template: { ...template, kind: "emanation", tokenId: "tok-a" },
    });
  }

  it("moves the free areas by (dx, dy), persists them and tells everyone; anchored ones stay", () => {
    const dbPath = freshDbPath();
    const store = boot(dbPath);
    seedScene(store, S, true);
    const h = harness(store);
    pinTwo(h);

    const out = h.send(GM, "u-gm", "presence:template:shift", { sceneId: S, dx: 60, dy: -20 });
    // Only the free area is re-announced (as a pin: clients upsert by id).
    expect(out.map((e) => e.payload.type)).toEqual(["presence:template:pin"]);
    const announced = out[0]?.payload.payload as {
      id: string;
      template: { origin: { x: number; y: number } };
    };
    expect(announced.id).toBe("free");
    expect(announced.template.origin).toEqual({ x: 560, y: 480 });

    const stored = boot(dbPath).get("scenes", S)["templates"] as Array<{
      id: string;
      userId: string;
      template: { origin: { x: number; y: number } };
    }>;
    expect(stored.find((a) => a.id === "free")?.template.origin).toEqual({ x: 560, y: 480 });
    expect(stored.find((a) => a.id === "anchored")?.template.origin).toEqual({ x: 500, y: 500 });
    // The author is kept (the GM who shifted is not the author of a player's area).
    expect(stored.find((a) => a.id === "free")?.userId).toBe("u-gm");
  });

  it("keeps each area's author", () => {
    const store = boot(freshDbPath());
    seedScene(store, S, true);
    const h = harness(store);
    h.send(PLAYER, "u-pl", "presence:template:pin", { id: "mine", sceneId: S, template });
    const out = h.send(GM, "u-gm", "presence:template:shift", { sceneId: S, dx: 10, dy: 10 });
    expect((out[0]?.payload.payload as { userId: string }).userId).toBe("u-pl");
  });

  it("only a privileged user may shift", () => {
    const store = boot(freshDbPath());
    seedScene(store, S, true);
    const h = harness(store);
    pinTwo(h);
    const out = h.send(PLAYER, "u-pl", "presence:template:shift", { sceneId: S, dx: 60, dy: 0 });
    expect(out).toHaveLength(0);
    expect(h.syncAs(GM, S)).toHaveLength(2);
  });

  it("a zero or nonsensical shift does nothing", () => {
    const store = boot(freshDbPath());
    seedScene(store, S, true);
    const h = harness(store);
    pinTwo(h);
    expect(
      h.send(GM, "u-gm", "presence:template:shift", { sceneId: S, dx: 0, dy: 0 }),
    ).toHaveLength(0);
    expect(
      h.send(GM, "u-gm", "presence:template:shift", { sceneId: S, dx: "x", dy: 1 }),
    ).toHaveLength(0);
  });
});
