/**
 * ChatMessage.nestedRollLayout.test.ts — a child roll line stays readable in a narrow chat (L2 round 2, D7).
 *
 * The line of a roll nested in a card carries the label ("Mangual de Guerra (MAP 0)"), the calculation ("[17] + 9 + 4")
 * and the degree/total. In a narrow sidebar the label used to be clipped by an ellipsis and the calculation hidden next
 * to it, so the player could read neither. The contract: nothing on that line is clipped — the label wraps onto as many
 * lines as it needs, and the calculation and total keep their own row below it.
 *
 * The client project runs Vitest in node with no layout engine, so the contract is asserted on the component's own CSS.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../ChatMessage.svelte", import.meta.url)),
  "utf-8",
);

/** The declarations of the (single) CSS rule with this exact selector. */
function rule(selector: string): string {
  const style = source.slice(source.indexOf("<style"));
  const start = style.indexOf(`\n  ${selector} {`);
  if (start < 0) throw new Error(`rule ${selector} not found`);
  return style.slice(start, style.indexOf("}", start));
}

describe("nested roll line", () => {
  it("the line wraps instead of squeezing its parts onto one row", () => {
    expect(rule(".nested-roll")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("the label is never clipped: it wraps, with no ellipsis and no nowrap", () => {
    const label = rule(".nested-roll__label");
    expect(label).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(label).not.toMatch(/white-space:\s*nowrap/);
    expect(label).not.toMatch(/overflow:\s*hidden/);
  });

  it("the calculation is never clipped either", () => {
    const breakdown = rule(".nested-roll__breakdown");
    expect(breakdown).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(breakdown).not.toMatch(/white-space:\s*nowrap/);
    expect(breakdown).not.toMatch(/overflow:\s*hidden/);
  });
});
