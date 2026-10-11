/**
 * floatingTestUtils.ts — shared by the Tooltip, Popover and ContextMenu tests (BAR-F1-03).
 *
 * The client's Vitest has no DOM (docs/design/barra-de-acoes/tasks.md §2.10), so these tests
 * look at the places the components' contract is observable without a browser: the markup the
 * server renderer produces (`svelte/server`), the component's own stylesheet, and the template
 * as the Svelte compiler parses it (elements, attributes, directives). This file holds the
 * little readers they share — the first two are the ones `ConditionChip.test.ts` keeps inline.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRawSnippet } from "svelte";
import { parse } from "svelte/compiler";

/** Source of a file next to the components (`components/common/<file>`). */
export function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose is never mistaken for a declaration. */
export function codeOf(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The `<style>` block of a component, comments stripped. */
export function styleOf(file: string): string {
  const match = /<style>([\s\S]*)<\/style>/.exec(codeOf(file));
  if (!match?.[1]) throw new Error(`${file} has no <style> block`);
  return match[1];
}

/** Body of the first CSS rule whose selector list contains `selector`. */
export function ruleBody(css: string, selector: string): string {
  const index = css.indexOf(selector);
  if (index === -1) throw new Error(`no rule for "${selector}"`);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/** The shell's stylesheet, where the z-index tokens are declared. */
export function baseCss(): string {
  return readFileSync(fileURLToPath(new URL("../../../styles/base.css", import.meta.url)), "utf8");
}

/** The number a `--fusion-z-*` token is declared with in `base.css`. */
export function zToken(name: string): number {
  const match = new RegExp(`${name}:\\s*(\\d+)\\s*;`).exec(baseCss());
  if (!match?.[1]) throw new Error(`${name} is not declared in base.css`);
  return Number(match[1]);
}

/** A snippet that renders the given single-root HTML — the way a caller hands content in. */
export function snippetOf(html: string) {
  return createRawSnippet(() => ({ render: () => html }));
}

/** The `id`s found in a rendered body, in order. */
export function idsIn(body: string): string[] {
  return [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** The opening tag (`<div …>`) of the first element whose markup contains `marker`. */
export function openingTag(body: string, marker: string): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<[^<>]*${escaped}[^<>]*>`).exec(body);
  if (!match) throw new Error(`no element carries ${marker}`);
  return match[0];
}

/** Text of the element that carries `id`, up to its first child tag or closing tag. */
export function textOfId(body: string, id: string): string | null {
  const match = new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</`).exec(body);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// The template, as the Svelte compiler reads it
// ---------------------------------------------------------------------------
//
// Event handlers and `use:` actions are not in the server-rendered markup, and a component's
// script cannot run without a DOM. What CAN be checked is the template itself: parsed by the
// Svelte compiler, every element with every attribute and directive exactly as written. That
// is a far tighter proof of wiring than searching the source for a word — a word is satisfied
// by the `import` line alone.

export interface TemplateAttribute {
  /** `Attribute` (including `onclick`…), `UseDirective`, `ClassDirective`, `SpreadAttribute`… */
  type: string;
  name: string;
  /** The attribute as written, whitespace collapsed: `onclick={() => menu.select(item)}`. */
  text: string;
}

export interface TemplateElement {
  name: string;
  attributes: TemplateAttribute[];
}

/** Every element of a component's markup (not its script or style), in document order. */
export function templateElements(file: string): TemplateElement[] {
  const text = source(file);
  const root = parse(text, { modern: true });
  const found: TemplateElement[] = [];

  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record["type"] === "RegularElement") {
      const attributes = (
        record["attributes"] as Array<{ type: string; name?: string; start: number; end: number }>
      ).map((attribute) => ({
        type: attribute.type,
        name: attribute.name ?? "",
        text: text.slice(attribute.start, attribute.end).replace(/\s+/g, " "),
      }));
      found.push({ name: String(record["name"]), attributes });
    }
    for (const [key, value] of Object.entries(record)) {
      if (key !== "metadata" && key !== "parent") visit(value);
    }
  };
  visit(root.fragment);
  return found;
}

/**
 * The attribute (or directive) of an element by name, as written; undefined when absent. Pass the
 * node type to tell `use:floatingLayer` (`"UseDirective"`) from an attribute of the same name.
 */
export function attributeOf(
  element: TemplateElement,
  name: string,
  type?: "Attribute" | "UseDirective" | "ClassDirective",
): string | undefined {
  return element.attributes.find(
    (attribute) => attribute.name === name && (type === undefined || attribute.type === type),
  )?.text;
}

/** The first element carrying an attribute written exactly as `written`, e.g. `role="menu"`. */
export function elementWith(elements: TemplateElement[], written: string): TemplateElement {
  const element = elements.find((candidate) =>
    candidate.attributes.some((attribute) => attribute.text === written),
  );
  if (!element) throw new Error(`no element in the template carries ${written}`);
  return element;
}

// ---------------------------------------------------------------------------
// Colour, for the legibility checks
// ---------------------------------------------------------------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The value a `--fusion-*` custom property is declared with in `base.css`. */
export function cssVariable(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(baseCss());
  if (!match?.[1]) throw new Error(`${name} is not declared in base.css`);
  return match[1].trim();
}

/** `#rgb`, `#rrggbb` or `rgba(r, g, b, a)`. */
export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4] ?? 1) };
  }
  throw new Error(`cannot read the colour "${value}"`);
}

/** `top` painted over `bottom` (alpha compositing). */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number): number => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio between two opaque colours. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
