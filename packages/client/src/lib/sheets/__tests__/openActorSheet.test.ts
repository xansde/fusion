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
    expect(entry?.title).toBe("Águia (npc)");
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
    expect(entry?.title).toBe("Skeleton Guard (npc)");
  });
});
