/**
 * ContextMenu.test.ts — the generic context menu (BAR-F1-03; spec 53 REQ-BAR-043/045, spec 11
 * REQ-UIF-008, spec 23 REQ-A11-005/-036).
 *
 * The client's Vitest has no DOM, so this checks the markup `svelte/server` renders — the
 * roles and aria attributes a screen reader gets — the component's stylesheet, the legibility of
 * what it draws, and the template as the Svelte compiler parses it. What the menu DOES is proven
 * where that logic lives: the keyboard order in `menu.test.ts`, choosing / hovering / pressing a
 * disabled item in `menuController.test.ts`, and how the layer opens, closes and returns the
 * focus in `dismissableLayer.test.ts`. This file proves the component is WIRED to them.
 *
 * The fixture is the menu the action bar's slot will show (spec 53 REQ-BAR-045): variants with
 * their MAP, pin to favourites (disabled when the 12 slots are full), details, open the sheet.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ContextMenu from "../ContextMenu.svelte";
import type { MenuEntry } from "../../../lib/ui/menu.js";
import {
  attributeOf,
  codeOf,
  contrastRatio,
  cssVariable,
  elementWith,
  idsIn,
  openingTag,
  over,
  parseColor,
  ruleBody,
  styleOf,
  templateElements,
  textOfId,
  zToken,
} from "./floatingTestUtils.js";

const ENTRIES: MenuEntry[] = [
  {
    kind: "group",
    label: "Variantes",
    items: [
      { id: "map:0", label: "1º ataque", detail: "+12" },
      { id: "map:1", label: "2º ataque", detail: "+7", hint: "depois deste: MAP −10" },
      {
        id: "map:2",
        label: "3º ataque",
        detail: "+2",
        disabled: true,
        reason: "Faça o 2º ataque antes",
      },
    ],
  },
  { kind: "separator" },
  { id: "pin", label: "Fixar nos favoritos", disabled: true, reason: "Os 12 slots estão em uso" },
  { id: "details", label: "Ver detalhes", detail: "Alt" },
  { id: "sheet", label: "Abrir na ficha" },
];

function menu(props: {
  open?: boolean;
  label?: string;
  showLabel?: boolean;
  openedBy?: "keyboard" | "pointer";
  items?: MenuEntry[];
}): string {
  return render(ContextMenu, {
    props: {
      open: props.open ?? true,
      items: props.items ?? ENTRIES,
      label: props.label ?? "Golpe de Espada",
      point: { x: 300, y: 200 },
      ...(props.showLabel === undefined ? {} : { showLabel: props.showLabel }),
      ...(props.openedBy === undefined ? {} : { openedBy: props.openedBy }),
    },
  }).body;
}

/** The opening `<button …>` tag of the item with this id. */
function itemTag(body: string, itemId: string): string {
  return openingTag(body, `data-item-id="${itemId}"`);
}

describe("showing and hiding (REQ-BAR-043)", () => {
  it("draws nothing while closed", () => {
    const body = menu({ open: false });

    expect(body).not.toContain('role="menu"');
    expect(body).not.toContain("Ver detalhes");
  });

  it("draws a role=menu with an accessible name and room for the focus while open", () => {
    const tag = openingTag(menu({}), 'role="menu"');

    expect(tag).toContain('aria-label="Golpe de Espada"');
    expect(tag).toContain('tabindex="-1"');
    // A click inside a menu opened from a popover must not count as outside that popover.
    expect(tag).toContain("data-fusion-layer");
  });

  it("carries a unique id", () => {
    const a = idsIn(menu({}))[0];
    const b = idsIn(menu({}))[0];

    expect(a).toMatch(/^fusion-menu-\d+$/);
    expect(a).not.toBe(b);
  });

  it("can show its name as a visible title, without the screen reader reading it twice", () => {
    const withTitle = menu({ showLabel: true });
    expect(withTitle).toMatch(/fusion-menu__title[^>]*>Golpe de Espada</);
    expect(openingTag(withTitle, "fusion-menu__title")).toContain('aria-hidden="true"');

    expect(menu({ showLabel: false })).not.toContain("fusion-menu__title");
    expect(menu({})).not.toContain("fusion-menu__title");
  });
});

describe("items: roles and the keyboard (REQ-A11-005, REQ-A11-036)", () => {
  it("every item is a menuitem, and a native button, so Enter and Space activate it exactly once", () => {
    const body = menu({});

    // Three variants, pin, details, open the sheet.
    expect(body.match(/role="menuitem"/g)).toHaveLength(6);
    expect(body.match(/<button type="button"/g)).toHaveLength(6);
    // And the button is the menuitem, not a button nested in a menuitem.
    for (const id of ["map:0", "map:1", "map:2", "pin", "details", "sheet"]) {
      expect(itemTag(body, id)).toMatch(/^<button /);
      expect(itemTag(body, id)).toContain('role="menuitem"');
    }
  });

  it("draws the label and the trailing detail (a value, a shortcut)", () => {
    const body = menu({});

    expect(body).toMatch(/fusion-menu__label[^>]*>1º ataque</);
    expect(body).toMatch(/fusion-menu__detail[^>]*>\+12</);
    expect(body).toMatch(/fusion-menu__detail[^>]*>Alt</);
  });

  it("opened from the keyboard, the first enabled item is the one tab stop and is active", () => {
    const body = menu({ openedBy: "keyboard" });

    expect(itemTag(body, "map:0")).toContain('tabindex="0"');
    expect(itemTag(body, "map:0")).toContain("is-active");
    for (const id of ["map:1", "map:2", "pin", "details", "sheet"]) {
      expect(itemTag(body, id)).toContain('tabindex="-1"');
    }
  });

  it("opened by the pointer, no item is active yet: the menu itself holds the focus", () => {
    const body = menu({ openedBy: "pointer" });

    expect(body).not.toContain("is-active");
    expect(body).not.toContain('tabindex="0"');
  });

  it("skips a leading disabled item when picking the first one to activate", () => {
    const body = menu({
      openedBy: "keyboard",
      items: [
        { id: "off", label: "Desligado", disabled: true, reason: "Sem alvo" },
        { id: "on", label: "Ligado" },
      ],
    });

    expect(itemTag(body, "off")).toContain('tabindex="-1"');
    expect(itemTag(body, "on")).toContain('tabindex="0"');
  });
});

describe("grouping (REQ-BAR-045)", () => {
  it("a titled group is a role=group named by its heading", () => {
    const body = menu({});
    const group = openingTag(body, 'role="group"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(group)?.[1];

    expect(labelledBy).toBeDefined();
    expect(textOfId(body, labelledBy ?? "")).toBe("Variantes");
  });

  it("the heading is for the eye; the group already carries the name for the screen reader", () => {
    const body = menu({});
    expect(openingTag(body, "fusion-menu__heading")).toContain('aria-hidden="true"');
  });

  it("an untitled group is still a group, with no label to point at", () => {
    const body = menu({ items: [{ kind: "group", items: [{ id: "a", label: "A" }] }] });

    expect(openingTag(body, 'role="group"')).not.toContain("aria-labelledby");
    expect(body).not.toContain("fusion-menu__heading");
  });

  it("a separator is a role=separator", () => {
    expect(menu({})).toContain('role="separator"');
  });
});

describe("a disabled item says why (REQ-BAR-045)", () => {
  it("is aria-disabled but still a real, announced item — not a native disabled button", () => {
    const body = menu({});

    expect(itemTag(body, "map:2")).toContain('aria-disabled="true"');
    expect(itemTag(body, "pin")).toContain('aria-disabled="true"');
    expect(itemTag(body, "map:0")).not.toContain("aria-disabled");
    expect(body).not.toMatch(/\sdisabled(=|>|\s)/);
  });

  it("shows the reason under the label, and points aria-describedby at it", () => {
    const body = menu({});

    for (const [itemId, reason] of [
      ["map:2", "Faça o 2º ataque antes"],
      ["pin", "Os 12 slots estão em uso"],
    ] as const) {
      const describedBy = /aria-describedby="([^"]+)"/.exec(itemTag(body, itemId))?.[1];
      expect(describedBy).toBeDefined();
      expect(textOfId(body, describedBy ?? "")).toBe(reason);
    }
  });

  it("a hint on an enabled item is described the same way", () => {
    const body = menu({});
    const describedBy = /aria-describedby="([^"]+)"/.exec(itemTag(body, "map:1"))?.[1];

    expect(textOfId(body, describedBy ?? "")).toBe("depois deste: MAP −10");
  });

  it("an item with nothing to describe has no aria-describedby, so it does not point at nothing", () => {
    const body = menu({});

    expect(itemTag(body, "map:0")).not.toContain("aria-describedby");
    expect(itemTag(body, "sheet")).not.toContain("aria-describedby");
  });

  it("keeps the description out of the item's name: it is hidden from the name, referenced as a description", () => {
    const body = menu({});

    expect(openingTag(body, "fusion-menu__hint")).toContain('aria-hidden="true"');
  });

  it("the reason is still readable when the item is dimmed: dimmed text, not a see-through item", () => {
    const css = styleOf("ContextMenu.svelte");
    const dimmed = ruleBody(css, '.fusion-menu__item[aria-disabled="true"] {');

    expect(dimmed).not.toMatch(/opacity/);
    expect(dimmed).toContain("cursor: not-allowed");
  });
});

describe("the layer scale (REQ-UIF-008, spec 53 §2.7)", () => {
  const css = styleOf("ContextMenu.svelte");
  const layer = ruleBody(css, ".fusion-menu {");

  it("takes its z-index from the menu token, never from a number of its own", () => {
    expect(layer).toContain("z-index: var(--fusion-z-menu)");
    expect(css).not.toMatch(/z-index:\s*\d/);
  });

  it("the menu is above the tooltip, and the tooltip above the window host (200)", () => {
    expect(zToken("--fusion-z-menu")).toBeGreaterThan(zToken("--fusion-z-tooltip"));
    expect(zToken("--fusion-z-tooltip")).toBeGreaterThan(zToken("--fusion-z-windows"));
  });

  it("is laid out for the placement code: fixed, shrink-wrapped, hidden until it is placed", () => {
    expect(layer).toContain("position: fixed");
    expect(layer).toContain("width: max-content");
    expect(layer).toContain("visibility: hidden");
  });

  it("looks like the prototype's menu: surface-alt, border, modal shadow", () => {
    expect(layer).toContain("background: var(--fusion-surface-alt)");
    expect(layer).toContain("border: 1px solid var(--fusion-border)");
    expect(layer).toContain("box-shadow: var(--fusion-shadow-modal)");
  });

  it("keeps a visible focus ring on the item the keyboard is on", () => {
    expect(css).toMatch(/\.fusion-menu__item:focus-visible/);
  });
});

describe("legibility (WCAG AA 4.5:1 for small text, spec 23)", () => {
  // The menu's secondary text is 10.5–11 px. Colours come from the shell's tokens, so this
  // computes the contrast of what is actually drawn, state by state.
  const surface = parseColor(cssVariable("--fusion-surface-alt"));
  const activeWash = over(parseColor(cssVariable("--fusion-accent-dim")), surface);
  const muted = parseColor(cssVariable("--fusion-text-muted"));
  const text = parseColor(cssVariable("--fusion-text"));
  const css = styleOf("ContextMenu.svelte");

  it("the muted detail, hint and reason text on the menu's surface is legible", () => {
    expect(contrastRatio(muted, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("a disabled item's label, dimmed to the muted colour, is legible on the surface too", () => {
    const disabled = ruleBody(css, '.fusion-menu__item[aria-disabled="true"] {');

    expect(disabled).toContain("color: var(--fusion-text-muted)");
    expect(contrastRatio(muted, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("on the active row, whose wash is lighter than the surface, the secondary text takes the main text colour", () => {
    // Found in Edge: the muted colour on the active wash is only ~4.0:1, under the line.
    const rule = ruleBody(
      css,
      ".fusion-menu__item.is-active .fusion-menu__detail,\n  .fusion-menu__item.is-active .fusion-menu__hint {",
    );

    expect(rule).toContain("color: var(--fusion-text)");
    expect(contrastRatio(text, activeWash)).toBeGreaterThanOrEqual(4.5);
  });

  it("and the label, in the main text colour, is legible on the active row too", () => {
    expect(contrastRatio(text, activeWash)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("it is generic (REQ-BAR-043)", () => {
  it("does not know the action bar", () => {
    expect(codeOf("ContextMenu.svelte")).not.toMatch(/actionbar/i);
  });
});

describe("the template is wired to the controller and to the shared layer (REQ-BAR-043, REQ-A11-036)", () => {
  // What each handler DOES is proven in menuController.test.ts and dismissableLayer.test.ts. A
  // component script cannot run without a DOM, but its template can be read: here are the
  // menu's elements and what each is wired to, as the Svelte compiler parses them. Each check
  // below fails if the wire is cut — which a search for a word in the source would not notice.
  const elements = templateElements("ContextMenu.svelte");
  const menuElement = elementWith(elements, 'role="menu"');
  const itemElement = elementWith(elements, 'role="menuitem"');

  it("the menu keeps its keys: onkeydown goes to the controller, with the layer to focus in", () => {
    expect(attributeOf(menuElement, "onkeydown")).toBe(
      "onkeydown={(event) => menu.keydown(event, event.currentTarget)}",
    );
  });

  it("a right-click inside it goes to the controller, which keeps the browser's menu away", () => {
    expect(attributeOf(menuElement, "oncontextmenu")).toBe(
      "oncontextmenu={(event) => menu.contextMenu(event)}",
    );
  });

  it("it goes away through the shared layer, configured as a menu (trigger not exempt, Tab closes it)", () => {
    expect(attributeOf(menuElement, "dismissableLayer", "UseDirective")).toBe(
      "use:dismissableLayer={menuLayerOptions({ anchor, restoreFocus, onDismiss: menu.dismiss })}",
    );
  });

  it("it is placed at the pointer or beside the trigger by the shared placement action — flush with the pointer, a gap from a trigger", () => {
    expect(attributeOf(menuElement, "floatingLayer", "UseDirective")).toBe(
      "use:floatingLayer={{ anchor, point, placement, offset: point == null ? 4 : 0 }}",
    );
  });

  it("a click on an item chooses it", () => {
    expect(attributeOf(itemElement, "onclick")).toBe("onclick={() => menu.select(item)}");
  });

  it("hovering an item highlights it and moves the focus with it", () => {
    expect(attributeOf(itemElement, "onpointerenter")).toBe(
      "onpointerenter={(event) => menu.pointerEnter(event, entry)}",
    );
  });

  it("pressing a disabled item is kept from taking the focus", () => {
    expect(attributeOf(itemElement, "onmousedown")).toBe(
      "onmousedown={(event) => menu.pointerDown(event, entry)}",
    );
  });

  it("the highlight and the one tab stop both come from the controller's `active`", () => {
    expect(attributeOf(itemElement, "tabindex")).toBe(
      "tabindex={menu.active === entry.index ? 0 : -1}",
    );
    expect(attributeOf(itemElement, "is-active", "ClassDirective")).toBe(
      "class:is-active={menu.active === entry.index}",
    );
  });

  it("the controller is given the live props, so a changed trigger or callback is the one used", () => {
    const code = codeOf("ContextMenu.svelte");

    expect(code).toMatch(/setOpen: \(value\) => \{\s*open = value;\s*\}/);
    expect(code).toMatch(/focusTargets: \(\) => \[anchor\]/);
    expect(code).toMatch(/onselect: \(\) => onselect/);
    expect(code).toMatch(/onclose: \(\) => onclose/);
    expect(code).toMatch(/restoreFocus: \(\) => restoreFocus/);
  });

  it("every time it opens — and only then — the controller starts from the top and remembers where the focus was", () => {
    // `opened` does the work and is proven in menuController.test.ts; this pins WHEN it runs: in
    // the effect that guards on `open` (an inverted guard would run it on every close instead),
    // and with what had the focus. (The init's own `menu.reset()` is the first paint.)
    const code = codeOf("ContextMenu.svelte");

    expect(code).toMatch(
      /\$effect\.pre\(\(\) => \{\s*if \(!open\) return;\s*untrack\(\(\) =>\s*menu\.opened\(document\.activeElement instanceof HTMLElement \? document\.activeElement : null\),?\s*\);\s*\}\);/,
    );
  });

  it("a menu rendered already open has its highlight in the first paint", () => {
    expect(codeOf("ContextMenu.svelte")).toMatch(
      /untrack\(\(\) => \{\s*if \(open\) menu\.reset\(\);\s*\}\);/,
    );
  });
});
