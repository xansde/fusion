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
 * REQ-CPD-017 and REQ-CPD-024 (the result replaces the shelf, never joins it),
 * plus the facets of §5.4 (REQ-CPD-033, REQ-CPD-034), the visible return of
 * bringing an entry over (REQ-CPD-060) and §5.10's empty state, failures and
 * accessibility (REQ-CPD-090, REQ-CPD-091, REQ-CPD-092, REQ-CPD-093).
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

// ---------------------------------------------------------------------------
// §5.10 — failure has channels, and each one owes the RIGHT new attempt
// ---------------------------------------------------------------------------
//
// REQ-CPD-091 [MVP]: failing to list packs, to search or to open a pack must
// appear as a message WITH a new attempt, never as a silent empty list. Three
// different failures, so three different retries — a single button that always
// re-lists the packs is not a new attempt for the other two.
//
// `$effect` never runs under the server renderer, so a failure can never be
// staged in the markup; what is checked is the wiring in the template and in the
// script, where the requirement lives.

describe("every failure carries its own new attempt (REQ-CPD-091)", () => {
  it("REQ-CPD-091: the body's retry re-runs the call that failed, not always the pack list", () => {
    const src = source();

    // The failing call stores itself, so opening a pack retries THAT index.
    expect(src).toMatch(/retryAction = \(\) => void loadPacks\(\)/);
    expect(src).toMatch(/retryAction = \(\) => void loadPackIndex\(packId\)/);
    // And the button spends it instead of hardcoding one of the two.
    const template = src.slice(src.indexOf("</script>"));
    expect(template).toContain("onclick={() => retryAction?.()}");
    expect(template).not.toContain("onclick={loadPacks}");
  });

  it("REQ-CPD-091: a failed SEARCH shows the message and a new attempt beside it", () => {
    const template = source().slice(source().indexOf("</script>"));
    const errorAt = template.indexOf("{searchError}");
    expect(errorAt).toBeGreaterThan(-1);

    // The alert is immediately followed by the retry — the aggregated body used
    // to state the failure and offer nothing at all.
    const afterError = template.slice(errorAt, errorAt + 400);
    expect(afterError).toContain("compendium-browser__retry-search");
    expect(afterError).toContain("FUSION.Compendium.Retry");
    expect(source()).toContain("function retrySearch()");
  });

  it("REQ-CPD-090: with no pack visible the shelf explains it by role and offers nothing", () => {
    const html = renderPanel();

    expect(html).toContain(t("FUSION.Compendium.NoPacksForRole"));
    // No action is drawn in that state — there is none this seat could take.
    expect(html).not.toContain(t("FUSION.Compendium.Retry"));
    expect(html).not.toContain("compendium-browser__batch-start");
  });
});

// ---------------------------------------------------------------------------
// §5.7 — the return of bringing an entry over is NOT the body's error channel
// ---------------------------------------------------------------------------

describe("bringing an entry over answers on its own channel (REQ-CPD-060)", () => {
  it("REQ-CPD-060: a refused import writes to importError, never to the body's error", () => {
    const src = source();
    const bringOver = src.slice(src.indexOf("async function bringOver("));
    const body = bringOver.slice(0, bringOver.indexOf("\n  }\n"));

    // The catch of the import must not touch `error`: that one replaces the
    // whole body and offers a retry of a different operation entirely.
    expect(body).toContain("importError = err instanceof Error");
    expect(body).not.toMatch(/(^|[^t])\berror = /m);
  });

  it("REQ-CPD-060: success AND failure are drawn in the header, so both bodies show them", () => {
    const template = source().slice(source().indexOf("</script>"));
    const importBarAt = template.indexOf('class="compendium-browser__import"');
    const scrollAt = template.indexOf('class="compendium-browser__scroll"');

    expect(importBarAt).toBeGreaterThan(-1);
    // Both live above the one scrolling area, which is what makes them visible
    // in the shelf, in the aggregated result and inside an open pack alike.
    const header = template.slice(importBarAt, scrollAt);
    expect(header).toContain("{importSuccess}");
    expect(header).toContain("{importError}");
    expect(template.slice(scrollAt)).not.toContain("{importSuccess}");
    expect(template.slice(scrollAt)).not.toContain("{importError}");
  });

  it("REQ-CPD-060: the two are announced as what they are — a status and an alert", () => {
    const template = source().slice(source().indexOf("</script>"));
    const successAt = template.indexOf("{importSuccess}");
    const errorAt = template.indexOf("{importError}");

    expect(template.slice(successAt - 120, successAt)).toContain('role="status"');
    expect(template.slice(errorAt - 120, errorAt)).toContain('role="alert"');
  });
});

// ---------------------------------------------------------------------------
// §5.4 — the facets, where they can be seen and taken off
// ---------------------------------------------------------------------------

describe("the facets of §5.4 (REQ-CPD-033, REQ-CPD-034)", () => {
  it("REQ-CPD-033: type, rarity and level range are offered at root, in the header", () => {
    const html = renderPanel();

    expect(html).toContain(t("FUSION.Compendium.Facet.DocumentType"));
    expect(html).toContain(t("FUSION.Compendium.Facet.Rarity"));
    expect(html).toContain(t("FUSION.Compendium.FilterMinLevel"));
    expect(html).toContain(t("FUSION.Compendium.FilterMaxLevel"));

    // They are OUTSIDE the one scrolling area, like the search bar
    // (REQ-CPD-016): a facet that scrolls away is a facet you cannot remove.
    const facetsAt = classAt(html, "compendium-browser__facets");
    const scrollAt = classAt(html, "compendium-browser__scroll");
    expect(facetsAt).toBeGreaterThanOrEqual(0);
    expect(facetsAt).toBeLessThan(scrollAt);
    expect(html.slice(scrollAt)).not.toContain("compendium-browser__facet-select");
  });

  it("REQ-CPD-033: inside a pack, the document-type facet reads the OPEN PACK's own choices, not the shelf's", () => {
    // `openPackId` is derived from internal scope state that only a click
    // gesture changes, and `$effect` never runs under the server renderer
    // (see the file banner), so this scope cannot be reached by feeding
    // props to `render()` — the wiring is read in the template instead, the
    // same instrument REQ-CPD-031 and REQ-CPD-091 already use for states the
    // SSR harness cannot stage.
    const template = source().slice(source().indexOf("</script>"));

    // A040: the select hides only when the OPEN PACK's own type choices
    // collapse to at most one — never a hardcoded "always hide inside a
    // pack" — so a manifest that ever carries more than one type stays
    // filterable.
    expect(template).toContain("{#if openPackId === null || packTypeChoices.length > 1}");
    // And when it does render inside a pack, its options come from the
    // pack's own choices, never a leftover copy of the shelf's full list.
    expect(template).toContain("(openPackId === null ? typeChoices : packTypeChoices)");
  });

  it("REQ-CPD-033: the source facet appears only once the answer spans more than one pack", () => {
    // Nothing has been searched, so there is no answer and no source to pick.
    expect(renderPanel()).not.toContain(t("FUSION.Compendium.Facet.Source"));

    const template = source().slice(source().indexOf("</script>"));
    expect(template).toContain("packChoices.length > 1");
  });

  it("REQ-CPD-034: each active facet is drawn as a chip that clears that facet alone", () => {
    const template = source().slice(source().indexOf("</script>"));
    const chipsAt = template.indexOf("activeFacetChips");
    expect(chipsAt).toBeGreaterThan(-1);

    const chips = template.slice(chipsAt, chipsAt + 900);
    expect(chips).toContain("removeFacet(chip.facet)");
    // One control per facet — the removal is a real button, so it is reachable
    // by keyboard like every other action of the panel (REQ-CPD-092).
    expect(chips).toContain('type="button"');
    expect(source()).toContain("clearFacet(scopeState, key)");

    // And there are no chips at rest, because no facet is in force.
    expect(renderPanel()).not.toContain("compendium-browser__chip");
  });

  it("REQ-CPD-034: a facet means the same thing in both scopes, so it survives widening", () => {
    const src = source();

    // The level range and the rarity reach the open pack's own filtering...
    expect(src).toContain("scopeState.facets.minLevel");
    expect(src).toContain("scopeState.facets.rarity");
    // ...and the pack body no longer draws a second copy of the level inputs,
    // which is what used to make the facet vanish when the scope widened.
    const template = src.slice(src.indexOf("</script>"));
    expect([...template.matchAll(/FUSION\.Compendium\.FilterMinLevel/g)]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// §5.10 — keyboard and screen reader
// ---------------------------------------------------------------------------

describe("the result is navigable and announceable (REQ-CPD-092, REQ-CPD-093)", () => {
  it("REQ-CPD-093: a group heading announces its count as words, not a bare digit", () => {
    const template = source().slice(source().indexOf("</script>"));

    expect(template).toContain("FUSION.Compendium.GroupCountLabel");
    expect(t("FUSION.Compendium.GroupCountLabel", { type: "Itens", count: 12 })).toContain("Itens");
    expect(t("FUSION.Compendium.GroupCountLabel", { type: "Itens", count: 12 })).not.toContain(
      "FUSION.",
    );
  });

  it("REQ-CPD-092: every control this panel draws is a real button, focusable by keyboard", () => {
    const template = source().slice(source().indexOf("</script>"));
    // A click handler on a <div> or a <span> would be unreachable by keyboard.
    const clickable = [...template.matchAll(/<(\w+)[^>]*\sonclick=/g)].map((m) => m[1]);

    expect(clickable.length).toBeGreaterThan(0);
    expect([...new Set(clickable)]).toEqual(["button"]);
  });
});

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

// ---------------------------------------------------------------------------
// A040 review fix — sorting is wired into the aggregated body, and the field
// it sorts by is always one its own toolbar can point to (REQ-CPD-031)
// ---------------------------------------------------------------------------
//
// `$effect` never runs under the server renderer, so the aggregated body
// never has data to draw and `sortedAggregated`/`effectiveSortField` cannot
// be exercised by feeding props to `render()`. Same instrument the rest of
// this file already uses for wiring `$effect` hides (see REQ-CPD-091 above):
// read the template/script, where the requirement lives.

describe("the aggregated result can be reordered, by a field its toolbar owns (REQ-CPD-031)", () => {
  it("REQ-CPD-031: the aggregated body draws its own Name/Type sort toolbar, without Nível", () => {
    const template = source().split("<style>")[0] ?? "";
    // The FIRST `entries-sort` toolbar in the template is the aggregated
    // one (it comes before the pack body in source order); the pack's own
    // toolbar — the second occurrence — is allowed a "Nível" button, the
    // aggregated one is not (REQ-CPD-031: no button, no way to reach that
    // sort from here).
    const toolbarAt = template.indexOf('class="entries-sort"');
    expect(toolbarAt).toBeGreaterThan(-1);
    const toolbar = template.slice(toolbarAt, toolbarAt + 400);

    expect(toolbar).toMatch(/onclick={\(\) => toggleSort\("name"\)}/);
    expect(toolbar).toMatch(/onclick={\(\) => toggleSort\("type"\)}/);
    expect(toolbar).not.toMatch(/onclick={\(\) => toggleSort\("level"\)}/);
  });

  it("REQ-CPD-031: the aggregated body's groups come from the SORTED result, not the unsorted one", () => {
    const template = source().split("<style>")[0] ?? "";
    expect(template).toContain("{#each sortedAggregated.groups as group (group.documentType)}");
    expect(template).not.toContain(
      "{#each visibleAggregated.groups as group (group.documentType)}",
    );
  });

  it("REQ-CPD-031: sorting by level, then leaving the pack, folds back to a field the aggregated toolbar can name", () => {
    const src = source();
    // The derived value both the aggregated sort and its arrows read from —
    // it exists, and it is the thing that stands between a stored "level"
    // field and a scope that has no button for it.
    expect(src).toMatch(
      /const effectiveSortField = \$derived<SortField>\(\s*openPackId === null && sortField === "level" \? "name" : sortField,/,
    );
    // Both consumers use the folded field, not the raw one, so a leftover
    // "level" selection can never leave the aggregated toolbar with both
    // arrows blank while the list is silently sorted by level anyway.
    expect(src).toMatch(/sortAggregatedResult\(visibleAggregated, effectiveSortField, sortAsc\)/);
    const sortArrowFn = src.slice(src.indexOf("function sortArrow("));
    const body = sortArrowFn.slice(0, sortArrowFn.indexOf("\n  }\n"));
    expect(body).toContain("if (effectiveSortField !== field) return");
  });
});
