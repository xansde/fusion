/**
 * previewWindow.test.ts — previewing in a window instead of a blade (spec 43
 * §5.6, G094).
 *
 * Covers REQ-CPD-050 (preview opens a floating window and never replaces the
 * list in the panel), REQ-CPD-051 (loaded on demand, with a loading state and a
 * recoverable failure), REQ-CPD-052 (the license block: the pack's, plus the
 * document's override when there is one), REQ-CPD-053 (the window carries the
 * same permission to bring the entry over that the line had) and REQ-CPD-054
 * (several previews open at once; the drawer does not own them).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { PackLicense } from "@fusion/shared";

import {
  PREVIEW_LOADING,
  PREVIEW_WINDOW_KEY_PREFIX,
  buildPreviewLicense,
  buildPreviewWindowOptions,
  hasLicenseOverride,
  isPreviewWindowKey,
  openCompendiumPreviewWindow,
  previewError,
  previewReady,
  previewWindowSingletonKey,
  shouldResetToLoading,
  type OpenPreviewInput,
  type PreviewLoadState,
} from "../previewWindow.js";
import { windowManager } from "../../windows/window-manager.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORC_PACK: PackLicense = {
  license: "ORC",
  attribution: "Paizo Inc. — Pathfinder Second Edition Remaster",
  reservedNotice: "Reserved Material: Pathfinder, Golarion",
  sourceRepo: "github.com/foundryvtt/pf2e",
};

function input(overrides: Partial<OpenPreviewInput> = {}): OpenPreviewInput {
  return {
    uuid: "Compendium.pf2e.spells-core.Item.abc0123456789def",
    name: "Bola de Fogo",
    documentType: "Item",
    packId: "pf2e.spells-core",
    packLabel: "Magias",
    packLicense: ORC_PACK,
    ...overrides,
  };
}

function docWith(publication: unknown): Record<string, unknown> {
  return { name: "Fireball", system: { publication } };
}

/** Windows opened by this module, right now. */
function previewWindows(): { singletonKey: string | undefined; title: string }[] {
  return [...windowManager.windows.values()]
    .filter((entry) => isPreviewWindowKey(entry.singletonKey))
    .map((entry) => ({ singletonKey: entry.singletonKey, title: entry.title }));
}

afterEach(() => {
  windowManager.closeAll();
});

// ---------------------------------------------------------------------------

describe("preview opens a window, not a blade (REQ-CPD-050)", () => {
  it("REQ-CPD-050: previewing registers a window carrying the preview component", () => {
    openCompendiumPreviewWindow(input(), "Pré-visualização");

    const opened = [...windowManager.windows.values()].filter((entry) =>
      isPreviewWindowKey(entry.singletonKey),
    );
    expect(opened).toHaveLength(1);
    // A window of the window manager: it mounts a component of its own, so the
    // panel that asked keeps drawing exactly what it was drawing.
    expect(opened[0]?.component).toBeDefined();
    expect(opened[0]?.title).toBe("Bola de Fogo");
  });

  it("REQ-CPD-050: the window is identified by the document, not by the panel", () => {
    const key = previewWindowSingletonKey("Compendium.pf2e.bestiary.Actor.zzz");

    expect(key).toBe(`${PREVIEW_WINDOW_KEY_PREFIX}Compendium.pf2e.bestiary.Actor.zzz`);
    expect(isPreviewWindowKey(key)).toBe(true);
    expect(isPreviewWindowKey("sheet:Actor:xyz")).toBe(false);
    expect(isPreviewWindowKey(undefined)).toBe(false);
  });

  it("REQ-CPD-050: a nameless entry still gets a titled window", () => {
    const options = buildPreviewWindowOptions(input({ name: "   " }), "Pré-visualização");

    expect(options.title).toBe("Pré-visualização");
    expect(options.resizable).toBe(true);
    expect(options.minimizable).toBe(true);
  });
});

describe("more than one preview at a time (REQ-CPD-054)", () => {
  it("REQ-CPD-054: two documents are two windows, open side by side", () => {
    openCompendiumPreviewWindow(input(), "Pré-visualização");
    openCompendiumPreviewWindow(
      input({ uuid: "Compendium.pf2e.bestiary.Actor.goblin1", name: "Goblin" }),
      "Pré-visualização",
    );

    expect(previewWindows()).toHaveLength(2);
    expect(
      previewWindows()
        .map((w) => w.title)
        .sort(),
    ).toEqual(["Bola de Fogo", "Goblin"]);
  });

  it("REQ-CPD-054: previewing the same document twice focuses the window already open", () => {
    const first = openCompendiumPreviewWindow(input(), "Pré-visualização");
    const second = openCompendiumPreviewWindow(input(), "Pré-visualização");

    expect(previewWindows()).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(windowManager.activeWindowId).toBe(first.id);
  });

  it("REQ-CPD-054: the drawer does not own the windows — closing one leaves the rest", () => {
    const spell = openCompendiumPreviewWindow(input(), "Pré-visualização");
    openCompendiumPreviewWindow(
      input({ uuid: "Compendium.pf2e.bestiary.Actor.goblin1", name: "Goblin" }),
      "Pré-visualização",
    );

    spell.close();

    // The other preview is untouched: they are independent windows, and nothing
    // in the panel's lifecycle reaches them.
    expect(previewWindows().map((w) => w.title)).toEqual(["Goblin"]);
  });
});

describe("loading the document on demand (REQ-CPD-051)", () => {
  it("REQ-CPD-051: the window starts loading and ends holding the document", () => {
    expect(PREVIEW_LOADING.status).toBe("loading");

    const ready = previewReady({ name: "Fireball" });
    expect(ready.status).toBe("ready");
    expect(ready.status === "ready" ? ready.document["name"] : null).toBe("Fireball");
  });

  it("REQ-CPD-051: a failure is a state with a message, never a thrown render", () => {
    const failed = previewError(new Error("socket is not connected"), "Falha ao carregar.");

    expect(failed.status).toBe("error");
    expect(failed.status === "error" ? failed.message : "").toBe("socket is not connected");
  });

  it("REQ-CPD-051: a failure with nothing useful to say falls back to the caller's message", () => {
    for (const cause of [new Error(""), "boom", null, undefined]) {
      const failed = previewError(cause, "Falha ao carregar.");
      expect(failed.status === "error" ? failed.message : "").toBe("Falha ao carregar.");
    }
  });
});

describe("bugfix A003 — the mount effect must not retrigger itself (REQ-CPD-051, REQ-CPD-060, DEC-CPD-03)", () => {
  /**
   * Models exactly the mechanism `CompendiumPreviewWindow.svelte` runs: an
   * `$effect` that calls `load()` whenever `loadState.status === "loading"`,
   * and a `load()` that MAY reassign `loadState` back to `PREVIEW_LOADING`
   * before fetching. In Svelte 5, reassigning a `$state` object retriggers
   * every effect reading it — even when the new value describes the same
   * status as the old one — so an unconditional reset makes the effect that
   * is still synchronously running `load()` schedule ANOTHER run of itself,
   * forever. `resetPredicate` is the thing that decides whether to reset;
   * passing `() => true` reproduces the old, unguarded `load()`.
   */
  function simulateMountEffect(
    resetPredicate: (state: PreviewLoadState) => boolean,
    maxIterations: number,
  ): { loadCalls: number; exceededBudget: boolean } {
    let loadState: PreviewLoadState = PREVIEW_LOADING;
    let loadCalls = 0;
    let effectPending = true;

    while (effectPending) {
      effectPending = false;
      if (loadState.status !== "loading") continue;
      // The effect body: `void load();`
      loadCalls += 1;
      if (loadCalls >= maxIterations) return { loadCalls, exceededBudget: true };
      if (resetPredicate(loadState)) {
        // A NEW object reference describing "loading" — Svelte's `$state`
        // treats this as a change and reschedules every effect reading
        // `loadState`, including the one currently running `load()`.
        loadState = PREVIEW_LOADING;
        effectPending = true;
      }
      // The real `load()` also does `await getDocument(...)` here. That
      // never gets a chance to settle before the synchronous rerun above
      // fires again — which is exactly what the live reproduction showed:
      // the preview window stuck forever at "Carregando documento…"
      // (`.e2e-visual/inv-a003/05.png`) after the console logged
      // `https://svelte.dev/e/effect_update_depth_exceeded`
      // (`.e2e-visual/inv-a003/page-errors.log`).
    }
    return { loadCalls, exceededBudget: false };
  }

  it("reproduces the crash: an unconditional reset retriggers the effect without bound", () => {
    const { loadCalls, exceededBudget } = simulateMountEffect(() => true, 1_000);

    expect(exceededBudget).toBe(true);
    expect(loadCalls).toBe(1_000);
  });

  it("REQ-CPD-051/DEC-CPD-03: shouldResetToLoading breaks the cycle — the mount effect settles after one load() call, so the window can leave 'loading' and the panel behind it (a non-modal window per DEC-CPD-03) never freezes", () => {
    const { loadCalls, exceededBudget } = simulateMountEffect(shouldResetToLoading, 1_000);

    expect(exceededBudget).toBe(false);
    expect(loadCalls).toBe(1);
  });

  it("REQ-CPD-060: shouldResetToLoading is false while already loading — the mount path never rewrites loadState", () => {
    expect(shouldResetToLoading(PREVIEW_LOADING)).toBe(false);
  });

  it("REQ-CPD-051: shouldResetToLoading is true after a failure — the retry button still shows the error→loading transition", () => {
    const failed = previewError(new Error("socket is not connected"), "Falha ao carregar.");
    expect(shouldResetToLoading(failed)).toBe(true);
  });
});

describe("bugfix A003 (retry path) — a retry from 'error' must fire ONE getDocument, not two (REQ-CPD-051)", () => {
  /**
   * Models the mechanism `CompendiumPreviewWindow.svelte` actually runs when
   * the reader clicks "Tentar de novo" (`retry()`, which calls `load()`
   * directly) while `loadState.status === "error"`:
   *
   * `load()`'s `shouldResetToLoading` guard (proven above) correctly sees
   * "error" and DOES reassign `loadState` back to `PREVIEW_LOADING` — a real
   * status change. In Svelte 5 that reassignment reschedules the mount
   * `$effect` (`if (loadState.status === "loading") void load();`), which
   * runs on a later microtask and calls `load()` a SECOND time while the
   * FIRST call is still awaiting `getDocument()`. Two `compendium:get`
   * requests then race; whichever resolves last silently wins the window's
   * final state — content vs. the error block — which is not what REQ-CPD-051
   * promises ("a failure is recoverable", not "recoverable by a coin flip").
   *
   * `guardLoadInFlight` mirrors the `loadInFlight` flag added to `load()` in
   * the component: set BEFORE the reset can retrigger the effect, so the
   * effect's re-entrant call finds it already true and returns without a
   * second fetch. Passing `guardLoadInFlight: false` reproduces the bug as it
   * shipped; `true` is the fixed behavior.
   */
  function createRetryRaceHarness(guardLoadInFlight: boolean) {
    let loadState: PreviewLoadState = previewError(
      new Error("socket is not connected"),
      "Falha ao carregar.",
    );
    let loadInFlight = false;
    let getDocumentCalls = 0;
    const pendingResolvers: (() => void)[] = [];

    // The mount `$effect`: reschedules on a microtask whenever `loadState` is
    // written, exactly like Svelte's dependency-tracked reactivity.
    function scheduleEffect(): void {
      queueMicrotask(() => {
        if (loadState.status === "loading") void load();
      });
    }

    // Stands in for `getDocument(socket, uuid)` — never resolves on its own,
    // so the test controls exactly when each in-flight request settles.
    async function fakeGetDocument(): Promise<Record<string, unknown>> {
      getDocumentCalls += 1;
      return new Promise((resolve) => {
        pendingResolvers.push(() => resolve({ name: "Fireball" }));
      });
    }

    async function load(): Promise<void> {
      if (guardLoadInFlight) {
        if (loadInFlight) return;
        loadInFlight = true;
      }
      try {
        if (shouldResetToLoading(loadState)) {
          loadState = PREVIEW_LOADING;
          scheduleEffect();
        }
        const document = await fakeGetDocument();
        loadState = previewReady(document);
      } finally {
        if (guardLoadInFlight) loadInFlight = false;
      }
    }

    return {
      retry: (): void => void load(),
      getDocumentCalls: (): number => getDocumentCalls,
      resolveInFlight: (): void => {
        const resolvers = pendingResolvers.splice(0);
        for (const resolve of resolvers) resolve();
      },
    };
  }

  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  it("reproduces the bug: without the guard, one retry click fires getDocument twice", async () => {
    const harness = createRetryRaceHarness(false);

    harness.retry();
    await flushMicrotasks();

    expect(harness.getDocumentCalls()).toBe(2);
  });

  it("REQ-CPD-051: with loadInFlight guarding load(), one retry click fires getDocument exactly once", async () => {
    const harness = createRetryRaceHarness(true);

    harness.retry();
    await flushMicrotasks();

    expect(harness.getDocumentCalls()).toBe(1);

    // The single in-flight request settles normally — the guard only blocks
    // the redundant SECOND fetch, it does not stall the real one.
    harness.resolveInFlight();
    await flushMicrotasks();
    expect(harness.getDocumentCalls()).toBe(1);
  });
});

describe("the license block (REQ-CPD-052)", () => {
  it("REQ-CPD-052: the pack's license and its notices are always in the block", () => {
    const block = buildPreviewLicense(ORC_PACK, docWith(undefined));

    expect(block.packLicense).toBe("ORC");
    expect(block.attribution).toBe(ORC_PACK.attribution);
    expect(block.reservedNotice).toBe(ORC_PACK.reservedNotice);
    expect(block.source).toBe("github.com/foundryvtt/pf2e");
  });

  it("REQ-CPD-052: the document's own license shows as an override when it differs", () => {
    const block = buildPreviewLicense(
      ORC_PACK,
      docWith({ license: "OGL", title: "Pathfinder Bestiary" }),
    );

    expect(block.documentLicense).toBe("OGL");
    expect(block.documentTitle).toBe("Pathfinder Bestiary");
    expect(hasLicenseOverride(block)).toBe(true);
  });

  it("REQ-CPD-052: a document that only echoes the pack's license is not an override", () => {
    const block = buildPreviewLicense(ORC_PACK, docWith({ license: "ORC" }));

    expect(block.documentLicense).toBeNull();
    expect(block.documentTitle).toBeNull();
    expect(hasLicenseOverride(block)).toBe(false);
    // The pack half never disappears because of it.
    expect(block.packLicense).toBe("ORC");
  });

  it("REQ-CPD-052: a pack that declares no license produces a stated absence, not a blank", () => {
    const block = buildPreviewLicense(null, docWith({ license: "CC0" }));

    // `null` is what the window turns into "not declared" — it never omits the
    // block, because the license is the reason this project is clean-room.
    expect(block.packLicense).toBeNull();
    expect(block.documentLicense).toBe("CC0");
    expect(hasLicenseOverride(block)).toBe(true);
  });

  it("REQ-CPD-052: a malformed publication degrades to no override instead of throwing", () => {
    for (const publication of [null, "ORC", 42, [], { license: 7 }, { license: "   " }]) {
      const block = buildPreviewLicense(ORC_PACK, docWith(publication));
      expect(block.packLicense).toBe("ORC");
      expect(block.documentLicense).toBeNull();
    }
    expect(buildPreviewLicense(ORC_PACK, null).packLicense).toBe("ORC");
    expect(buildPreviewLicense(ORC_PACK, { system: "not an object" }).documentLicense).toBeNull();
  });
});

describe("the window inherits the line's permission (REQ-CPD-053)", () => {
  it("REQ-CPD-053: it may offer to bring the entry over only when the caller says so", () => {
    openCompendiumPreviewWindow(input({ canImport: true }), "Pré-visualização");
    const privileged = [...windowManager.windows.values()][0];
    expect(privileged?.componentProps?.["canImport"]).toBe(true);

    windowManager.closeAll();

    openCompendiumPreviewWindow(input({ canImport: false }), "Pré-visualização");
    const plain = [...windowManager.windows.values()][0];
    expect(plain?.componentProps?.["canImport"]).toBe(false);
  });

  it("REQ-CPD-053: an unstated permission is a denied one, never an assumed one", () => {
    openCompendiumPreviewWindow(input(), "Pré-visualização");
    const entry = [...windowManager.windows.values()][0];

    expect(entry?.componentProps?.["canImport"]).toBe(false);
  });

  it("REQ-CPD-053: the pack's license travels with the window, not a copy of the line", () => {
    openCompendiumPreviewWindow(input(), "Pré-visualização");
    const entry = [...windowManager.windows.values()][0];

    expect(entry?.componentProps?.["packLicense"]).toEqual(ORC_PACK);
    expect(entry?.componentProps?.["uuid"]).toBe(input().uuid);
    // The socket is deliberately NOT captured: the window resolves the live one.
    expect(entry?.componentProps).not.toHaveProperty("socket");
  });
});
