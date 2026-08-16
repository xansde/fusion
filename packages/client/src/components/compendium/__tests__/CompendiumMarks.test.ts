/**
 * CompendiumMarks.test.ts — pinned and recently used, drawn (spec 43 §5.9, G096).
 *
 * Rendered with `render()` from `svelte/server`, like `CompendiumShelf.test.ts`:
 * the client's Vitest has no DOM, so the server-rendered markup is what a
 * component test reads.
 *
 * Covers REQ-CPD-082 (a pinned block of its own, on top of the shelf, with the
 * unpin gesture), REQ-CPD-083 (a short recently-used block) and REQ-CPD-084 (a
 * pin whose pack is no longer visible is simply not among the rows, and the
 * others are still drawn). The pin gesture on the result line itself is asserted
 * here too, since it is the door into the pinned list.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import CompendiumMarks from "../CompendiumMarks.svelte";
import CompendiumResultLine from "../CompendiumResultLine.svelte";
import {
  COMPENDIUM_RECENT_LIMIT,
  filterByVisiblePacks,
  recordRecentEntry,
  togglePinnedEntry,
  type CompendiumEntryRef,
  type CompendiumRecentEntry,
} from "../../../lib/compendium/compendiumPrefs.js";
import { buildResultLine } from "../../../lib/compendium/resultLine.js";
import type { PackIndexEntry } from "@fusion/shared";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

const FIREBALL: CompendiumEntryRef = {
  uuid: "Compendium.pf2e.spells.Item.fireball",
  packId: "pf2e.spells",
  name: "Bola de Fogo",
  documentType: "Item",
};

const GOBLIN: CompendiumEntryRef = {
  uuid: "Compendium.pf2e.bestiary.Actor.goblin",
  packId: "pf2e.bestiary",
  name: "Goblin Guerreiro",
  documentType: "Actor",
};

function drawMarks(
  pinned: readonly CompendiumEntryRef[],
  recent: readonly CompendiumRecentEntry[],
): string {
  return render(CompendiumMarks, {
    props: { pinned, recent, onOpenPack: () => {}, onUnpin: () => {} },
  }).body;
}

describe("REQ-CPD-082: the pinned block", () => {
  it("REQ-CPD-082: pinned entries get their own block, each with the unpin gesture", () => {
    const markup = drawMarks(togglePinnedEntry([], FIREBALL), []);

    expect(markup).toContain(t("FUSION.Compendium.Marks.Pinned"));
    expect(markup).toContain("Bola de Fogo");
    expect(markup).toContain(t("FUSION.Compendium.Marks.Unpin", { name: FIREBALL.name }));
  });

  it("REQ-CPD-082: an empty block draws nothing — no heading over an empty list", () => {
    expect(drawMarks([], [])).not.toContain(t("FUSION.Compendium.Marks.Pinned"));
    expect(drawMarks([], [])).not.toContain(t("FUSION.Compendium.Marks.Recent"));
    // Not one section either: an empty heading would cost the shelf a row.
    expect(drawMarks([], [])).not.toContain("<section");
  });

  it("REQ-CPD-084: a pin whose pack is gone is not drawn, and the others still are", () => {
    const pinned = [GOBLIN, FIREBALL];

    // The player's visible packs no longer include the bestiary.
    const markup = drawMarks(filterByVisiblePacks(pinned, ["pf2e.spells"]), []);

    expect(markup).toContain("Bola de Fogo");
    expect(markup).not.toContain("Goblin Guerreiro");
    // No error state was drawn in its place either.
    expect(markup).toContain(t("FUSION.Compendium.Marks.Pinned"));
  });
});

describe("REQ-CPD-083: the recently used block", () => {
  it("REQ-CPD-083: what was previewed or brought over shows up, newest first", () => {
    const recent = recordRecentEntry(
      recordRecentEntry([], FIREBALL, "preview", 1_000),
      GOBLIN,
      "import",
      2_000,
    );

    const markup = drawMarks([], recent);

    expect(markup).toContain(t("FUSION.Compendium.Marks.Recent"));
    expect(markup.indexOf("Goblin Guerreiro")).toBeLessThan(markup.indexOf("Bola de Fogo"));
  });

  it("REQ-CPD-083: the block stays short — the fixed ceiling is what is drawn", () => {
    let recent: readonly CompendiumRecentEntry[] = [];
    for (let index = 0; index < COMPENDIUM_RECENT_LIMIT + 6; index += 1) {
      recent = recordRecentEntry(
        recent,
        { ...FIREBALL, uuid: `uuid-${index}`, name: `Entrada ${index}` },
        "preview",
        1_000 + index,
      );
    }

    const markup = drawMarks([], recent);
    const rows = markup.match(/compendium-marks__row/g) ?? [];

    expect(rows).toHaveLength(COMPENDIUM_RECENT_LIMIT);
    expect(markup).not.toContain("Entrada 0<");
  });
});

describe("REQ-CPD-082: the pin gesture on a result line", () => {
  const ENTRY: PackIndexEntry = {
    _id: "fireball",
    uuid: FIREBALL.uuid,
    name: "Fireball",
    img: null,
    type: "spell",
    index: {},
  } as PackIndexEntry;

  function drawLine(pinned: boolean): string {
    const line = buildResultLine(ENTRY, {
      documentType: "Item",
      packId: FIREBALL.packId,
      locale: "pt-BR",
      viewerIsPrivileged: false,
    });
    return render(CompendiumResultLine, {
      // Unprivileged reader: whatever he could bring lands on a sheet, never on
      // the world (REQ-CPD-061).
      props: { line, onTogglePin: () => {}, pinned, importDestination: "sheet" },
    }).body;
  }

  it("REQ-CPD-082: the line offers pin and unpin as one two-state button", () => {
    expect(drawLine(false)).toContain('aria-pressed="false"');
    expect(drawLine(false)).toContain(t("FUSION.Compendium.Line.Pin", { name: "Fireball" }));

    expect(drawLine(true)).toContain('aria-pressed="true"');
    expect(drawLine(true)).toContain(t("FUSION.Compendium.Line.Unpin", { name: "Fireball" }));
  });

  it("REQ-CPD-094: the pinned state is not told by colour alone", () => {
    // Three channels: the pressed state, the label, and the filled glyph.
    const drawn = drawLine(true);

    expect(drawn).toContain('aria-pressed="true"');
    expect(drawn).toContain(t("FUSION.Compendium.Line.Unpin", { name: "Fireball" }));
    expect(drawn).toContain('fill="currentColor"');
  });

  it("REQ-CPD-082: a panel that offers no pinning draws no pin button", () => {
    const line = buildResultLine(ENTRY, {
      documentType: "Item",
      packId: FIREBALL.packId,
      locale: "pt-BR",
      viewerIsPrivileged: false,
    });

    const markup = render(CompendiumResultLine, {
      props: { line, importDestination: "sheet" },
    }).body;

    expect(markup).not.toContain("aria-pressed");
  });
});
