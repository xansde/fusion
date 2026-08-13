/**
 * commandBar.test.ts — keyboard contract of the Hub command bar.
 *
 * The command bar is the entry point to the System Window: one key per panel,
 * always reachable while the table is in focus. That reach is exactly what
 * makes it dangerous — the same keystroke that opens "Missões" is a plain `q`
 * someone may be typing into the chat. Every test below exists because the
 * shortcut has to lose that race.
 *
 * Pure functions, no DOM: this package runs Vitest with `environment: "node"`,
 * so the reducer takes a structural event rather than a real `KeyboardEvent`.
 */

import { describe, it, expect } from "vitest";
import {
  HUB_PANELS,
  HUB_CLOSE_KEY,
  isTypingTarget,
  resolveShortcut,
  applyShortcut,
  panelByKey,
  type HubPanel,
} from "../commandBar.js";

/** A non-editable element, the ordinary case while looking at the table. */
const canvasTarget = { tagName: "CANVAS", isContentEditable: false };

function press(key: string, extra: Record<string, unknown> = {}) {
  return { key, target: canvasTarget, ...extra };
}

describe("HUB_PANELS", () => {
  it("carries the three panels the prototype settled on", () => {
    expect(HUB_PANELS.map((p) => p.id)).toEqual(["missions", "party", "map"]);
  });

  it("labels every panel in pt-BR for the player", () => {
    // Identifiers are English (repo convention); what the player reads is not.
    expect(HUB_PANELS.map((p) => p.label)).toEqual(["Missões", "Comitiva", "Mapa"]);
  });

  it("assigns a distinct id to each panel", () => {
    const ids = HUB_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns a distinct key to each panel", () => {
    // A duplicate key would make one panel silently unreachable — the kind of
    // bug that only shows up when someone adds a fourth panel in a hurry.
    const keys = HUB_PANELS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares every key as a single lowercase character", () => {
    // `resolveShortcut` lowercases the incoming key before matching, so an
    // uppercase entry here would never match anything.
    for (const panel of HUB_PANELS) {
      expect(panel.key).toHaveLength(1);
      expect(panel.key).toBe(panel.key.toLowerCase());
    }
  });

  it("never claims the key that closes the Hub", () => {
    for (const panel of HUB_PANELS) {
      expect(panel.key.toLowerCase()).not.toBe(HUB_CLOSE_KEY.toLowerCase());
    }
  });
});

describe("panelByKey", () => {
  it("finds a panel by its declared key", () => {
    expect(panelByKey("q")?.id).toBe("missions");
    expect(panelByKey("c")?.id).toBe("party");
    expect(panelByKey("m")?.id).toBe("map");
  });

  it("matches regardless of case", () => {
    expect(panelByKey("Q")?.id).toBe("missions");
  });

  it("returns undefined for a key no panel claims", () => {
    expect(panelByKey("z")).toBeUndefined();
  });
});

describe("isTypingTarget", () => {
  it("recognises the form controls that swallow letters", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("recognises a contenteditable host", () => {
    // The prototype only guarded INPUT/TEXTAREA. This client has TipTap in the
    // chat and the journal, and TipTap edits a contenteditable div — so under
    // the prototype's rule, typing "quero" in the chat would fling the Hub open
    // on the first letter.
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("accepts a lowercase tagName", () => {
    // `tagName` is uppercase in HTML documents but lowercase in XML/XHTML ones,
    // and test doubles are written either way.
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });

  it("leaves ordinary elements alone", () => {
    expect(isTypingTarget({ tagName: "CANVAS", isContentEditable: false })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
  });

  it("treats a missing target as not typing", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

describe("resolveShortcut", () => {
  it("reads a panel key as a request to open that panel", () => {
    expect(resolveShortcut(press("q"))).toEqual({ kind: "panel", panelId: "missions" });
  });

  it("reads the key regardless of case", () => {
    // Shift is not a modifier to reject here: `Q` *is* how you type q with caps
    // lock on, and rejecting it would make the shortcut fail intermittently.
    expect(resolveShortcut(press("Q", { shiftKey: true }))).toEqual({
      kind: "panel",
      panelId: "missions",
    });
  });

  it("reads Escape as a request to close", () => {
    expect(resolveShortcut(press("Escape"))).toEqual({ kind: "close" });
  });

  it("ignores a key no panel claims", () => {
    expect(resolveShortcut(press("z"))).toBeNull();
    expect(resolveShortcut(press("Enter"))).toBeNull();
  });

  it("ignores every keystroke aimed at a typing surface", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(resolveShortcut({ key: "q", target: { tagName } })).toBeNull();
    }
    expect(
      resolveShortcut({ key: "q", target: { tagName: "DIV", isContentEditable: true } }),
    ).toBeNull();
  });

  it("still closes on Escape from inside a typing surface", () => {
    // Escape is the universal "get me out of here" and does not compete with
    // text entry — a field that wants to handle it can stop propagation first.
    expect(resolveShortcut({ key: "Escape", target: { tagName: "INPUT" } })).toEqual({
      kind: "close",
    });
  });

  it("declines keystrokes carrying a command modifier", () => {
    // Ctrl+M, Cmd+Q and Alt+C belong to the browser and the OS. Hijacking them
    // is how a web app earns "it closed my browser" in a bug report.
    expect(resolveShortcut(press("q", { ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(press("q", { metaKey: true }))).toBeNull();
    expect(resolveShortcut(press("c", { altKey: true }))).toBeNull();
  });

  it("honours a caller-supplied panel set", () => {
    const panels: HubPanel[] = [{ id: "notes", label: "Anotações", key: "n" }];
    expect(resolveShortcut(press("n"), panels)).toEqual({ kind: "panel", panelId: "notes" });
    // ...and the default set no longer applies.
    expect(resolveShortcut(press("q"), panels)).toBeNull();
  });
});

describe("applyShortcut", () => {
  it("opens a panel when nothing is open", () => {
    expect(applyShortcut(null, { kind: "panel", panelId: "missions" })).toBe("missions");
  });

  it("switches straight from one panel to another", () => {
    expect(applyShortcut("missions", { kind: "panel", panelId: "map" })).toBe("map");
  });

  it("closes the panel when its own key is pressed again", () => {
    // Divergence from the prototype, deliberate: there, a panel is always open
    // because the page is nothing but the Hub. Here the Hub floats over the
    // canvas, so the same key that summoned it has to dismiss it — otherwise
    // the only way back to the map is to open a *different* window.
    expect(applyShortcut("missions", { kind: "panel", panelId: "missions" })).toBeNull();
  });

  it("closes on a close intent", () => {
    expect(applyShortcut("map", { kind: "close" })).toBeNull();
  });

  it("stays closed when closing with nothing open", () => {
    expect(applyShortcut(null, { kind: "close" })).toBeNull();
  });

  it("leaves the current panel untouched for a null intent", () => {
    expect(applyShortcut("party", null)).toBe("party");
    expect(applyShortcut(null, null)).toBeNull();
  });

  it("is idempotent for a close applied twice", () => {
    const once = applyShortcut("party", { kind: "close" });
    expect(applyShortcut(once, { kind: "close" })).toBeNull();
  });
});

describe("the round trip a keydown handler performs", () => {
  /** Exactly what `CommandBar.svelte` does: resolve, then reduce. */
  function type(active: string | null, key: string, target: unknown = canvasTarget) {
    return applyShortcut(active, resolveShortcut({ key, target }));
  }

  it("walks a plausible session: open, switch, toggle shut, escape", () => {
    let active: string | null = null;
    active = type(active, "q");
    expect(active).toBe("missions");
    active = type(active, "m");
    expect(active).toBe("map");
    active = type(active, "m");
    expect(active).toBeNull();
    active = type(active, "c");
    expect(active).toBe("party");
    active = type(active, "Escape");
    expect(active).toBeNull();
  });

  it("does not move while the player types into the chat", () => {
    const chat = { tagName: "DIV", isContentEditable: true };
    let active: string | null = "missions";
    for (const key of [..."comitiva quero mapa"]) {
      active = type(active, key, chat);
    }
    expect(active).toBe("missions");
  });
});
