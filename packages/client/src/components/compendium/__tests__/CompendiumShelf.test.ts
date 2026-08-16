/**
 * CompendiumShelf.test.ts — the shelf body drawn (spec 43 §5.3, G092).
 *
 * Rendered with `render()` from `svelte/server`, like `ScenesTab.test.ts` and
 * `CompendiumBrowser.test.ts`: the client's Vitest runs in a node environment
 * with no DOM, so the server-rendered markup is what a component test reads.
 * The shelf is a presentational component precisely so it can be handed real
 * packs here — the panel loads them in an `$effect`, which never runs under the
 * server renderer.
 *
 * Covers REQ-CPD-020 (collapsible groups per document type, with the pack count),
 * REQ-CPD-021 (label, document count and license on every row — the license
 * being the one field that may not be truncated, DEC-CPD-07), REQ-CPD-022 (the
 * `gm` audience marked on the privileged shelf) and REQ-CPD-025 (world packs in
 * the same groups, told apart by the license).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PackManifest } from "@fusion/shared";

import CompendiumShelf from "../CompendiumShelf.svelte";
import { buildShelfGroups } from "../../../lib/compendium/compendiumShelf.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePack(overrides: Partial<PackManifest> & { id: string }): PackManifest {
  return {
    label: overrides.id,
    documentType: "Item",
    systemId: "pf2e",
    indexFields: [],
    license: {
      license: "ORC",
      attribution: "Paizo Inc.",
      reservedNotice: "Reserved Material notice",
    },
    audience: "all",
    source: { repo: "github.com/foundryvtt/pf2e", version: "v8.2.0", importerVersion: "1.0.0" },
    documentCount: 0,
    generatedAt: "2026-08-16T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  } as PackManifest;
}

const SYSTEM_ITEMS = makePack({
  id: "pf2e.equipment",
  label: "Equipamento",
  documentType: "Item",
  documentCount: 5241,
});

const WORLD_ITEMS = makePack({
  id: "world.itens-da-mesa",
  label: "Itens da mesa",
  documentType: "Item",
  systemId: "world",
  documentCount: 12,
  license: { license: "custom", attribution: "Mesa do Xande", reservedNotice: "" },
  source: { repo: null, version: null, importerVersion: "1.0.0" },
});

const BESTIARY = makePack({
  id: "pf2e.bestiary-core",
  label: "Bestiário",
  documentType: "Actor",
  documentCount: 492,
  audience: "gm",
});

function renderShelf(
  packs: readonly PackManifest[],
  options: { viewerIsPrivileged?: boolean; collapsed?: ReadonlySet<string> } = {},
): string {
  const { body } = render(CompendiumShelf, {
    props: {
      groups: buildShelfGroups(packs, {
        viewerIsPrivileged: options.viewerIsPrivileged ?? true,
        collapsed: options.collapsed ?? new Set<string>(),
      }),
      onOpenPack: () => undefined,
      onToggleGroup: () => undefined,
    },
  });
  return body;
}

function source(): string {
  return readFileSync(fileURLToPath(new URL("../CompendiumShelf.svelte", import.meta.url)), "utf8");
}

/** The declarations of one CSS rule, by selector, from the component's style. */
function declarationsOf(selector: string): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(source())?.[1];
  if (style === undefined) throw new Error("CompendiumShelf.svelte has no <style> block");
  const css = style.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((rule) => (rule[1] ?? "").split(",").some((s) => s.trim() === selector))
    .map((rule) => rule[2] ?? "")
    .join("\n");
}

// ---------------------------------------------------------------------------

describe("CompendiumShelf — packs by type, with the license always", () => {
  it("REQ-CPD-020: one collapsible group per document type, each showing its pack count", () => {
    const html = renderShelf([SYSTEM_ITEMS, WORLD_ITEMS, BESTIARY]);

    expect(html).toContain(t("FUSION.Compendium.DocType.Item"));
    expect(html).toContain(t("FUSION.Compendium.DocType.Actor"));
    // Every heading is a real control that says whether it is open.
    expect([...html.matchAll(/aria-expanded="true"/g)]).toHaveLength(2);
    // Two Item packs, one Actor pack — the count is of packs.
    expect(html).toContain(t("FUSION.Compendium.Shelf.PackCount", { count: 2 }));
    expect(html).toContain(t("FUSION.Compendium.Shelf.PackCount", { count: 1 }));
  });

  it("REQ-CPD-020: a collapsed group keeps its heading and drops its packs", () => {
    const html = renderShelf([SYSTEM_ITEMS, BESTIARY], { collapsed: new Set(["Item"]) });

    expect(html).toContain(t("FUSION.Compendium.DocType.Item"));
    expect(html).toContain('aria-expanded="false"');
    // The collapsed group's pack is gone; the expanded one's is still there.
    expect(html).not.toContain("Equipamento");
    expect(html).toContain("Bestiário");
  });

  it("REQ-CPD-021: every row shows label, document count and license", () => {
    const html = renderShelf([SYSTEM_ITEMS]);

    expect(html).toContain("Equipamento");
    expect(html).toContain(t("FUSION.Compendium.Shelf.DocumentCount", { count: 5241 }));
    expect(html).toContain("ORC");
    // The long prose rides along as the row's tooltip, not as drawn text.
    expect(html).toContain("Paizo Inc.");
  });

  it("REQ-CPD-021: the license is drawn for every pack, never behind a condition", () => {
    const html = renderShelf([SYSTEM_ITEMS, WORLD_ITEMS, BESTIARY]);

    // One license box per row, no exceptions (DEC-CPD-07).
    expect([...html.matchAll(/class="pack-row__license /g)]).toHaveLength(3);
    // ...and nothing in the template can suppress it.
    const template = source().slice(source().indexOf("</script>"));
    const licenseAt = template.indexOf('class="pack-row__license"');
    expect(licenseAt).toBeGreaterThan(0);
    expect(template.slice(0, licenseAt)).not.toMatch(/\{#if[^}]*license/i);
  });

  it("REQ-CPD-021: the license box is the one that never truncates", () => {
    // The label may be cut to fit the drawer; the license may not (DEC-CPD-07),
    // so it wraps instead of ellipsing. Declarative rule, checked in the CSS.
    const label = declarationsOf(".pack-row__label");
    const license = declarationsOf(".pack-row__license");

    expect(label).toContain("text-overflow: ellipsis");
    expect(license.length).toBeGreaterThan(0);
    expect(license).not.toContain("text-overflow");
    expect(license).not.toMatch(/white-space:\s*nowrap/);
    expect(license).toMatch(/overflow-wrap|word-break/);
  });

  it("REQ-CPD-022: a `gm` pack is marked as such on the privileged shelf", () => {
    const html = renderShelf([SYSTEM_ITEMS, BESTIARY], { viewerIsPrivileged: true });

    expect(html).toContain(t("FUSION.Compendium.Shelf.GmOnly"));
    // Exactly one row carries it — the bestiary, not the equipment.
    expect([...html.matchAll(/class="pack-row__gm /g)]).toHaveLength(1);
  });

  it("REQ-CPD-022: the player's shelf never carries the mark", () => {
    const html = renderShelf([SYSTEM_ITEMS, BESTIARY], { viewerIsPrivileged: false });

    expect(html).not.toContain(t("FUSION.Compendium.Shelf.GmOnly"));
    expect(html).not.toContain("pack-row__gm");
  });

  it("REQ-CPD-025: a world pack sits in the same group, distinguished by its license", () => {
    const html = renderShelf([SYSTEM_ITEMS, WORLD_ITEMS]);

    // One group heading for Item, one list, both packs inside it.
    expect([...html.matchAll(/class="pack-group__list /g)]).toHaveLength(1);
    const listAt = html.indexOf('class="pack-group__list ');
    const list = html.slice(listAt);
    expect(list).toContain("Equipamento");
    expect(list).toContain("Itens da mesa");
    // The tell between them is the license, not a badge or a separate section.
    expect(list).toContain("ORC");
    expect(list).toContain("custom");
  });

  it("REQ-CPD-020: the collapse affordance is drawn, never an emoji", () => {
    const html = renderShelf([SYSTEM_ITEMS]);

    expect(html).toContain("<svg");
    // Pictographs are barred across the drawer (DEC-ACH-04, spec 38 §12: the
    // decision — not any one tab's requirement — is the drawer-wide principle).
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
