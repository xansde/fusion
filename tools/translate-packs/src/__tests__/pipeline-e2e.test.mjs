/**
 * pipeline-e2e.test.mjs — end-to-end test of the 4-stage CLI pipeline
 * (extract -> grants-from-rules -> apply -> qa) against an isolated fixture
 * pack (fixtures/mini-packs-root/mini-pack), run via subprocess so each
 * script's own `main()` executes exactly like a real invocation, without
 * ever touching the real systems/pf2e/packs/ tree.
 *
 * Every script accepts `--packs-root <path>` precisely so this suite can
 * point the CLI at an isolated fixture instead of the real monorepo (see
 * pack-io.mjs's resolveSystemPacksDir, which is only used as the DEFAULT
 * when --packs-root is omitted).
 *
 * Everything reads/writes under a fresh os.tmpdir() copy of the fixture
 * pack root — safe to run repeatedly and in parallel with other test files.
 *
 * Owner: implementer A (pipeline). Runs under `node --test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..");
const FIXTURE_PACKS_ROOT = join(__dirname, "fixtures", "mini-packs-root");

/** Runs a pipeline CLI script as a subprocess, always pinning it to `packsRoot` via --packs-root. */
function runNodeScript(scriptRelPath, args, cwd, packsRoot) {
  return execFileSync(
    process.execPath,
    [join(SRC_DIR, scriptRelPath), ...args, "--packs-root", packsRoot],
    { cwd, encoding: "utf8" },
  );
}

function setupTmpPacksRoot() {
  const tmpRoot = mkdtempSync(join(tmpdir(), "translate-packs-e2e-"));
  const packsRoot = join(tmpRoot, "packs");
  cpSync(FIXTURE_PACKS_ROOT, packsRoot, { recursive: true });
  return { tmpRoot, packsRoot };
}

test("extract.mjs writes a chunk file for the fixture pack with both docs pending", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const outDir = join(tmpRoot, "out", "translate");
    runNodeScript("extract.mjs", ["--packs", "mini-pack", "--out", outDir], tmpRoot, packsRoot);

    const chunkPath = join(outDir, "mini-pack", "chunk-001.json");
    assert.ok(existsSync(chunkPath), "expected chunk-001.json to be written");
    const chunk = JSON.parse(readFileSync(chunkPath, "utf8"));
    assert.equal(chunk.pack, "mini-pack");
    assert.equal(chunk.docs.length, 2);
    const ids = chunk.docs.map((d) => d.id).sort();
    assert.deepEqual(ids, ["miniDoc0000001A", "miniDoc0000002B"]);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("grants-from-rules.mjs extracts a grant for Mini Grant Feat's ChoiceSet+grant-item pair", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const outDir = join(tmpRoot, "out", "mechanics");
    runNodeScript("grants-from-rules.mjs", ["--packs", "mini-pack", "--out", outDir], tmpRoot, packsRoot);

    const rulesPath = join(outDir, "mini-pack.rules.json");
    assert.ok(existsSync(rulesPath));
    const rules = JSON.parse(readFileSync(rulesPath, "utf8"));
    assert.equal(rules.packId, "pf2e.mini-pack");
    const entry = rules.entries["miniDoc0000002B"];
    assert.ok(entry, "expected a mechanics entry for Mini Grant Feat");
    assert.equal(entry.grants.length, 1);
    assert.equal(entry.grants[0].category, "general");
    assert.equal(entry.grants[0].filters.maxLevel, 1);
    assert.equal(entry.grants[0].confidence, 1.0);
    // Mini Fireball has no ChoiceSet -> no entry at all.
    assert.equal(rules.entries["miniDoc0000001A"], undefined);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("apply.mjs merges a translated-*.json batch into i18n.pt-BR.json and mechanics.rules.json into mechanics.json", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const translatedDir = join(tmpRoot, "out", "translate");
    const mechanicsDir = join(tmpRoot, "out", "mechanics");

    // Stage inputs by hand (simulating T2's translation output + stage 2's mechanics output).
    runNodeScript("grants-from-rules.mjs", ["--packs", "mini-pack", "--out", mechanicsDir], tmpRoot, packsRoot);

    mkdirSync(join(translatedDir, "mini-pack"), { recursive: true });
    writeFileSync(
      join(translatedDir, "mini-pack", "translated-001.json"),
      JSON.stringify({
        miniDoc0000001A: { name: "Mini Bola de Fogo", description: "<p>Você causa 6d6 de dano de fogo em uma explosão.</p>" },
      }),
    );

    runNodeScript(
      "apply.mjs",
      ["--packs", "mini-pack", "--translated-dir", translatedDir, "--mechanics-dir", mechanicsDir],
      tmpRoot,
      packsRoot,
    );

    const i18nPath = join(packsRoot, "mini-pack", "i18n.pt-BR.json");
    const mechanicsPath = join(packsRoot, "mini-pack", "mechanics.json");
    assert.ok(existsSync(i18nPath));
    assert.ok(existsSync(mechanicsPath));

    const i18n = JSON.parse(readFileSync(i18nPath, "utf8"));
    assert.equal(i18n.packId, "pf2e.mini-pack");
    assert.equal(i18n.locale, "pt-BR");
    assert.equal(i18n.entries.miniDoc0000001A.name, "Mini Bola de Fogo");

    const mechanics = JSON.parse(readFileSync(mechanicsPath, "utf8"));
    assert.equal(mechanics.entries.miniDoc0000002B.grants.length, 1);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("apply.mjs does not write an empty mechanics.json for a pack with no grants/unlocks and no prior overlay", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const mechanicsDir = join(tmpRoot, "out", "mechanics");
    runNodeScript(
      "grants-from-rules.mjs",
      ["--packs", "mini-pack-no-mechanics", "--out", mechanicsDir],
      tmpRoot,
      packsRoot,
    );
    runNodeScript(
      "apply.mjs",
      ["--packs", "mini-pack-no-mechanics", "--mechanics-dir", mechanicsDir],
      tmpRoot,
      packsRoot,
    );

    const mechanicsPath = join(packsRoot, "mini-pack-no-mechanics", "mechanics.json");
    assert.equal(existsSync(mechanicsPath), false, "no mechanics.json should be written when there's nothing to say");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("apply.mjs is re-runnable: running twice with the same inputs produces byte-identical overlays", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const translatedDir = join(tmpRoot, "out", "translate");
    const mechanicsDir = join(tmpRoot, "out", "mechanics");
    runNodeScript("grants-from-rules.mjs", ["--packs", "mini-pack", "--out", mechanicsDir], tmpRoot, packsRoot);

    mkdirSync(join(translatedDir, "mini-pack"), { recursive: true });
    writeFileSync(
      join(translatedDir, "mini-pack", "translated-001.json"),
      JSON.stringify({ miniDoc0000001A: { name: "Mini Bola de Fogo" } }),
    );

    runNodeScript(
      "apply.mjs",
      ["--packs", "mini-pack", "--translated-dir", translatedDir, "--mechanics-dir", mechanicsDir],
      tmpRoot,
      packsRoot,
    );
    const firstI18n = readFileSync(join(packsRoot, "mini-pack", "i18n.pt-BR.json"), "utf8");
    const firstMechanics = readFileSync(join(packsRoot, "mini-pack", "mechanics.json"), "utf8");

    runNodeScript(
      "apply.mjs",
      ["--packs", "mini-pack", "--translated-dir", translatedDir, "--mechanics-dir", mechanicsDir],
      tmpRoot,
      packsRoot,
    );
    const secondI18n = readFileSync(join(packsRoot, "mini-pack", "i18n.pt-BR.json"), "utf8");
    const secondMechanics = readFileSync(join(packsRoot, "mini-pack", "mechanics.json"), "utf8");

    // generatedAt differs run-to-run; strip it before comparing for stability.
    const stripGeneratedAt = (json) => json.replace(/"generatedAt": "[^"]*"/, '"generatedAt": "STRIPPED"');
    assert.equal(stripGeneratedAt(firstI18n), stripGeneratedAt(secondI18n));
    assert.equal(stripGeneratedAt(firstMechanics), stripGeneratedAt(secondMechanics));
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("extract.mjs skips a doc on the second run once its translation is applied (re-runnability)", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const translatedDir = join(tmpRoot, "out", "translate");

    // First extract: both docs pending.
    let output = runNodeScript("extract.mjs", ["--packs", "mini-pack", "--out", translatedDir], tmpRoot, packsRoot);
    assert.match(output, /2 docs, 0 already translated \(skipped\), 2 pending/);

    // Apply a translation for one doc.
    writeFileSync(
      join(translatedDir, "mini-pack", "translated-001.json"),
      JSON.stringify({ miniDoc0000001A: { name: "Mini Bola de Fogo", description: "<p>Você causa 6d6 de dano de fogo em uma explosão.</p>" } }),
    );
    runNodeScript("apply.mjs", ["--packs", "mini-pack", "--translated-dir", translatedDir], tmpRoot, packsRoot);

    // Second extract: the translated doc (same EN source, so same sourceHash) is now skipped.
    output = runNodeScript("extract.mjs", ["--packs", "mini-pack", "--out", translatedDir], tmpRoot, packsRoot);
    assert.match(output, /2 docs, 1 already translated \(skipped\), 1 pending/);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("qa.mjs reports a passing doc after a well-formed translation is applied", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const translatedDir = join(tmpRoot, "out", "translate");
    mkdirSync(join(translatedDir, "mini-pack"), { recursive: true });
    writeFileSync(
      join(translatedDir, "mini-pack", "translated-001.json"),
      JSON.stringify({
        miniDoc0000001A: {
          name: "Mini Bola de Fogo",
          description: "<p>Você causa 6d6 de dano de fogo em uma explosão.</p>",
        },
      }),
    );
    runNodeScript("apply.mjs", ["--packs", "mini-pack", "--translated-dir", translatedDir], tmpRoot, packsRoot);

    const qaOutPath = join(tmpRoot, "qa-report.json");
    let threw = false;
    try {
      runNodeScript("qa.mjs", ["--packs", "mini-pack", "--out", qaOutPath], tmpRoot, packsRoot);
    } catch (err) {
      threw = true;
      // Should not throw for a passing report; surface stderr for debugging if it does.
      console.error(err.stderr?.toString() ?? err.message);
    }
    assert.equal(threw, false, "qa.mjs should exit 0 for an all-passing report");

    const report = JSON.parse(readFileSync(qaOutPath, "utf8"));
    assert.equal(report.packs["mini-pack"].failed, 0);
    assert.equal(report.packs["mini-pack"].checked, 1);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("qa.mjs exits non-zero and reports a failure for a broken translation (dropped dice formula)", () => {
  const { tmpRoot, packsRoot } = setupTmpPacksRoot();
  try {
    const translatedDir = join(tmpRoot, "out", "translate");
    mkdirSync(join(translatedDir, "mini-pack"), { recursive: true });
    writeFileSync(
      join(translatedDir, "mini-pack", "translated-001.json"),
      JSON.stringify({
        miniDoc0000001A: {
          name: "Mini Bola de Fogo",
          description: "<p>Você causa 8d6 de dano de fogo em uma explosão.</p>", // 6d6 -> 8d6, wrong.
        },
      }),
    );
    runNodeScript("apply.mjs", ["--packs", "mini-pack", "--translated-dir", translatedDir], tmpRoot, packsRoot);

    const qaOutPath = join(tmpRoot, "qa-report.json");
    let threw = false;
    try {
      runNodeScript("qa.mjs", ["--packs", "mini-pack", "--out", qaOutPath], tmpRoot, packsRoot);
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "qa.mjs should exit non-zero when a doc fails a check");

    const report = JSON.parse(readFileSync(qaOutPath, "utf8"));
    assert.equal(report.packs["mini-pack"].failed, 1);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
