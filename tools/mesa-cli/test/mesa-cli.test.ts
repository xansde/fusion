/**
 * mesa-cli integration: boots an ephemeral real server (boot() sequence, port from
 * helpers/ports.ts) and drives it through the CLI's own session/commands, with a second
 * connected client proving the broadcast reaches other players.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { boot } from "../../../packages/server/src/boot.js";
import type { BootResult } from "../../../packages/server/src/boot.js";
import { loadConfig } from "../../../packages/server/src/config.js";
import { createLogger } from "../../../packages/server/src/logger.js";
import { openDatabase, applyMigrations } from "../../../packages/server/src/db/index.js";
import type { FusionDatabase } from "../../../packages/server/src/db/index.js";
import { AuthService } from "../../../packages/server/src/auth/service.js";
import { loadOrCreateSecret } from "../../../packages/server/src/auth/crypto.js";
import { reserveFreePort } from "../../../packages/server/src/__tests__/helpers/ports.js";
import { pf2eSystem } from "@fusion/system-pf2e";

import { connect } from "../src/session.mjs";
import { commands, getPath } from "../src/commands.mjs";
import { parseArgs } from "../src/args.mjs";

const WORLD_ID = "mesa_cli_world";

let dataDir: string;
let fusionDb: FusionDatabase;
let bootResult: BootResult;
let url: string;
let gmPassword: string;

beforeAll(async () => {
  dataDir = join(
    tmpdir(),
    `fusion-mesa-cli-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);
  fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const authService = new AuthService(fusionDb.raw, secret, WORLD_ID);
  const { password } = await authService.bootstrapGm();
  gmPassword = password;
  const port = await reserveFreePort();
  bootResult = await boot({
    config: loadConfig({
      dataDirOverride: dataDir,
      cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
    }),
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId: WORLD_ID,
      worldTitle: "Mesa CLI World",
      worldSystemId: "pf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId: WORLD_ID,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "pf2e",
      systemModule: pf2eSystem,
    },
  });
  url = `http://127.0.0.1:${String(port)}`;
}, 40000);

afterAll(async () => {
  await bootResult.shutdown();
  fusionDb.close();
  rmSync(dataDir, { recursive: true, force: true });
});

type Session = Awaited<ReturnType<typeof connect>>;

function nextOp(session: Session, type: string): Promise<any> {
  return new Promise((resolve) => {
    session.onOp((env: any) => {
      if (env?.type === type) resolve(env);
    });
  });
}

describe("mesa-cli", () => {
  it("parseArgs: flags, positionals and the pnpm '--'", () => {
    const r = parseArgs(["--", "--url", "http://x", "hp", "Huo", "-5", "--json"]);
    expect(r.flags).toEqual({ url: "http://x", json: true });
    expect(r.positional).toEqual(["hp", "Huo", "-5"]);
  });

  it("login: wrong password is refused, right one connects and sees the world", async () => {
    await expect(connect({ url, user: "Gamemaster", password: "wrong-password" })).rejects.toThrow(
      /Login failed/,
    );
    await expect(connect({ url, user: "Nobody", password: gmPassword })).rejects.toThrow(/No user/);
    const s = await connect({ url, user: "Gamemaster", password: gmPassword });
    try {
      const st: any = await commands.status.run(s, [], {});
      expect(st.world.id).toBe(WORLD_ID);
      expect(st.users.some((u: any) => u.online)).toBe(true);
      expect(commands.status.human(st)).toContain("Mesa CLI World");
    } finally {
      s.close();
    }
  });

  it("set/hp/chat/scene go through the real pipeline and a second client receives them", async () => {
    const gm = await connect({ url, user: "Gamemaster", password: gmPassword });
    const watcher = await connect({ url, user: "Gamemaster", password: gmPassword });
    try {
      // Fixture through the generic envelope door.
      const created = await gm.op("doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "Teste Ator",
            type: "character",
            ownership: { default: 0 },
            flags: {},
            system: { attributes: { hp: { value: 10, max: 30 } } },
          },
        ],
      });
      const actorId = created.result.documents[0]._id as string;
      const sc = await gm.op("doc:create", {
        documentType: "Scene",
        data: [
          { name: "Cena Um", width: 1000, height: 1000 },
          { name: "Cena Dois", width: 1000, height: 1000 },
        ],
      });
      expect(sc.result.documents).toHaveLength(2);

      // A fresh session sees both (snapshot is per-connection).
      const s = await connect({ url, user: "Gamemaster", password: gmPassword });
      try {
        const list: any = await commands.actors.run(s, [], { type: "character" });
        expect(list.map((a: any) => a.name)).toContain("Teste Ator");

        // set -> doc:update, watcher receives the broadcast
        const upd = nextOp(watcher, "doc:update");
        const r: any = await commands.set.run(s, ["Teste Ator", "name", '"Renomeado"'], {});
        expect(r.value).toBe("Renomeado");
        expect(JSON.stringify((await upd).payload)).toContain("Renomeado");

        // hp
        const hpEnv = nextOp(watcher, "doc:update");
        const h: any = await commands.hp.run(s, [actorId, "20"], {});
        expect(h.before).toBe(10);
        expect(h.after).toBe(20);
        expect(JSON.stringify((await hpEnv).payload)).toContain("20");

        // chat
        const chatEnv = nextOp(watcher, "doc:create");
        await commands.chat.run(s, ["teste da porta"], {});
        expect(JSON.stringify((await chatEnv).payload)).toContain("teste da porta");

        // scene
        const sceneEnv = nextOp(watcher, "world:activeScene");
        const sres: any = await commands.scene.run(s, ["cena dois"], {});
        expect(sres.name).toBe("Cena Dois");
        expect((await sceneEnv).payload.sceneId).toBe(sres.id);
      } finally {
        s.close();
      }

      // Persistence: a brand-new session reads the changes back.
      const again = await connect({ url, user: "Gamemaster", password: gmPassword });
      try {
        const a: any = await commands.actor.run(again, [actorId], {});
        expect(a.name).toBe("Renomeado");
        expect(a.hp.value).toBe(20);
        expect(getPath({ a: { b: [1, 2] } }, "a.b.1")).toBe(2);
        const st: any = await commands.status.run(again, [], {});
        expect(st.activeScene?.name).toBe("Cena Dois");
      } finally {
        again.close();
      }
    } finally {
      gm.close();
      watcher.close();
    }
  });

  it("item-add / item-rm / condition work on an actor", async () => {
    const gm = await connect({ url, user: "Gamemaster", password: gmPassword });
    try {
      await gm.op("doc:create", {
        documentType: "Actor",
        data: [{ name: "Portador", type: "character", ownership: { default: 0 }, flags: {} }],
      });
    } finally {
      gm.close();
    }
    const s = await connect({ url, user: "Gamemaster", password: gmPassword });
    try {
      const add: any = await commands["item-add"].run(
        s,
        ["Portador", '{"name":"Adaga","type":"equipment","system":{}}'],
        {},
      );
      expect(add.created[0].name).toBe("Adaga");
      const c: any = await commands.condition.run(s, ["Portador", "frightened", "2"], {});
      expect(c.mode).toBe("set");
      const s2 = await connect({ url, user: "Gamemaster", password: gmPassword });
      try {
        const a: any = await commands.actor.run(s2, ["Portador"], {});
        expect(a.items.map((i: any) => i.name)).toContain("Adaga");
        const rm: any = await commands["item-rm"].run(s2, ["Portador", "Adaga"], {});
        expect(rm.removed.name).toBe("Adaga");
      } finally {
        s2.close();
      }
    } finally {
      s.close();
    }
  });

  it("op: refuses an invalid envelope with the server's code; unknown actor is a clean error", async () => {
    const s = await connect({ url, user: "Gamemaster", password: gmPassword });
    try {
      await expect(
        commands.op.run(
          s,
          ['{"type":"doc:create","payload":{"documentType":"Actor","documents":[]}}'],
          {},
        ),
      ).rejects.toThrow(/refused/);
      await expect(commands.actor.run(s, ["nao-existe-xyz"], {})).rejects.toThrow(/No actor/);
    } finally {
      s.close();
    }
  });
});
