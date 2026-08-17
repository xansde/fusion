/**
 * CompendiumPreviewWindow.test.ts — what the preview window draws (spec 43
 * §5.6, G094).
 *
 * Rendered with `render()` from `svelte/server`, like the other components of
 * this tab: the client's Vitest runs in a node environment with no DOM, so the
 * server-rendered markup is what a component test reads. `$effect` never runs
 * there, which is exactly why the window takes the state it starts in — the
 * three states of REQ-CPD-051 can each be drawn and read.
 *
 * The last block reads `CompendiumBrowser.svelte`'s source instead of its
 * output, because REQ-CPD-050 is about something that must NOT exist any more:
 * the blade that replaced the list inside the panel.
 *
 * Covers REQ-CPD-050, REQ-CPD-051, REQ-CPD-052, REQ-CPD-053 and REQ-CPD-054.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PackLicense } from "@fusion/shared";

import CompendiumPreviewWindow from "../CompendiumPreviewWindow.svelte";
import {
  previewError,
  previewReady,
  type PreviewLoadState,
} from "../../../lib/compendium/previewWindow.js";
import "../../../lib/i18n/index.js";
import { i18n, t } from "../../../lib/i18n/i18n.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORC_PACK: PackLicense = {
  license: "ORC",
  attribution: "Paizo Inc. — Pathfinder Second Edition Remaster",
  reservedNotice: "Reserved Material: Pathfinder, Golarion",
  sourceRepo: "github.com/foundryvtt/pf2e",
};

const FIREBALL: Record<string, unknown> = {
  name: "Fireball",
  img: "icons/spells/fireball.webp",
  type: "spell",
  i18n: { ptBR: { name: "Bola de Fogo", description: "Uma esfera de fogo explode." } },
  system: {
    level: { value: 3 },
    traits: { value: ["fire", "arcane"] },
    description: { value: "A burst of flame." },
    publication: { license: "ORC", title: "Player Core" },
  },
};

/** The same spell, republished under whatever `system.publication` says. */
function withPublication(publication: Record<string, unknown>): Record<string, unknown> {
  return {
    ...FIREBALL,
    system: { ...(FIREBALL["system"] as Record<string, unknown>), publication },
  };
}

function renderWindow(
  props: Record<string, unknown> = {},
  state?: PreviewLoadState | undefined,
): string {
  const { body } = render(CompendiumPreviewWindow, {
    props: {
      uuid: "Compendium.pf2e.spells-core.Item.abc0123456789def",
      name: "Bola de Fogo",
      documentType: "Item",
      packId: "pf2e.spells-core",
      packLabel: "Magias",
      packLicense: ORC_PACK,
      ...(state ? { initialState: state } : {}),
      ...props,
    },
  });
  return body;
}

function browserSource(): string {
  return readFileSync(
    fileURLToPath(new URL("../CompendiumBrowser.svelte", import.meta.url)),
    "utf8",
  );
}

// ---------------------------------------------------------------------------

describe("the three states of the preview (REQ-CPD-051)", () => {
  it("REQ-CPD-051: it opens announcing that it is loading, before any document exists", () => {
    const html = renderWindow();

    expect(html).toContain(t("FUSION.Compendium.Preview.Loading"));
    expect(html).toContain('role="status"');
    // Nothing of the document is drawn yet — there is nothing to draw.
    expect(html).not.toContain("Bola de Fogo</h2>");
  });

  it("REQ-CPD-051: a failure says so, keeps what the transport said, and offers another try", () => {
    const html = renderWindow({}, previewError(new Error("Query timed out"), "Falha."));

    expect(html).toContain(t("FUSION.Compendium.Preview.Failed"));
    expect(html).toContain("Query timed out");
    expect(html).toContain('role="alert"');
    // Recoverable: the window stays, and the reader can ask again.
    expect(html).toContain(t("FUSION.Compendium.Retry"));
  });

  it("REQ-CPD-051: once loaded it shows the document, with both names and its fields", () => {
    const html = renderWindow({}, previewReady(FIREBALL));

    expect(html).toContain("Bola de Fogo");
    // The original name stays reachable, so the reader can check the book.
    expect(html).toContain("Fireball");
    expect(html).toContain("Nível");
    expect(html).toContain("compendium-preview__fields");
  });
});

describe("the license block (REQ-CPD-052)", () => {
  it("REQ-CPD-052: the pack's license, its attribution and its reserved notice are drawn", () => {
    const html = renderWindow({}, previewReady(FIREBALL));

    expect(html).toContain(t("FUSION.Compendium.Preview.LicensePack"));
    expect(html).toContain("ORC");
    expect(html).toContain(ORC_PACK.attribution);
    expect(html).toContain(ORC_PACK.reservedNotice);
  });

  it("REQ-CPD-052: the document's override is drawn only when it says something else", () => {
    // Echoing the pack's license, and saying nothing else, is not an override.
    const echo = renderWindow({}, previewReady(withPublication({ license: "ORC" })));
    expect(echo).not.toContain(t("FUSION.Compendium.Preview.LicenseDocument"));
    expect(echo).toContain("ORC");

    // A different license is.
    const overridden = renderWindow({}, previewReady(withPublication({ license: "OGL-1.0a" })));
    expect(overridden).toContain(t("FUSION.Compendium.Preview.LicenseDocument"));
    expect(overridden).toContain("OGL-1.0a");

    // ...and so is naming the publication the document came from.
    const titled = renderWindow({}, previewReady(withPublication({ title: "Player Core" })));
    expect(titled).toContain(t("FUSION.Compendium.Preview.LicenseDocument"));
    expect(titled).toContain("Player Core");
  });

  it("REQ-CPD-052: the block survives a failed load and a pack with no license", () => {
    // The terms under which the entry is published do not depend on the
    // document having arrived.
    const failed = renderWindow({}, previewError(new Error("boom"), "Falha."));
    expect(failed).toContain(t("FUSION.Compendium.Preview.License"));
    expect(failed).toContain("ORC");

    const unlicensed = renderWindow({ packLicense: null }, previewReady(FIREBALL));
    expect(unlicensed).toContain(t("FUSION.Compendium.Preview.License"));
    expect(unlicensed).toContain(t("FUSION.Compendium.Preview.LicenseUnknown"));
  });

  it("REQ-CPD-052: the license may wrap but may never be truncated", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../CompendiumPreviewWindow.svelte", import.meta.url)),
      "utf8",
    );
    const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? "";
    const css = style.replace(/\/\*[\s\S]*?\*\//g, "");
    const licenseRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) =>
      (rule[1] ?? "").includes("__license"),
    );

    expect(licenseRules.length).toBeGreaterThan(0);
    for (const rule of licenseRules) {
      expect(rule[2] ?? "").not.toContain("text-overflow");
      expect(rule[2] ?? "").not.toContain("nowrap");
    }
  });
});

describe("bringing the entry over from the window (REQ-CPD-053)", () => {
  it("REQ-CPD-053: the action appears only for a reader the caller already cleared", () => {
    const allowed = renderWindow({ canImport: true }, previewReady(FIREBALL));
    expect(allowed).toContain(t("FUSION.Compendium.Line.ImportShort"));

    const denied = renderWindow({ canImport: false }, previewReady(FIREBALL));
    expect(denied).not.toContain(t("FUSION.Compendium.Line.ImportShort"));
  });

  it("REQ-CPD-053: with nothing said about the permission, the action is not offered", () => {
    expect(renderWindow({}, previewReady(FIREBALL))).not.toContain(
      t("FUSION.Compendium.Line.ImportShort"),
    );
  });
});

// ---------------------------------------------------------------------------
// The window names a field the way the LINE names it, in the reader's language
// ---------------------------------------------------------------------------
//
// The row and the window opened from that row must not name the same field
// differently: the line resolves `FUSION.Compendium.Field.*` through the
// bundle, so the window has to as well. A pt-BR string compiled into the
// module would spell "Nível" at an `en` seat, right beside the row's "Level".

describe("the preview names its fields through the bundle (REQ-CPD-051)", () => {
  it("REQ-CPD-051: the window follows the active locale, like the line above it", () => {
    const previous = i18n.locale;
    try {
      i18n.setLocale("pt-BR");
      const ptBr = renderWindow({}, previewReady(FIREBALL));
      expect(ptBr).toContain("Nível");
      expect(ptBr).toContain("Traços");

      i18n.setLocale("en");
      const en = renderWindow({}, previewReady(FIREBALL));
      expect(en).toContain("Level");
      expect(en).toContain("Traits");
      // The pt-BR word is gone at an `en` seat — it was never a compiled string.
      expect(en).not.toContain("Nível");
    } finally {
      i18n.setLocale(previous);
    }
  });

  it("REQ-CPD-051: a mechanical rule is named through the bundle too, not in-module", () => {
    const blinded: Record<string, unknown> = {
      name: "Blinded",
      img: null,
      type: "condition",
      system: {
        publication: { license: "ORC" },
        rules: [{ kind: "flat-modifier", selector: "perception", value: -4, type: "status" }],
      },
    };
    const previous = i18n.locale;
    try {
      i18n.setLocale("en");
      const en = renderWindow({}, previewReady(blinded));
      expect(en).toContain("Modifier");
      expect(en).not.toContain("Modificador");
    } finally {
      i18n.setLocale(previous);
    }
  });

  it("REQ-CPD-051: no pt-BR label is compiled into the preview builder", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../../lib/compendium/compendiumBrowser.ts", import.meta.url)),
      "utf8",
    );

    for (const word of ['"Nível"', '"Tradições"', '"Imunidade"', '"Resistência"']) {
      expect(src).not.toContain(word);
    }
  });
});

describe("bugfix A003 — the mount effect's guard is real in production code (REQ-CPD-051, DEC-CPD-03)", () => {
  /**
   * `previewWindow.test.ts` proves, with a standalone model, that an
   * unconditional `loadState = PREVIEW_LOADING` inside the mount effect's
   * `load()` retriggers Svelte 5's `$effect` forever
   * (`effect_update_depth_exceeded`) — that model never reads this component's
   * source. This test closes that gap: it reads
   * `CompendiumPreviewWindow.svelte` itself and asserts the ONE reassignment
   * to `PREVIEW_LOADING` inside `load()` sits behind the `shouldResetToLoading`
   * guard, so a future edit that removes the guard, or adds a second,
   * unguarded reassignment, fails here without needing a live Svelte runtime.
   */
  it("REQ-CPD-051: load() resets to PREVIEW_LOADING only behind shouldResetToLoading, never unconditionally", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../CompendiumPreviewWindow.svelte", import.meta.url)),
      "utf8",
    );
    const script = /<script lang="ts">([\s\S]*?)<\/script>/.exec(source)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(0);

    const resetOccurrences = script.match(/loadState = PREVIEW_LOADING;/g) ?? [];
    expect(resetOccurrences).toHaveLength(1);

    expect(script).toMatch(
      /if \(shouldResetToLoading\(loadState\)\) \{\s*loadState = PREVIEW_LOADING;\s*\}/,
    );
  });
});

describe("the panel no longer previews inside itself (REQ-CPD-050, REQ-CPD-054)", () => {
  it("REQ-CPD-050: the drawer's panel holds no preview blade and no preview state", () => {
    const src = browserSource();

    // The blade that used to replace the list inside 300px is gone.
    expect(src).not.toContain("preview-panel");
    expect(src).not.toContain("previewData");
    expect(src).not.toContain("previewDoc");
    // ...and the panel does not load documents any more: the window does.
    expect(src).not.toContain("getDocument(");
  });

  it("REQ-CPD-050: the panel delegates the preview to the window manager", () => {
    const src = browserSource();

    expect(src).toContain("openCompendiumPreviewWindow(");
    expect(src).toContain("onPreview={() => openPreview(");
  });

  it("REQ-CPD-054: nothing in the panel closes a preview window", () => {
    const src = browserSource();

    // Closing the drawer, changing scope or unmounting the tab must leave the
    // open previews alone — so the panel never reaches into the registry.
    expect(src).not.toContain("windowManager");
    expect(src).not.toContain("closeAll");
  });
});
