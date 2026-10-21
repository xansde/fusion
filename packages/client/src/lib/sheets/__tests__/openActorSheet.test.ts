/**
 * openActorSheet.test.ts — Unit tests for openActorSheet's window title.
 *
 * REQ-CMP-055 requires every display surface (NPCs tab, Contatos, sheet) to
 * resolve the shown name through the single `displayName()` mechanism —
 * never a second, ad-hoc read of the raw (EN-pure) `doc.name`. This covers
 * the window title, which is the first thing a sheet displays and was
 * previously reading `actorDoc["name"]` directly.
 *
 * Moved to core in F3 (DEC-SEP-02): `openActorSheet` is system-agnostic — it
 * only resolves through `sheetRegistry`, never a system package directly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { openActorSheet } from "../openActorSheet.js";
import { windowManager } from "$lib/windows/window-manager.js";
import { sheetRegistry } from "$lib/sheets/sheetRegistry.js";
import "$lib/i18n/index.js";
import { i18n } from "$lib/i18n/i18n.js";

// Dynamic import inside openActorSheet resolves on a microtask; flush it.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("openActorSheet — window title (REQ-CMP-055)", () => {
  beforeEach(() => {
    for (const id of [...windowManager.windows.keys()]) {
      windowManager.close(id);
    }
    // Stub sheet registration — this suite exercises openActorSheet's title
    // resolution, not the real NpcSheet component (which pulls in heavy
    // Svelte dependencies unrelated to this defect).
    sheetRegistry.register("Actor", "npc", {}, { defaultSize: { width: 480, height: 520 } });
    i18n.setLocale("pt-BR");
  });

  it("REQ-CMP-055: uses the flags.fusion.i18n['pt-BR'].name snapshot for the window title, not the raw EN doc.name", async () => {
    const actorDoc: Record<string, unknown> = {
      _id: "actor-eagle",
      name: "Eagle",
      type: "npc",
      system: { subtype: "npc" },
      flags: {
        fusion: {
          i18n: {
            "pt-BR": { name: "Águia" },
          },
        },
      },
    };

    openActorSheet("actor-eagle", actorDoc, {
      userId: "gm-1",
      ownership: 3,
      isGm: true,
    });

    await flushMicrotasks();

    const entry = [...windowManager.windows.values()].find(
      (w) => w.singletonKey === "sheet:Actor:actor-eagle",
    );
    expect(entry).toBeDefined();
    expect(entry?.title).toBe("Águia (NPC)");
  });

  it("falls back to the raw doc.name when there is no translation snapshot", async () => {
    const actorDoc: Record<string, unknown> = {
      _id: "actor-plain",
      name: "Skeleton Guard",
      type: "npc",
      system: { subtype: "npc" },
    };

    openActorSheet("actor-plain", actorDoc, {
      userId: "gm-1",
      ownership: 3,
      isGm: true,
    });

    await flushMicrotasks();

    const entry = [...windowManager.windows.values()].find(
      (w) => w.singletonKey === "sheet:Actor:actor-plain",
    );
    expect(entry).toBeDefined();
    expect(entry?.title).toBe("Skeleton Guard (NPC)");
  });

  // #306 — the actor type in the title is a display surface too: never the raw slug.
  describe("the actor type in the title is translated (#306)", () => {
    function titleOf(actorDoc: Record<string, unknown>): Promise<string | undefined> {
      openActorSheet(String(actorDoc["_id"]), actorDoc, {
        userId: "gm-1",
        ownership: 3,
        isGm: true,
      });
      return flushMicrotasks().then(
        () =>
          [...windowManager.windows.values()].find(
            (w) => w.singletonKey === `sheet:Actor:${String(actorDoc["_id"])}`,
          )?.title,
      );
    }

    it.each([
      ["character", "personagem"],
      ["npc", "NPC"],
      ["familiar", "familiar"],
      ["hazard", "perigo"],
      ["vehicle", "veículo"],
      ["loot", "tesouro"],
      ["party", "grupo"],
    ])("pt-BR: %s -> %s", async (subtype, label) => {
      sheetRegistry.register("Actor", subtype, {}, { defaultSize: { width: 480, height: 520 } });
      expect(
        await titleOf({
          _id: `a-${subtype}`,
          name: "Huo Jinwu",
          type: subtype,
          system: { subtype },
        }),
      ).toBe(`Huo Jinwu (${label})`);
    });

    it("en: the English word", async () => {
      i18n.setLocale("en");
      sheetRegistry.register(
        "Actor",
        "character",
        {},
        { defaultSize: { width: 480, height: 520 } },
      );
      expect(
        await titleOf({
          _id: "a-en",
          name: "Huo Jinwu",
          type: "character",
          system: { subtype: "character" },
        }),
      ).toBe("Huo Jinwu (character)");
    });

    it("a subtype nobody translated still shows the raw slug, never a missing-key string", async () => {
      sheetRegistry.register("Actor", "starship", {}, { defaultSize: { width: 480, height: 520 } });
      expect(
        await titleOf({
          _id: "a-ship",
          name: "Aurora",
          type: "starship",
          system: { subtype: "starship" },
        }),
      ).toBe("Aurora (starship)");
    });

    it("never prints an i18n key", async () => {
      sheetRegistry.register(
        "Actor",
        "character",
        {},
        { defaultSize: { width: 480, height: 520 } },
      );
      const title = await titleOf({
        _id: "a-key",
        name: "Alguém",
        type: "character",
        system: { subtype: "character" },
      });
      expect(title).not.toMatch(/FUSION\./);
    });
  });
});
