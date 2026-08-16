/**
 * CompendiumBrowser.test.ts — the panel that has two bodies and no mode switch
 * (spec 43, G091).
 *
 * Rendered with `render()` from `svelte/server`, like `ScenesTab.test.ts`: the
 * client's Vitest runs in a node environment with no DOM, so the server-rendered
 * markup is what a component test can look at. The gestures that move the scope
 * (open a pack, widen, go back) are pure transitions and are tested in
 * `lib/compendium/__tests__/browserScope.test.ts`.
 *
 * Two assertions read the component's own source instead of its output: the
 * width rule of REQ-CPD-017 is declarative (Svelte's server renderer emits no
 * `<style>`), and "there is no control that switches mode" is about something
 * that must NOT exist. Both are the requirement, so they are checked where they
 * are visible.
 *
 * Covers REQ-CPD-010, REQ-CPD-011, REQ-CPD-014, REQ-CPD-015, REQ-CPD-016,
 * REQ-CPD-017 and REQ-CPD-024 (the result replaces the shelf, never joins it).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import CompendiumBrowser from "../CompendiumBrowser.svelte";
import { bodyMode, initialBrowserScope, setSearch } from "../../../lib/compendium/browserScope.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

/**
 * The panel opens at root with an empty search, which is the shelf
 * (REQ-CPD-011); `$effect` never runs under the server renderer, so no socket
 * call is made and the shelf is the empty one.
 */
function renderPanel(): string {
  const { body } = render(CompendiumBrowser, {
    props: {
      socket: { connected: true, emit: () => undefined } as never,
      worldId: "world-1",
      userId: "user-1",
      isGm: true,
      activeSceneId: null,
    },
  });
  return body;
}

function source(): string {
  return readFileSync(
    fileURLToPath(new URL("../CompendiumBrowser.svelte", import.meta.url)),
    "utf8",
  );
}

function styleBlock(): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(source())?.[1];
  if (style === undefined) throw new Error("CompendiumBrowser.svelte has no <style> block");
  return style;
}

/** The declarations of one CSS rule, by selector, from the component's style. */
function declarationsOf(selector: string): string {
  const css = styleBlock().replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return rules
    .filter((rule) => (rule[1] ?? "").split(",").some((s) => s.trim() === selector))
    .map((rule) => rule[2] ?? "")
    .join("\n");
}

/**
 * Where a class starts in the rendered markup. Svelte appends its scope class
 * to every `class` attribute, so the attribute is matched by its opening.
 */
function classAt(html: string, className: string): number {
  return html.indexOf(`class="${className} `);
}

describe("CompendiumBrowser — one panel, two bodies, no switch", () => {
  it("REQ-CPD-011: at rest the body is the shelf, and no result body is rendered", () => {
    const html = renderPanel();

    expect(html).toContain("compendium-browser__shelf");
    expect(html).not.toContain("compendium-browser__results");
  });

  it("REQ-CPD-010: nothing on the panel switches the mode — it is derived", () => {
    const src = source();

    // The body comes from the pure derivation, never from a control.
    expect(src).toContain("bodyMode(");
    expect(src).toContain('mode === "shelf"');
    // No control assigns a mode: the only writes to the scope are the gestures.
    expect(/mode\s*=\s*["']/.test(src)).toBe(false);
    expect(src).not.toContain("toggleMode");
  });

  it("REQ-CPD-015: the current scope is named in text, always", () => {
    const html = renderPanel();

    expect(html).toContain(t("FUSION.Compendium.Scope.All"));
    // At root there is nothing to go back FROM, so no back control is offered.
    expect(html).not.toContain(t("FUSION.Compendium.BackToShelf"));
    // ...but the panel knows how to offer it once a pack is open.
    expect(source()).toContain("FUSION.Compendium.BackToShelf");
  });

  it("REQ-CPD-014: widening is an explicit action, bound to the scope transition", () => {
    const src = source();

    expect(src).toContain("FUSION.Compendium.WidenSearch");
    expect(src).toContain("widenToWholeCollection(scopeState)");
    // It is offered only while the search is confined to a pack.
    expect(src).toContain("canWidenToWholeCollection(scopeState)");
    // And it is NOT offered at root, where there is nothing wider.
    expect(renderPanel()).not.toContain("compendium-browser__widen");
  });

  it("REQ-CPD-016: the search bar sits outside the one scrolling area", () => {
    const html = renderPanel();

    const searchAt = classAt(html, "compendium-browser__search");
    const scrollAt = classAt(html, "compendium-browser__scroll");
    expect(searchAt).toBeGreaterThanOrEqual(0);
    expect(scrollAt).toBeGreaterThanOrEqual(0);
    // The search bar closes before the scrolling area opens — it is a sibling of
    // the scroller, not something inside it that would scroll away.
    expect(searchAt).toBeLessThan(scrollAt);
    expect(html.slice(scrollAt)).not.toContain("compendium-browser__search-input");

    // And the scroller is the only thing that scrolls.
    expect(declarationsOf(".compendium-browser__scroll")).toContain("overflow-y: auto");
    expect(declarationsOf(".compendium-browser__search")).toContain("flex-shrink: 0");
  });

  it("REQ-CPD-016: the search bar is rendered in both bodies, not per mode", () => {
    const src = source();
    const template = src.slice(src.indexOf("</script>"));

    // One search bar, outside every mode branch: it cannot disappear with a mode.
    expect([...template.matchAll(/class="compendium-browser__search"/g)]).toHaveLength(1);
    expect(template.indexOf('class="compendium-browser__search"')).toBeLessThan(
      template.indexOf('mode === "shelf"'),
    );
  });

  it("REQ-CPD-024: with something typed at root, the result replaces the shelf", () => {
    // The mode is derived, so "search filled at root" IS the result body...
    expect(bodyMode(setSearch(initialBrowserScope(), "bola de fogo"))).toBe("results");

    // ...and the two bodies are branches of the same `{#if}`, so the shelf
    // cannot be drawn alongside the result — there is no parallel to allow.
    const template = source().slice(source().indexOf("</script>"));
    const shelfAt = template.indexOf('class="compendium-browser__shelf"');
    const resultsAt = template.indexOf('class="compendium-browser__results');
    expect(shelfAt).toBeGreaterThan(0);
    expect(resultsAt).toBeGreaterThan(shelfAt);
    expect(template.slice(shelfAt, resultsAt)).toContain("{:else");

    // And at rest (root, empty) only the shelf is rendered.
    const html = renderPanel();
    expect(html).toContain("compendium-browser__shelf");
    expect(html).not.toContain("compendium-browser__results");
  });

  it("REQ-CPD-017: neither the panel nor either body declares a width", () => {
    // The drawer owns the one fixed width (REQ-GAV-012); if the panel or a body
    // asked for one, switching mode could move the edge of the drawer.
    for (const selector of [
      ".compendium-browser",
      ".compendium-browser__shelf",
      ".compendium-browser__results",
    ]) {
      const declarations = declarationsOf(selector);
      expect(declarations.length).toBeGreaterThan(0);
      expect(declarations).not.toMatch(/(^|[\s;])(min-|max-)?width\s*:/);
    }
    // Wide content is clipped by the scroller instead of pushing the column out.
    expect(declarationsOf(".compendium-browser__scroll")).toContain("overflow-x: hidden");
  });
});

// ---------------------------------------------------------------------------
// REQ-CPD-032 — the way OUT of a truncated group
// ---------------------------------------------------------------------------
//
// The server sends the per-pack tally and the client keeps it
// (`lib/compendium/__tests__/aggregatedSearch.test.ts`); what is checked here
// is that the panel spends it — a group that only counts what it hid leaves the
// reader with no way to reach the rest. `$effect` never runs under the server
// renderer, so the aggregated body never has data to draw: the wiring is read
// in the template, where the requirement lives.

describe("a truncated group offers the pack it hid (REQ-CPD-032)", () => {
  it("REQ-CPD-032: the truncation notice is followed by a control that opens the pack", () => {
    const template = source().split("<style>")[0] ?? "";
    const omittedAt = template.indexOf("FUSION.Compendium.Omitted");
    expect(omittedAt).toBeGreaterThan(-1);

    // The block that says how many were left out also draws one control per
    // contributing pack, and that control opens the pack in its own scope.
    const notice = template.slice(omittedAt, omittedAt + 900);
    expect(notice).toContain("group.packs");
    expect(notice).toMatch(/openPackById\(tally\.packId, tally\.label\)/);
    expect(notice).toContain("FUSION.Compendium.OpenPackWithMatches");
  });

  it("REQ-CPD-032: the control names the pack and how many it holds, in the reader's language", () => {
    // Both bundles answer, so the button is never drawn as a raw key.
    expect(t("FUSION.Compendium.OpenPackWithMatches", { pack: "Magias", count: 37 })).toContain(
      "Magias",
    );
    expect(t("FUSION.Compendium.OpenPackWithMatches", { pack: "Magias", count: 37 })).not.toContain(
      "FUSION.",
    );
  });
});
