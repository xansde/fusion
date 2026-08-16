/**
 * RollBuilderWindow.test.ts — the window composes the roll and refuses to pick the audience.
 *
 * Rendered with `render()` from `svelte/server` (node environment, no jsdom): the
 * assertions are structural, which is exactly what REQ-ACH-060..063 are about — which
 * controls exist, which one does NOT, and that the window is a floating window rather than
 * something that widens the drawer.
 *
 * Covers REQ-ACH-060, REQ-ACH-061, REQ-ACH-062 and REQ-ACH-063.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import RollBuilderWindow from "../RollBuilderWindow.svelte";
import {
  ROLL_BUILDER_WINDOW_KEY,
  openRollBuilderWindow,
} from "../../../lib/chat/rollBuilderWindow.js";
import { windowManager } from "../../../lib/windows/window-manager.js";
import { setRollMode } from "../../../lib/chat/rollModeState.svelte.js";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

const WORLD = "world-abc";
const USER = "user-1";

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
      key: (i: number): string | null => [...store.keys()][i] ?? null,
      get length(): number {
        return store.size;
      },
    },
  });
  return store;
}

let raw: Map<string, string>;

beforeEach(() => {
  raw = installStorage();
  windowManager.closeAll();
});

function renderBuilder(): string {
  const { body } = render(RollBuilderWindow, { props: { worldId: WORLD, userId: USER } });
  return body;
}

describe("a janela monta a rolagem (REQ-ACH-060)", () => {
  it("offers every part of a build the spec lists", () => {
    const body = renderBuilder();
    for (const key of [
      "FUSION.Chat.RollBuilder.Count",
      "FUSION.Chat.RollBuilder.Faces",
      "FUSION.Chat.RollBuilder.Modifier",
      "FUSION.Chat.RollBuilder.Label",
      "FUSION.Chat.RollBuilder.Edge.Advantage",
      "FUSION.Chat.RollBuilder.Edge.Disadvantage",
      "FUSION.Chat.RollBuilder.Explode",
      "FUSION.Chat.RollBuilder.KeepHighest",
    ]) {
      expect(body, key).toContain(t(key));
    }
  });

  it("shows the resulting formula before rolling", () => {
    const body = renderBuilder();
    expect(body).toContain('data-preview="formula"');
    expect(body).toMatch(/data-preview="formula"[^>]*>1d20</);
    expect(body).toContain(t("FUSION.Chat.RollBuilder.Preview"));
  });

  it("has a roll button that fires the composed formula", () => {
    expect(renderBuilder()).toContain('data-action="roll"');
  });
});

describe("a janela NÃO escolhe a plateia (REQ-ACH-061)", () => {
  it("reports the selector's mode instead of offering a mode control", () => {
    setRollMode(WORLD, USER, "blindroll");
    const body = renderBuilder();

    expect(body).toContain('data-roll-mode="blindroll"');
    expect(body).toContain(
      t("FUSION.Chat.RollBuilder.ModeNotice", { mode: t("FUSION.Chat.RollMode.Blind.Label") }),
    );
    // No radiogroup, no per-mode buttons: the panel's selector is the only place.
    expect(body).not.toContain('role="radiogroup"');
    expect(body).not.toContain('role="radio"');
    expect(body).not.toContain(t("FUSION.Chat.RollMode.GroupLabel"));

    setRollMode(WORLD, USER, "public");
    expect(renderBuilder()).toContain('data-roll-mode="public"');
  });
});

describe("salvar como favorito (REQ-ACH-062)", () => {
  it("offers a save control and a slot to save into", () => {
    const body = renderBuilder();
    expect(body).toContain('data-action="save-favorite"');
    expect(body).toContain(t("FUSION.Chat.RollBuilder.SaveAsFavorite"));
    expect(body).toContain(t("FUSION.Chat.RollBuilder.Slot", { index: 1 }));
    expect(body).toContain(t("FUSION.Chat.RollBuilder.Slot", { index: 3 }));
  });
});

describe("é janela flutuante, e uma só (REQ-ACH-063, REQ-UIF-014)", () => {
  it("opens through the window manager, not inside the drawer", () => {
    const handle = openRollBuilderWindow({ worldId: WORLD, userId: USER });
    const entry = windowManager.windows.get(handle.id);

    expect(entry).toBeDefined();
    expect(entry?.singletonKey).toBe(ROLL_BUILDER_WINDOW_KEY);
    expect(entry?.title).toBe(t("FUSION.Chat.RollBuilder.Title"));
    expect(entry?.component).toBe(RollBuilderWindow);
    expect(entry?.componentProps).toEqual({ worldId: WORLD, userId: USER });
  });

  it("reuses the same window when the fourth button is pressed again", () => {
    const first = openRollBuilderWindow({ worldId: WORLD, userId: USER });
    const second = openRollBuilderWindow({ worldId: WORLD, userId: USER });

    expect(second.id).toBe(first.id);
    expect(windowManager.windows.size).toBe(1);
  });

  it("does not touch the drawer's width — it writes no sidebar preference (REQ-GAV-012)", () => {
    openRollBuilderWindow({ worldId: WORLD, userId: USER });
    // The only thing a window persists is its own geometry (`fusion:windowGeometry`);
    // the drawer's own preferences are untouched, so its width cannot move.
    expect([...raw.keys()].some((k) => k.startsWith("fusion:sidebar"))).toBe(false);
  });
});
