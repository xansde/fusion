/**
 * Tooltip.test.ts — the generic tooltip (BAR-F1-03; spec 53 REQ-BAR-043/044, spec 11
 * REQ-UIF-008, spec 23 REQ-A11-005).
 *
 * The client project runs Vitest in a node environment — no jsdom, no testing-library — so
 * this looks at what is observable without a browser: the markup `svelte/server` renders, the
 * component's own stylesheet, the z-index scale in `base.css`, and the template as the Svelte
 * compiler parses it. How a tooltip *behaves* is proven where that logic lives: the timing
 * (opening after a delay, staying open while hovered) in `lib/ui/hoverIntent.ts`, and which DOM
 * events reach it, whose Escape it is and what the trigger's aria says in
 * `lib/ui/triggerWiring.ts`. This file proves the component is WIRED to them.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import Tooltip from "../Tooltip.svelte";
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

function tooltip(props: {
  open?: boolean;
  text?: string;
  disabled?: boolean;
  expanded?: boolean;
  id?: string;
  withContent?: boolean;
  withExpanded?: boolean;
}): string {
  return render(Tooltip, {
    props: {
      anchor: null,
      open: props.open ?? true,
      ...(props.text === undefined ? {} : { text: props.text }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.expanded === undefined ? {} : { expanded: props.expanded }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.withContent
        ? { content: snippetOf('<span class="short">Golpe de Espada</span>') }
        : {}),
      ...(props.withExpanded
        ? { expandedContent: snippetOf('<span class="full">Descrição completa</span>') }
        : {}),
    },
  }).body;
}

describe("showing and hiding (REQ-BAR-043)", () => {
  it("draws nothing while closed", () => {
    const body = tooltip({ open: false, text: "Golpe de Espada" });

    expect(body).not.toContain('role="tooltip"');
    expect(body).not.toContain("Golpe de Espada");
  });

  it("draws the text in a role=tooltip element while open", () => {
    const body = tooltip({ text: "Golpe de Espada" });

    expect(body).toContain('role="tooltip"');
    expect(body).toContain("Golpe de Espada");
  });

  it("has an id the trigger can point at with aria-describedby", () => {
    const body = tooltip({ text: "Golpe de Espada" });
    const [id] = idsIn(body);

    expect(id).toMatch(/^fusion-tooltip-\d+$/);
    // The id sits on the very element that carries the role.
    expect(openingTag(body, 'role="tooltip"')).toContain(`id="${id ?? ""}"`);
  });

  it("two tooltips never share an id", () => {
    const a = idsIn(tooltip({ text: "a" }))[0];
    const b = idsIn(tooltip({ text: "b" }))[0];

    expect(a).not.toBe(b);
  });

  it("uses the id the caller asked for", () => {
    const body = tooltip({ text: "x", id: "my-tooltip" });

    expect(body).toContain('id="my-tooltip"');
  });

  it("is the drawn tooltip, never the native title attribute", () => {
    expect(tooltip({ text: "x" })).not.toMatch(/\stitle=/);
    expect(codeOf("Tooltip.svelte")).not.toMatch(/\stitle=/);
  });

  it("draws nothing when it is disabled, even if told to be open", () => {
    expect(tooltip({ text: "x", disabled: true })).not.toContain('role="tooltip"');
  });

  it("draws nothing when there is nothing to say", () => {
    expect(tooltip({})).not.toContain('role="tooltip"');
    expect(tooltip({ text: "" })).not.toContain('role="tooltip"');
  });
});

describe("two levels: short, and expanded when the caller says so (REQ-BAR-044)", () => {
  it("shows the short content by default, and says it is the short level", () => {
    const body = tooltip({ withContent: true, withExpanded: true });

    expect(body).toContain("Golpe de Espada");
    expect(body).not.toContain("Descrição completa");
    expect(body).toContain('data-level="short"');
  });

  it("REQ-BAR-020: shows the expanded content instead of the short one when `expanded` is on — where a system's detail panel goes", () => {
    const body = tooltip({ withContent: true, withExpanded: true, expanded: true });

    expect(body).toContain("Descrição completa");
    expect(body).not.toContain("Golpe de Espada");
    expect(body).toContain('data-level="expanded"');
  });

  it("stays short when `expanded` is on but the caller gave no expanded content", () => {
    const body = tooltip({ withContent: true, expanded: true });

    expect(body).toContain("Golpe de Espada");
    expect(body).toContain('data-level="short"');
  });

  it("content given as a snippet wins over the plain text", () => {
    const body = tooltip({ text: "texto simples", withContent: true });

    expect(body).toContain("Golpe de Espada");
    expect(body).not.toContain("texto simples");
  });

  it("does not decide when to expand: it has no key handling of its own for it", () => {
    // The caller owns the trigger — the action bar will use Alt — so the component must not
    // listen for Alt (or any other key) to flip levels itself.
    expect(codeOf("Tooltip.svelte")).not.toMatch(/["']Alt["']|altKey/);
  });
});

describe("the layer scale (REQ-UIF-008, spec 53 §2.7)", () => {
  const css = styleOf("Tooltip.svelte");
  const layer = ruleBody(css, ".fusion-tooltip {");

  it("takes its z-index from the token, never from a number of its own", () => {
    expect(layer).toContain("z-index: var(--fusion-z-tooltip)");
    expect(css).not.toMatch(/z-index:\s*\d/);
  });

  it("the token is declared above the window host (200), so a tooltip clears every window", () => {
    expect(zToken("--fusion-z-tooltip")).toBeGreaterThan(zToken("--fusion-z-windows"));
    expect(zToken("--fusion-z-windows")).toBe(200);
  });

  it("is laid out for the placement code: fixed, shrink-wrapped, hidden until it is placed", () => {
    expect(layer).toContain("position: fixed");
    // A box that shrinks to the room beside it would change size as it moves.
    expect(layer).toContain("width: max-content");
    expect(layer).toContain("visibility: hidden");
  });

  it("uses the shell's tokens for colour, border and shadow (the ConditionChip tooltip's look)", () => {
    expect(layer).toContain("background: var(--fusion-surface-alt)");
    expect(layer).toContain("border: 1px solid var(--fusion-border)");
    expect(layer).toContain("box-shadow: var(--fusion-shadow-modal)");
  });
});

describe("it is generic (REQ-BAR-043)", () => {
  it("does not know the action bar", () => {
    // Imports and code, not the prose of the comments, which may name the bar for context.
    expect(codeOf("Tooltip.svelte")).not.toMatch(/actionbar/i);
  });
});

describe("the tooltip is wired to its timing machine and to its trigger (WCAG 1.4.13)", () => {
  // What each wire DOES is proven in hoverIntent.test.ts (the timing) and triggerWiring.test.ts
  // (the events, Escape, the trigger's aria). A component script cannot run without a DOM, but
  // its template and its calls can be read: each check below fails if the wire is cut, which a
  // search for a word in the source would not notice (the import line alone would satisfy it).
  const tip = elementWith(templateElements("Tooltip.svelte"), 'role="tooltip"');
  const code = codeOf("Tooltip.svelte");

  it("it is hoverable: the pointer on the tooltip itself keeps it open", () => {
    expect(attributeOf(tip, "onpointerenter")).toBe("onpointerenter={() => intent.layerIn()}");
    expect(attributeOf(tip, "onpointerleave")).toBe("onpointerleave={() => intent.layerOut()}");
  });

  it("it is placed beside its trigger by the shared placement action, with the gap the design uses", () => {
    expect(attributeOf(tip, "floatingLayer", "UseDirective")).toBe(
      "use:floatingLayer={{ anchor, placement, offset }}",
    );
  });

  it("the gap defaults to the design's 6 px, and a caller can raise it (BAR-F1-04: above the whole bar)", () => {
    expect(code).toMatch(/offset\?: number \| undefined;/);
    expect(code).toMatch(/offset = 6,/);
  });

  it("the trigger's hover, focus and press feed the timing machine, while the tooltip is enabled", () => {
    expect(code).toMatch(
      /if \(element === null \|\| disabled\) return;\s*return bindTooltipTrigger\(element, intent\);/,
    );
  });

  it("Escape is wired only while the tooltip shows, and to the same timing machine", () => {
    expect(code).toMatch(
      /if \(!visible\) return;\s*return bindTooltipEscape\(\s*document,\s*intent,\s*\(\) => anchor,/,
    );
  });

  it("BAR-F1-04: a caller's consumeEscape is asked live, and its absence means 'let the key go on'", () => {
    expect(code).toMatch(/consumeEscape\?: \(\(event: KeyboardEvent\) => boolean\) \| undefined;/);
    // Read when the key arrives, so a changed callback is the one that runs; `=== true`, so a
    // missing callback (undefined) is a no.
    expect(code).toMatch(/\(event\) => consumeEscape\?\.\(event\) === true/);
  });

  it("while it shows, it describes its trigger", () => {
    expect(code).toMatch(
      /if \(element === null \|\| !visible\) return;\s*return describeTrigger\(element, tipId\);/,
    );
  });

  it("an owner that sets `open` from outside is heard by the timing machine, and a change from inside is reported", () => {
    expect(code).toMatch(/intent\.sync\(open\)/);
    expect(code).toMatch(/onChange: \(value\) => \{\s*open = value;/);
  });

  it("the delays are read live, so a changed prop takes effect", () => {
    expect(code).toMatch(/openDelay: \(\) => openDelay/);
    expect(code).toMatch(/closeDelay: \(\) => closeDelay/);
  });
});
