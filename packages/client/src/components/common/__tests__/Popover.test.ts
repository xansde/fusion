/**
 * Popover.test.ts — the generic popover (BAR-F1-03; spec 53 REQ-BAR-043, spec 11
 * REQ-UIF-008, spec 23 REQ-A11-005/-007).
 *
 * The client's Vitest has no DOM, so this checks the markup `svelte/server` renders and the
 * component's stylesheet. What closes a popover — Escape, a click outside, Tab stepping out —
 * and where the focus goes afterwards is `lib/ui/dismissableLayer.ts`, proven end to end against
 * a fake document in `dismissableLayer.test.ts`; this file proves the Popover is *wired to it*
 * and says the right things to assistive technology.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import Popover from "../Popover.svelte";
import {
  attributeOf,
  codeOf,
  elementWith,
  idsIn,
  openingTag,
  ruleBody,
  snippetOf,
  styleOf,
  templateElements,
  zToken,
} from "./floatingTestUtils.js";

function popover(open: boolean, label = "Escolha o custo"): string {
  return render(Popover, {
    props: {
      anchor: null,
      open,
      label,
      children: snippetOf('<button type="button" class="opt">1 ação</button>'),
    },
  }).body;
}

describe("showing and hiding (REQ-BAR-043)", () => {
  it("draws nothing while closed", () => {
    const body = popover(false);

    expect(body).not.toContain('role="dialog"');
    expect(body).not.toContain("1 ação");
  });

  it("draws the caller's content inside the popover while open", () => {
    const body = popover(true);

    expect(body).toContain('role="dialog"');
    expect(body).toContain("1 ação");
  });
});

describe("what assistive technology is told (REQ-A11-005)", () => {
  const tag = openingTag(popover(true, "Escolha o custo"), 'role="dialog"');

  it("is a non-modal dialog with an accessible name", () => {
    expect(tag).toContain('aria-modal="false"');
    expect(tag).toContain('aria-label="Escolha o custo"');
  });

  it("can take the focus itself, for a popover with nothing to tab to", () => {
    expect(tag).toContain('tabindex="-1"');
  });

  it("is marked as a floating layer, so a layer opened from inside it does not close it", () => {
    expect(tag).toContain("data-fusion-layer");
  });

  it("carries an id the trigger can reference with aria-controls", () => {
    const [id] = idsIn(popover(true));
    expect(id).toMatch(/^fusion-popover-\d+$/);
    expect(openingTag(popover(true), 'role="dialog"')).toMatch(/\sid="fusion-popover-\d+"/);
  });

  it("two popovers never share an id", () => {
    expect(idsIn(popover(true))[0]).not.toBe(idsIn(popover(true))[0]);
  });
});

describe("closing: the shared layer behaviour, not a second copy of it (REQ-BAR-043)", () => {
  // What each of these does is proven in dismissableLayer.test.ts (`popoverLayerOptions`,
  // `createDismissHandler`, `layerOwnsKey`) and triggerWiring.test.ts (`markPopoverTrigger`).
  // A component script cannot run without a DOM, but its template can be read: here is the
  // popover's root element and what it is wired to, as the Svelte compiler parses it.
  const elements = templateElements("Popover.svelte");
  const dialog = elementWith(elements, 'role="dialog"');

  it("the popover's layer is configured as a popover: trigger exempt, focus into it, Tab at the edges", () => {
    expect(attributeOf(dialog, "dismissableLayer", "UseDirective")).toBe(
      "use:dismissableLayer={popoverLayerOptions({ anchor, restoreFocus, onDismiss: dismiss })}",
    );
  });

  it("it is placed beside its trigger by the shared placement action, with the gap the design uses", () => {
    expect(attributeOf(dialog, "floatingLayer", "UseDirective")).toBe(
      "use:floatingLayer={{ anchor, placement, offset: 6 }}",
    );
  });

  it("it owns the keyboard: every key pressed inside goes to the handler that keeps it from the canvas", () => {
    // `keepLayerKeysFromApp` is proven in dismissableLayer.test.ts, polarity included.
    expect(attributeOf(dialog, "onkeydown")).toBe(
      "onkeydown={(event) => keepLayerKeysFromApp(event)}",
    );
  });

  it("closing goes through the shared handler, which writes the bound `open` and reports why", () => {
    const code = codeOf("Popover.svelte");

    expect(code).toMatch(
      /createDismissHandler\(\{\s*setOpen: \(value\) => \{\s*open = value;\s*\},\s*onclose: \(\) => onclose,\s*\}\)/,
    );
  });

  it("the trigger's aria goes through the shared marker, with the live open state and the popover's id", () => {
    expect(codeOf("Popover.svelte")).toMatch(
      /markPopoverTrigger\(element, \{ open, controls: popoverId \}\)/,
    );
  });

  it("reuses clickOutside.ts rather than listening for pointer-downs itself", () => {
    const layer = readFileSync(
      fileURLToPath(new URL("../../../lib/ui/dismissableLayer.ts", import.meta.url)),
      "utf8",
    );
    expect(layer).toMatch(/from "\.\/clickOutside\.js"/);
    expect(layer).not.toMatch(/addEventListener\(\s*"pointerdown"/);
    expect(codeOf("Popover.svelte")).not.toMatch(/addEventListener/);
  });
});

describe("the layer scale (REQ-UIF-008, spec 53 §2.7)", () => {
  const css = styleOf("Popover.svelte");
  const layer = ruleBody(css, ".fusion-popover {");

  it("takes its z-index from the tooltip token (§2.7: tooltip and popover share a layer)", () => {
    expect(layer).toContain("z-index: var(--fusion-z-tooltip)");
    expect(css).not.toMatch(/z-index:\s*\d/);
  });

  it("which is above the window host, so the popover clears every window", () => {
    expect(zToken("--fusion-z-tooltip")).toBeGreaterThan(zToken("--fusion-z-windows"));
  });

  it("is laid out for the placement code: fixed, shrink-wrapped, hidden until it is placed", () => {
    expect(layer).toContain("position: fixed");
    expect(layer).toContain("width: max-content");
    expect(layer).toContain("visibility: hidden");
  });

  it("looks like the prototype's popover: surface-alt, border, popover shadow", () => {
    expect(layer).toContain("background: var(--fusion-surface-alt)");
    expect(layer).toContain("border: 1px solid var(--fusion-border)");
    expect(layer).toContain("box-shadow: var(--fusion-shadow-popover)");
  });

  it("shows a keyboard focus ring on itself and not a browser default one only", () => {
    expect(css).toMatch(/\.fusion-popover:focus-visible/);
  });
});

describe("it is generic (REQ-BAR-043)", () => {
  it("does not know the action bar", () => {
    expect(codeOf("Popover.svelte")).not.toMatch(/actionbar/i);
  });
});
