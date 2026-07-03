/**
 * Regression guard for the M6 UX bug: the /setup wizard rendered raw
 * translation keys ("FUSION.Setup.Title", "FUSION.Setup.Nav.Next", ...)
 * instead of pt-BR text.
 *
 * Root cause: SetupWizard.svelte (like most components) imports `t` from
 * the bare resolver module `lib/i18n/i18n.js`, whose exported `i18n`
 * singleton starts with EMPTY bundles — pt-BR/en are only registered as a
 * side effect of importing the barrel `lib/i18n/index.js` (see that file's
 * doc comment). Nothing on the /setup entry path (main.ts mounts
 * SetupWizard.svelte standalone, completely separate from App.svelte's
 * tree — see main.ts's routing doc comment) ever imported the barrel, so
 * the shared singleton was never populated and every t() call fell through
 * to its last-resort behaviour: returning the raw key unchanged.
 *
 * Fix: main.ts now imports the barrel (`./lib/i18n/index.js`) once, purely
 * for its registerBundle() side effect, before mounting either entry point.
 *
 * This test reproduces the bug directly rather than asserting on the fix's
 * mechanism: it imports ONLY the bare resolver module (the same path
 * SetupWizard.svelte uses) — mirroring a world where main.ts's barrel
 * import did not run — and would fail loudly if bundles were empty. It then
 * imports the barrel (simulating main.ts having run) and asserts every
 * translation key actually used in SetupWizard.svelte resolves to real
 * pt-BR text, never the raw "FUSION...." key, for both supported locales.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { FusionI18n } from "../../../lib/i18n/i18n.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WIZARD_SOURCE_PATH = resolve(__dirname, "..", "SetupWizard.svelte");

/** Every t("FUSION....") call site in SetupWizard.svelte, as literally used. */
function extractUsedKeys(source: string): string[] {
  const keys = new Set<string>();
  const re = /\bt\(\s*"([A-Za-z0-9_.]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const key = match[1];
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

describe("SetupWizard.svelte — i18n bundle must be populated before render", () => {
  const wizardSource = readFileSync(WIZARD_SOURCE_PATH, "utf8");
  const usedKeys = extractUsedKeys(wizardSource);

  it("sanity: extracted a non-trivial number of translation keys from the component source", () => {
    // Guards the extraction regex itself against silently matching nothing
    // if SetupWizard.svelte is ever rewritten to not use t() literals.
    expect(usedKeys.length).toBeGreaterThan(20);
    expect(usedKeys.every((k) => k.startsWith("FUSION.Setup"))).toBe(true);
  });

  it("main.ts imports the i18n barrel (registerBundle side effect) before mounting", () => {
    const mainSource = readFileSync(
      resolve(dirname(WIZARD_SOURCE_PATH), "..", "..", "main.ts"),
      "utf8",
    );
    expect(mainSource).toMatch(/import\s+["']\.\/lib\/i18n\/index\.js["']/);
  });

  describe("once the barrel has been imported (real /setup bootstrap path)", () => {
    let i18n: FusionI18n;

    beforeAll(async () => {
      // Mirrors main.ts: import the barrel for its registerBundle() side
      // effect, then grab the SAME shared singleton SetupWizard.svelte's
      // `import { t } from "../../lib/i18n/i18n.js"` resolves to.
      await import("../../../lib/i18n/index.js");
      ({ i18n } = await import("../../../lib/i18n/i18n.js"));
    });

    it("resolves every SetupWizard key to real text in pt-BR (never the raw key)", () => {
      i18n.setLocale("pt-BR");
      const unresolved = usedKeys.filter((key) => i18n.t(key) === key);
      expect(
        unresolved,
        `SetupWizard keys rendered as raw keys in pt-BR (i18n bundle not loaded): ${unresolved.join(", ")}`,
      ).toHaveLength(0);
    });

    it("resolves every SetupWizard key to real text in en (never the raw key)", () => {
      i18n.setLocale("en");
      const unresolved = usedKeys.filter((key) => i18n.t(key) === key);
      expect(
        unresolved,
        `SetupWizard keys rendered as raw keys in en (i18n bundle not loaded): ${unresolved.join(", ")}`,
      ).toHaveLength(0);
    });

    it("no resolved pt-BR string itself starts with the 'FUSION.' key prefix (catches partial/garbled resolution)", () => {
      i18n.setLocale("pt-BR");
      const leaked = usedKeys
        .map((key) => ({ key, value: i18n.t(key) }))
        .filter(({ value }) => value.startsWith("FUSION."));
      expect(
        leaked,
        `Raw-looking values leaked into rendered text: ${JSON.stringify(leaked)}`,
      ).toHaveLength(0);
    });
  });
});
