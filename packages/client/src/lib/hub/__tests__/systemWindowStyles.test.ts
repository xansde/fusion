/**
 * systemWindowStyles.test.ts — invariants of the System Window stylesheet.
 *
 * `layers.test.ts` mirrors the layer scale in TypeScript and asserts the
 * mirror. This file takes the other road: it reads `system-window.css` itself,
 * because the properties that matter here are properties *of the stylesheet*
 * and a hand-kept mirror would just be a second thing to forget to update.
 *
 * Three rules, each with a failure it has already prevented elsewhere in this
 * client: an orphan `var()` (silently renders as nothing), a literal z-index
 * (REQ-UIF-008 — the reason the Hub can't accidentally cover a modal), and a
 * palette token that shadows the shell's own.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const styleDir = new URL("../../../styles/", import.meta.url);
const systemWindowCss = readFileSync(fileURLToPath(new URL("system-window.css", styleDir)), "utf8");
const baseCss = readFileSync(fileURLToPath(new URL("base.css", styleDir)), "utf8");

/** Custom properties a stylesheet declares, e.g. `--fusion-sw-blue: #57c8ff`. */
function declaredTokens(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/^\s*(--[\w-]+)\s*:/gm), (m) => m[1]!));
}

/** Custom properties a stylesheet reads, e.g. `var(--fusion-sw-blue)`. */
function referencedTokens(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/var\(\s*(--[\w-]+)/g), (m) => m[1]!));
}

describe("the System Window stylesheet", () => {
  it("declares every one of its own tokens that it reads", () => {
    // An undeclared custom property is not an error in CSS — the declaration
    // is simply dropped and the element renders unstyled. That is a typo
    // failing silently, so it gets a test instead.
    const declared = declaredTokens(systemWindowCss);
    const orphans = [...referencedTokens(systemWindowCss)]
      .filter((token) => token.startsWith("--fusion-sw-"))
      .filter((token) => !declared.has(token));
    expect(orphans).toEqual([]);
  });

  it("resolves its non-`sw` references against base.css", () => {
    // The System Window is allowed to build on the shell scale (the z-index
    // bands, notably) but not to invent a token that lives nowhere.
    const known = new Set([...declaredTokens(baseCss), ...declaredTokens(systemWindowCss)]);
    const unknown = [...referencedTokens(systemWindowCss)].filter((token) => !known.has(token));
    expect(unknown).toEqual([]);
  });

  it("never writes a literal z-index", () => {
    // REQ-UIF-008: the layer scale is the single place stacking is decided.
    // A literal here is how the Hub ends up painted over a modal it cannot
    // close — the bug the band system exists to make impossible.
    const literals = Array.from(systemWindowCss.matchAll(/z-index\s*:\s*([^;]+);/g), (m) =>
      m[1]!.trim(),
    ).filter((value) => !value.startsWith("var(--fusion-z-"));
    expect(literals).toEqual([]);
  });

  it("keeps its palette in its own namespace", () => {
    // The System Window is cyan-on-black; the rest of the shell is violet on
    // dark grey. Redefining a shell token at `:root` would repaint the whole
    // application the moment this file is imported — including screens that
    // have nothing to do with the Hub.
    const shellTokens = declaredTokens(baseCss);
    const collisions = [...declaredTokens(systemWindowCss)].filter((token) =>
      shellTokens.has(token),
    );
    expect(collisions).toEqual([]);
  });

  it("prefixes every token it declares with --fusion-sw-", () => {
    const strays = [...declaredTokens(systemWindowCss)].filter(
      (token) => !token.startsWith("--fusion-sw-"),
    );
    expect(strays).toEqual([]);
  });
});
