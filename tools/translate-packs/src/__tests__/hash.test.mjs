/**
 * hash.test.mjs — tests for sourceHash helpers (hash.mjs).
 *
 * Owner: implementer A (pipeline). Runs under `node --test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sha1, stableStringify, i18nSourceHash, mechanicsSourceHash } from "../hash.mjs";

test("sha1 is deterministic for the same input", () => {
  assert.equal(sha1("hello"), sha1("hello"));
  assert.notEqual(sha1("hello"), sha1("world"));
});

test("sha1 matches a known digest", () => {
  // sha1("hello") is a well-known test vector.
  assert.equal(sha1("hello"), "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
});

test("stableStringify sorts object keys regardless of insertion order", () => {
  const a = stableStringify({ b: 1, a: 2 });
  const b = stableStringify({ a: 2, b: 1 });
  assert.equal(a, b);
});

test("stableStringify sorts nested object keys and preserves array order", () => {
  const a = stableStringify({ z: [{ y: 1, x: 2 }], a: 1 });
  const b = stableStringify({ a: 1, z: [{ x: 2, y: 1 }] });
  assert.equal(a, b);
});

test("i18nSourceHash is deterministic and sensitive to both name and description", () => {
  const h1 = i18nSourceHash("Basic Concoction", "<p>You gain a feat.</p>");
  const h2 = i18nSourceHash("Basic Concoction", "<p>You gain a feat.</p>");
  assert.equal(h1, h2);

  const h3 = i18nSourceHash("Basic Concoction", "<p>Different text.</p>");
  assert.notEqual(h1, h3);

  const h4 = i18nSourceHash("Different Name", "<p>You gain a feat.</p>");
  assert.notEqual(h1, h4);
});

test("i18nSourceHash separator avoids boundary collisions between name/description", () => {
  // "AB" + "" must not hash the same as "A" + "B" if concatenation were naive.
  const h1 = i18nSourceHash("AB", "");
  const h2 = i18nSourceHash("A", "B");
  assert.notEqual(h1, h2);
});

test("i18nSourceHash tolerates undefined description", () => {
  assert.doesNotThrow(() => i18nSourceHash("Some Name", undefined));
});

test("mechanicsSourceHash is deterministic and ignores key order in system.rules/unconvertedRules", () => {
  const docA = {
    system: { rules: [{ kind: "grant-item", uuid: "x" }] },
    flags: { fusion: { unconvertedRules: [{ key: "ChoiceSet", flag: "f" }] } },
  };
  const docB = {
    system: { rules: [{ uuid: "x", kind: "grant-item" }] },
    flags: { fusion: { unconvertedRules: [{ flag: "f", key: "ChoiceSet" }] } },
  };
  assert.equal(mechanicsSourceHash(docA), mechanicsSourceHash(docB));
});

test("mechanicsSourceHash changes when rules content changes", () => {
  const docA = { system: { rules: [{ kind: "grant-item", uuid: "x" }] } };
  const docB = { system: { rules: [{ kind: "grant-item", uuid: "y" }] } };
  assert.notEqual(mechanicsSourceHash(docA), mechanicsSourceHash(docB));
});

test("mechanicsSourceHash tolerates missing system/flags", () => {
  assert.doesNotThrow(() => mechanicsSourceHash({}));
  assert.doesNotThrow(() => mechanicsSourceHash({ system: {} }));
});
