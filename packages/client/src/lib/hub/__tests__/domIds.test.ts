/**
 * domIds.test.ts — unique ids for `aria-labelledby`, without `crypto`.
 *
 * This exists because of a real failure: `SystemWindow` used
 * `crypto.randomUUID()`, which is only defined in a **secure context**. Over
 * HTTPS or localhost it works; served to the table at `http://192.168.x.x`, it
 * is `undefined` and the panel throws the moment it opens.
 *
 * A counter has no such dependency, and an id only has to be unique within one
 * document — never across reloads.
 */

import { describe, it, expect } from "vitest";
import { nextDomId } from "../domIds.js";

describe("nextDomId", () => {
  it("never repeats an id", () => {
    const ids = Array.from({ length: 500 }, () => nextDomId("panel"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the caller's prefix", () => {
    expect(nextDomId("fusion-sw-title")).toMatch(/^fusion-sw-title-\d+$/);
  });

  it("does not collide across different prefixes", () => {
    const a = nextDomId("alpha");
    const b = nextDomId("beta");
    expect(a).not.toBe(b);
  });

  it("produces a valid HTML id — starts with a letter, no spaces", () => {
    // `aria-labelledby` resolves via `getElementById`; an id starting with a
    // digit is legal in HTML5 but breaks any CSS selector written against it.
    const id = nextDomId("panel");
    expect(id).toMatch(/^[A-Za-z][\w-]*$/);
  });

  it("does not depend on crypto being available", () => {
    // The whole point. If this module ever reaches for `crypto` again, this
    // test fails in `environment: "node"` under the same conditions the
    // browser would fail in an insecure context.
    const original = globalThis.crypto;
    try {
      // @ts-expect-error — deliberately removing a global for the duration
      delete globalThis.crypto;
      expect(() => nextDomId("panel")).not.toThrow();
    } finally {
      globalThis.crypto = original;
    }
  });
});
